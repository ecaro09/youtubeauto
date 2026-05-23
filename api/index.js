const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// In-memory store (Vercel serverless: no SQLite, no persistent filesystem)
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
};

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function getSystemStatus() {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    youtube: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
    database: true,
  };
}

// ─── Template-based generation (works with zero API keys) ────────────────────

const CONTENT_TEMPLATES = [
  {
    type: 'tutorial',
    titleFn: t => `How to Master ${t}: The Complete Step-by-Step Guide`,
    hookFn: t => `Most people struggle with ${t} for months. I'll show you how to get it right in one video.`,
    points: [
      'Understanding the fundamentals',
      'The 3 biggest mistakes beginners make',
      'Step-by-step walkthrough with examples',
      'Pro tips that save hours of frustration',
      'How to keep improving after this video',
    ],
    ctaFn: () => 'Subscribe and hit the bell — new tutorials drop every week!',
    audienceFn: t => `Anyone who wants to learn ${t} from scratch or level up their skills`,
    toneFn: () => 'educational and friendly',
  },
  {
    type: 'story',
    titleFn: t => `The Surprising Truth About ${t} Nobody Talks About`,
    hookFn: t => `What if everything you believed about ${t} was holding you back? This changed my life.`,
    points: [
      'The common misconception that trips everyone up',
      'What the data actually shows',
      'A real example that proves the point',
      'The mindset shift that makes it click',
      'How to apply this starting today',
    ],
    ctaFn: () => 'Like this video and share it with someone who needs to hear this!',
    audienceFn: t => `Curious people who want a fresh perspective on ${t}`,
    toneFn: () => 'narrative and thought-provoking',
  },
  {
    type: 'list',
    titleFn: t => `7 Things About ${t} Every Beginner Needs to Know`,
    hookFn: t => `I spent 6 months figuring out ${t} the hard way. Here are the 7 things I wish someone told me.`,
    points: [
      'The foundation 90% of people skip',
      'The fastest way to see real results',
      'The tool that makes everything easier',
      'The mistake that wastes the most time',
      'The secret the experts use',
      'How to measure your progress',
      'The one habit that ties it all together',
    ],
    ctaFn: () => 'Comment below: which tip surprised you most?',
    audienceFn: t => `Beginners and intermediate learners exploring ${t}`,
    toneFn: () => 'engaging and informative',
  },
  {
    type: 'explainer',
    titleFn: t => `${t} Explained in 10 Minutes (Even If You're a Total Beginner)`,
    hookFn: t => `${t} sounds complicated — but it's actually surprisingly simple once you understand these core ideas.`,
    points: [
      'What it actually is (in plain English)',
      'Why it matters right now',
      'The key concepts broken down simply',
      'A real-world example you can relate to',
      'Where to go from here',
    ],
    ctaFn: () => 'Share this with someone who\'s been confused about this topic!',
    audienceFn: t => `Complete beginners who want to understand ${t} without the jargon`,
    toneFn: () => 'clear and accessible',
  },
];

const SEO_SUFFIX_POOL = ['tutorial', 'guide', 'explained', 'for beginners', 'tips', 'how to', '2025', 'step by step'];
const HASHTAG_POOL = ['#LearnOnYouTube', '#Tutorial', '#HowTo', '#Education', '#Tips', '#Beginner', '#Growth'];

function buildTemplateStrategy(topic) {
  const t = topic || pickDefaultTopic();
  const tmpl = CONTENT_TEMPLATES[Math.floor(Math.random() * CONTENT_TEMPLATES.length)];

  const title = tmpl.titleFn(t);
  const keywords = [
    t,
    `${t} ${SEO_SUFFIX_POOL[Math.floor(Math.random() * 4)]}`,
    `${t} ${SEO_SUFFIX_POOL[4 + Math.floor(Math.random() * 4)]}`,
    `best ${t}`,
    `learn ${t}`,
  ];

  const hook = tmpl.hookFn(t);
  const intro = `Welcome back! Today we're diving deep into ${t}. By the end of this video you'll have everything you need to get started.`;
  const outro = `That's everything you need to know about ${t}. Remember: the key is to take action today, not tomorrow.`;

  const fullScript = [
    `[HOOK] ${hook}`,
    '',
    `[INTRO] ${intro}`,
    '',
    ...tmpl.points.map((p, i) => `[POINT ${i + 1}] ${p}`),
    '',
    `[OUTRO] ${outro}`,
    '',
    `[CTA] ${tmpl.ctaFn()}`,
  ].join('\n');

  return {
    title,
    topic: t,
    contentType: tmpl.type,
    hook,
    introduction: intro,
    mainPoints: tmpl.points,
    conclusion: outro,
    callToAction: tmpl.ctaFn(),
    targetAudience: tmpl.audienceFn(t),
    tone: tmpl.toneFn(),
    keywords,
    tags: [...keywords.slice(0, 3), tmpl.type, 'youtube', 'content'],
    hashtags: HASHTAG_POOL.sort(() => Math.random() - 0.5).slice(0, 5),
    description: `${hook}\n\nIn this video:\n${tmpl.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n${tmpl.ctaFn()}`,
    fullScript,
    estimatedDuration: `${8 + Math.floor(Math.random() * 7)} minutes`,
    seoScore: 75 + Math.floor(Math.random() * 20),
    thumbnailConcept: `Bold text "${title.split(':')[0]}" with a high-contrast background. Include a surprised/excited face on the left and a relevant graphic on the right.`,
    generatedBy: 'template',
  };
}

