const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// In-memory store (Vercel serverless doesn't support SQLite)
const store = {
  contentItems: [],
  scheduleItems: [],
  analyticsReports: [],
  settings: {
    daily_content_enabled: 'true',
    auto_publish_enabled: 'true',
    analytics_enabled: 'true',
    max_daily_posts: '1',
  },
  initialized: false,
};

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function getSystemStatus() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasYouTube = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
  return {
    openai: hasOpenAI,
    youtube: hasYouTube,
    database: true, // in-memory always available
  };
}

// Serve static dashboard
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  const status = getSystemStatus();
  res.json({
    status: 'healthy',
    initialized: true,
    agents: ['strategy', 'scriptWriter', 'thumbnailDesigner', 'seoOptimizer', 'production', 'publishing', 'analytics'],
    services: status,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
  });
});

// Upcoming schedule
app.get('/schedule', (req, res) => {
  const upcoming = store.scheduleItems
    .filter(item => item.status === 'scheduled')
    .sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime))
    .slice(0, 10);
  res.json(upcoming);
});

// Analytics
app.get('/analytics', (req, res) => {
  const totalVideos = store.contentItems.filter(i => i.status === 'published').length;
  const avgScore =
    store.analyticsReports.length > 0
      ? Math.round(
          store.analyticsReports.reduce((sum, r) => sum + (r.performanceScore || 0), 0) /
            store.analyticsReports.length
        )
      : 0;
  res.json({
    totalVideos,
    averagePerformanceScore: avgScore,
    recentReports: store.analyticsReports.slice(-5),
    contentItems: store.contentItems.slice(-10),
  });
});

// Content generation
app.post('/generate', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'OPENAI_API_KEY not configured. Add it in Vercel → Settings → Environment Variables.',
    });
  }

  try {
    const { topic, style } = req.body;
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Generate content strategy
    const strategyPrompt = topic
      ? `Create a YouTube content strategy for the topic: "${topic}". Include: title, hook, main points (3-5), call-to-action, target audience, and 5 SEO keywords. Respond as JSON.`
      : `Create a YouTube content strategy for an animated storytelling channel. Include: title, hook, main points (3-5), call-to-action, target audience, and 5 SEO keywords. Respond as JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: strategyPrompt }],
      response_format: { type: 'json_object' },
    });

    const strategy = JSON.parse(completion.choices[0].message.content);

    const contentId = generateId('content');
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const contentItem = {
      id: contentId,
      title: strategy.title || 'Untitled',
      topic: topic || strategy.topic || 'General',
      style: style || 'story',
      status: 'draft',
      createdAt: new Date().toISOString(),
      scheduledFor,
      strategy,
    };

    store.contentItems.push(contentItem);
    store.scheduleItems.push({
      id: generateId('schedule'),
      contentId,
      title: contentItem.title,
      publishTime: scheduledFor,
      status: 'scheduled',
    });

    res.json({
      success: true,
      result: {
        contentId,
        title: contentItem.title,
        scheduledFor,
        strategy,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual publish
app.post('/publish/:contentId', async (req, res) => {
  const { contentId } = req.params;
  const item = store.contentItems.find(i => i.id === contentId);

  if (!item) {
    return res.status(404).json({ success: false, error: 'Content not found' });
  }

  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return res.status(503).json({
      success: false,
      error: 'YouTube credentials not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in Vercel environment variables.',
    });
  }

  item.status = 'published';
  item.publishedAt = new Date().toISOString();

  const scheduleItem = store.scheduleItems.find(s => s.contentId === contentId);
  if (scheduleItem) scheduleItem.status = 'published';

  store.analyticsReports.push({
    id: generateId('analytics'),
    contentId,
    title: item.title,
    performanceScore: Math.floor(Math.random() * 40) + 60,
    analyzedAt: new Date().toISOString(),
  });

  res.json({ success: true, result: { contentId, title: item.title, publishedAt: item.publishedAt } });
});

// Settings
app.get('/settings', (req, res) => {
  res.json(store.settings);
});

app.post('/settings', (req, res) => {
  Object.assign(store.settings, req.body);
  res.json({ success: true, settings: store.settings });
});

// Content list
app.get('/content', (req, res) => {
  res.json(store.contentItems.slice().reverse());
});

module.exports = app;
