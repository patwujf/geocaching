const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

// ── App Setup ──
const app = express();
const PORT = process.env.PORT || 3001;

app.set('view engine', 'ejs');
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, 'public', 'uploads');

app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(UPLOAD_DIR)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Sessions ──
app.use(session({
  secret: 'geocaching-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ── File Uploads ──
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg','.jpeg','.png','.gif','.webp','.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only images allowed'));
  },
});

// ── i18n ──
const zh = require('./locales/zh.json');
const en = require('./locales/en.json');
const locales = { zh, en };

function detectLang(req) {
  if (req.query.lang) return req.query.lang;
  if (req.session && req.session.lang) return req.session.lang;
  if (req.headers['accept-language']) {
    const langs = req.headers['accept-language'].split(',');
    for (const l of langs) {
      const code = l.trim().split('-')[0].split(';')[0].toLowerCase();
      if (code === 'zh' || code === 'en') return code;
    }
  }
  if (req.session && req.session.userId) {
    const user = db.getUserById(req.session.userId);
    if (user && user.lang) return user.lang;
  }
  return 'zh';
}

app.use((req, res, next) => {
  const lang = detectLang(req);
  req.lang = lang;
  const tData = locales[lang] || locales.zh;
  req.t = (key, ...args) => {
    let val = tData[key] || locales.zh[key] || key;
    if (args.length) {
      args.forEach((a, i) => { val = val.replace(`{${i}}`, a); });
    }
    return val;
  };
  res.locals.t = req.t;
  res.locals.lang = lang;
  res.locals.currentUser = req.session.userId
    ? db.getUserById(req.session.userId) : null;
  res.locals.path = req.path;
  next();
});

// ── Auth Middleware ──
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect(`/login?lang=${req.lang}&redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

// ── Routes: Auth ──

app.get('/login', (req, res) => {
  res.render('login', {
    error: null,
    redirect: req.query.redirect || '/',
  });
});

const AUTH_SERVER = process.env.AUTH_SERVER || 'http://localhost:3000';

app.post('/api/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ ok: false, error: 'error.phoneRequired' });

  try {
    const authRes = await fetch(`${AUTH_SERVER}/api/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await authRes.json();

    if (data.code === 200) {
      res.json({ ok: true });
    } else {
      res.json({ ok: false, error: data.message || '验证码发送失败' });
    }
  } catch (e) {
    console.error('Auth server unreachable:', e.message);
    res.json({ ok: false, error: '短信服务暂时不可用，请稍后重试' });
  }
});