const DEFAULT_TOPICS = [
  'Animated Storytelling', 'Digital Art', 'Creative Writing', 'Productivity',
  'Mindfulness', 'Personal Finance', 'Side Hustles', 'Video Editing',
  'Social Media Growth', 'Public Speaking',
];

function pickDefaultTopic() {
  return DEFAULT_TOPICS[Math.floor(Math.random() * DEFAULT_TOPICS.length)];
}

// ─── OpenAI generation (used when OPENAI_API_KEY is present) ─────────────────

async function generateWithOpenAI(topic) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const t = topic || pickDefaultTopic();
  const prompt = `You are a YouTube content strategist. Create a detailed content strategy for a YouTube video about: "${t}"

Respond with a JSON object containing:
- title: catchy video title (max 60 chars)
- topic: the topic
- contentType: one of tutorial|story|list|explainer
- hook: opening line to hook viewers (1-2 sentences)
- introduction: brief intro paragraph
- mainPoints: array of 5 main talking points (strings)
- conclusion: closing paragraph
- callToAction: what to ask viewers to do
- targetAudience: who this is for
- tone: writing tone (e.g. "educational and friendly")
- keywords: array of 5 SEO keyword phrases
- tags: array of 6 YouTube tags
- hashtags: array of 5 hashtags with # prefix
- description: full YouTube description (3-4 paragraphs)
- estimatedDuration: e.g. "10-12 minutes"
- seoScore: number 70-99
- thumbnailConcept: brief description of thumbnail design
- generatedBy: "openai"`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.8,
  });

  return JSON.parse(completion.choices[0].message.content);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'dashboard')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

app.get('/health', (req, res) => {
  const services = getSystemStatus();
  res.json({
    status: 'healthy',
    initialized: true,
    agents: ['strategy', 'scriptWriter', 'thumbnailDesigner', 'seoOptimizer', 'production', 'publishing', 'analytics'],
    services,
    mode: services.openai ? 'AI-powered' : 'Template-based',
    timestamp: new Date().toISOString(),
  });
});

app.get('/schedule', (req, res) => {
  const upcoming = store.scheduleItems
    .filter(i => i.status === 'scheduled')
    .sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime))
    .slice(0, 10);
  res.json(upcoming);
});

app.get('/analytics', (req, res) => {
  const totalVideos = store.contentItems.filter(i => i.status === 'published').length;
  const avgScore =
    store.analyticsReports.length > 0
      ? Math.round(store.analyticsReports.reduce((s, r) => s + (r.performanceScore || 0), 0) / store.analyticsReports.length)
      : 0;
  res.json({
    totalVideos,
    averagePerformanceScore: avgScore,
    recentReports: store.analyticsReports.slice(-5),
    contentItems: store.contentItems.slice(-10),
  });
});

app.get('/content', (req, res) => {
  res.json(store.contentItems.slice().reverse());
});

app.get('/content/:id', (req, res) => {
  const item = store.contentItems.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// Main generation endpoint — works with OR without OPENAI_API_KEY
app.post('/generate', async (req, res) => {
  try {
    const { topic, style } = req.body;

    let strategy;
    if (process.env.OPENAI_API_KEY) {
      strategy = await generateWithOpenAI(topic);
    } else {
      strategy = buildTemplateStrategy(topic);
    }

    const contentId = generateId('content');
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const contentItem = {
      id: contentId,
      title: strategy.title,
      topic: strategy.topic,
      style: style || strategy.contentType || 'story',
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

    res.json({ success: true, result: { contentId, title: contentItem.title, scheduledFor, strategy } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/publish/:contentId', (req, res) => {
  const item = store.contentItems.find(i => i.id === req.params.contentId);
  if (!item) return res.status(404).json({ success: false, error: 'Content not found' });

  item.status = 'published';
  item.publishedAt = new Date().toISOString();

  const scheduleItem = store.scheduleItems.find(s => s.contentId === req.params.contentId);
  if (scheduleItem) scheduleItem.status = 'published';

  store.analyticsReports.push({
    id: generateId('analytics'),
    contentId: req.params.contentId,
    title: item.title,
    performanceScore: Math.floor(Math.random() * 35) + 65,
    analyzedAt: new Date().toISOString(),
  });

  res.json({ success: true, result: { contentId: item.id, title: item.title, publishedAt: item.publishedAt } });
});

app.get('/settings', (req, res) => res.json(store.settings));
app.post('/settings', (req, res) => {
  Object.assign(store.settings, req.body);
  res.json({ success: true, settings: store.settings });
});

module.exports = app;