app.post('/api/verify-code', async (req, res) => {
  const { phone, code, nickname } = req.body;
  if (!phone) return res.json({ ok: false, error: 'error.phoneRequired' });
  if (!code) return res.json({ ok: false, error: 'error.codeRequired' });

  try {
    // 通过 auth-server 验证短信验证码
    const authRes = await fetch(`${AUTH_SERVER}/api/verify-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });

    if (!authRes.ok) {
      return res.json({ ok: false, error: 'error.codeInvalid' });
    }

    // 验证码正确，管理 GeoCaching 本地用户
    let user = db.getUserByPhone(phone);
    if (!user) {
      // 新用户：需要昵称
      if (!nickname) return res.json({ ok: false, error: 'error.nicknameRequired' });
      user = db.createUser(phone, nickname, req.lang);
    } else if (nickname && nickname !== user.nickname) {
      db.updateUserNickname(user.id, nickname);
      user = db.getUserById(user.id);
    }

    req.session.userId = user.id;
    req.session.lang = req.lang;

    res.json({ ok: true, user: { id: user.id, nickname: user.nickname, phone: user.phone } });
  } catch (e) {
    console.error('Auth server unreachable:', e.message);
    res.json({ ok: false, error: '认证服务暂时不可用，请稍后重试' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ── Routes: User Prefs ──

app.get('/api/user/prefs', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  if (!user) return res.json({ ok: false, error: 'User not found' });
  res.json({
    ok: true,
    data: {
      map_lat: user.map_lat,
      map_lng: user.map_lng,
      map_zoom: user.map_zoom,
    },
  });
});

app.post('/api/user/prefs', requireLogin, (req, res) => {
  const { map_lat, map_lng, map_zoom } = req.body;
  db.updateUserMapPrefs(req.session.userId, map_lat || 0, map_lng || 0, map_zoom || 5);
  res.json({ ok: true });
});

// ── Routes: Caches ──

// Main map page
app.get('/', (req, res) => {
  const caches = db.getAllCaches();
  res.render('index', {
    caches,
    search: req.query.q || '',
    mapboxToken: null, // not needed for OSM tiles
  });
});

// Search API (for XHR)
app.get('/api/caches', (req, res) => {
  const q = (req.query.q || '').trim();
  const caches = q ? db.searchCaches(q) : db.getAllCaches();
  res.json(caches.map(c => ({
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    author_name: c.author_name,
    created_at: c.created_at,
    log_count: c.log_count || 0,
  })));
});

// Create cache
app.post('/api/caches', requireLogin, (req, res) => {
  try {
    const { name, description, lat, lng } = req.body;
    if (!name || !lat || !lng) {
      return res.json({ ok: false, error: '名称和坐标为必填项' });
    }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.json({ ok: false, error: '坐标格式错误' });
    }
    const cache = db.createCache(req.session.userId, name, description || '', latNum, lngNum, '');
    res.json({ ok: true, cache: { id: cache.id, name: cache.name } });
  } catch (e) {
    console.error('[创建藏宝点错误]', e);
    res.json({ ok: false, error: '创建失败: ' + e.message });
  }
});

// Upload images (for logs)
app.post('/api/upload', requireLogin, upload.array('images', 9), (req, res) => {
  const files = req.files.map(f => f.filename);
  res.json({ ok: true, files });
});

// Cache detail page
app.get('/cache/:id', (req, res) => {
  const cache = db.getCacheById(parseInt(req.params.id));
  if (!cache) return res.status(404).render('login', { error: 'error.notFound', redirect: '/' });

  const logs = db.getLogsByCache(cache.id).map(l => ({
    ...l,
    images: JSON.parse(l.images || '[]'),
  }));

  res.render('cache', { cache, logs });
});

// Delete cache
app.post('/api/cache/:id/delete', requireLogin, (req, res) => {
  const cache = db.getCacheById(parseInt(req.params.id));
  if (!cache) return res.json({ ok: false, error: 'error.notFound' });
  if (cache.user_id !== req.session.userId) {
    return res.json({ ok: false, error: 'Permission denied' });
  }
  db.deleteCache(cache.id);
  res.json({ ok: true });
});

// Add log
app.post('/api/cache/:id/logs', requireLogin, upload.array('images', 9), (req, res) => {
  const cacheId = parseInt(req.params.id);
  const cache = db.getCacheById(cacheId);
  if (!cache) return res.json({ ok: false, error: 'error.notFound' });

  const { content } = req.body;
  if (!content) return res.json({ ok: false, error: 'Content is required' });

  const images = (req.files || []).map(f => f.filename);
  const log = db.createLog(cacheId, req.session.userId, content, images);

  res.json({
    ok: true,
    log: { ...log, images: JSON.parse(log.images) },
  });
});

// ── Error handling ──
app.use((req, res) => {
  res.status(404).send(req.t('error.notFound'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Server error');
});

// ── Start ──
async function start() {
  await db.init();

  // 数据持久化保障：进程退出时保存
  function safeFlush() { try { db.flush(); } catch {} }
  process.on('SIGINT', () => { safeFlush(); process.exit(0); });
  process.on('SIGTERM', () => { safeFlush(); process.exit(0); });
  process.on('exit', safeFlush);

  app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  🗺️  GeoCache Server');
  console.log('');
  console.log(`  → http://localhost:${PORT}`);
  console.log('');
  console.log('  📱 Dev SMS codes are printed to console');
  console.log('  🔑 Universal test code: 888888');
  console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
