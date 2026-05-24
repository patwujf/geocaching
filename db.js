const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'data', 'geocaching.db');

let SQL;
let db;       // In-memory sql.js database
let dbDirty = false;

// ── Init (must be called before any other function) ──
async function init() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  initTables();
  flush();
}

// Save in-memory DB to disk
function flush() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  dbDirty = false;
}

// Auto-save on writes
function markDirty() {
  if (!dbDirty) {
    dbDirty = true;
    // Flush synchronously on every write - safe for a dev tool
    flush();
  }
}

// ── Internal helpers ──
function qAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function qGet(sql, params = []) {
  const rows = qAll(sql, params);
  return rows[0];
}

function qRun(sql, params = []) {
  try {
    db.run(sql, params);
    // 先读取 last_insert_rowid，再保存（db.export() 会重置这个状态）
    const result = db.exec("SELECT last_insert_rowid()");
    const id = result[0] && result[0].values[0][0];
    markDirty();
    return { lastInsertRowid: id };
  } catch(e) {
    console.error('qRun error:', e.message, 'SQL:', sql);
    throw e;
  }
}

// ── Schema ──
function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      phone       TEXT    UNIQUE NOT NULL,
      nickname    TEXT    NOT NULL DEFAULT '',
      lang        TEXT    DEFAULT 'zh',
      created_at  TEXT    DEFAULT (datetime('now')),
      map_lat     REAL    DEFAULT 0,
      map_lng     REAL    DEFAULT 0,
      map_zoom    INTEGER DEFAULT 5
    )
  `);
  // 兼容旧数据库：添加可能缺失的列
  try { db.run("ALTER TABLE users ADD COLUMN map_lat REAL DEFAULT 0"); } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN map_lng REAL DEFAULT 0"); } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN map_zoom INTEGER DEFAULT 5"); } catch {}
  db.run(`
    CREATE TABLE IF NOT EXISTS sms_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      phone       TEXT    NOT NULL,
      code        TEXT    NOT NULL,
      expires_at  TEXT    NOT NULL,
      used        INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS caches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      lat         REAL    NOT NULL,
      lng         REAL    NOT NULL,
      cover_image TEXT    DEFAULT '',
      created_at  TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_id    INTEGER NOT NULL,
      user_id     INTEGER NOT NULL,
      content     TEXT    NOT NULL,
      images      TEXT    DEFAULT '[]',
      created_at  TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (cache_id) REFERENCES caches(id),
      FOREIGN KEY (user_id)  REFERENCES users(id)
    )
  `);

  // Indexes - try/catch because sql.js throws if index already exists
  try { db.run("CREATE INDEX IF NOT EXISTS idx_caches_lat_lng ON caches(lat, lng)"); } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_caches_name ON caches(name)"); } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_logs_cache ON logs(cache_id)"); } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_codes(phone)"); } catch {}

  markDirty();
}

// ── Users ──
function getUserByPhone(phone) {
  return qGet("SELECT * FROM users WHERE phone = ?", [phone]);
}

function getUserById(id) {
  return qGet("SELECT * FROM users WHERE id = ?", [id]);
}

function createUser(phone, nickname, lang) {
  const r = qRun(
    "INSERT INTO users (phone, nickname, lang) VALUES (?, ?, ?)",
    [phone, nickname, lang || 'zh']
  );
  return getUserById(r.lastInsertRowid);
}

function updateUserNickname(id, nickname) {
  qRun("UPDATE users SET nickname = ? WHERE id = ?", [nickname, id]);
}

function updateUserMapPrefs(id, lat, lng, zoom) {
  qRun("UPDATE users SET map_lat = ?, map_lng = ?, map_zoom = ? WHERE id = ?", [lat, lng, zoom, id]);
}

// ── SMS Codes ──
function saveSmsCode(phone, code) {
  qRun("UPDATE sms_codes SET used = 1 WHERE phone = ? AND used = 0", [phone]);
  qRun(
    "INSERT INTO sms_codes (phone, code, expires_at) VALUES (?, ?, datetime('now', '+5 minutes'))",
    [phone, code]
  );
}

function verifySmsCode(phone, code) {
  const row = qGet(
    "SELECT * FROM sms_codes WHERE phone = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
    [phone, code]
  );
  if (row) {
    qRun("UPDATE sms_codes SET used = 1 WHERE id = ?", [row.id]);
    return true;
  }
  return false;
}

// ── Caches ──
function createCache(userId, name, description, lat, lng, coverImage) {
  const r = qRun(
    "INSERT INTO caches (user_id, name, description, lat, lng, cover_image) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, name, description, lat, lng, coverImage || '']
  );
  return getCacheById(r.lastInsertRowid);
}

function getCacheById(id) {
  const cache = qGet(
    "SELECT c.*, u.nickname AS author_name FROM caches c JOIN users u ON c.user_id = u.id WHERE c.id = ?",
    [id]
  );
  if (cache) {
    const cnt = qGet("SELECT COUNT(*) AS cnt FROM logs WHERE cache_id = ?", [id]);
    cache.log_count = cnt ? cnt.cnt : 0;
  }
  return cache;
}

function getAllCaches() {
  return qAll(
    "SELECT c.*, u.nickname AS author_name FROM caches c JOIN users u ON c.user_id = u.id ORDER BY c.created_at DESC"
  );
}

function searchCaches(keyword) {
  return qAll(
    "SELECT c.*, u.nickname AS author_name FROM caches c JOIN users u ON c.user_id = u.id WHERE c.name LIKE ? ORDER BY c.created_at DESC",
    [`%${keyword}%`]
  );
}

function deleteCache(id) {
  qRun("DELETE FROM logs WHERE cache_id = ?", [id]);
  qRun("DELETE FROM caches WHERE id = ?", [id]);
}

// ── Logs ──
function createLog(cacheId, userId, content, images) {
  const r = qRun(
    "INSERT INTO logs (cache_id, user_id, content, images) VALUES (?, ?, ?, ?)",
    [cacheId, userId, content, JSON.stringify(images || [])]
  );
  return getLogById(r.lastInsertRowid);
}

function getLogById(id) {
  return qGet(
    "SELECT l.*, u.nickname AS author_name FROM logs l JOIN users u ON l.user_id = u.id WHERE l.id = ?",
    [id]
  );
}

function getLogsByCache(cacheId) {
  return qAll(
    "SELECT l.*, u.nickname AS author_name FROM logs l JOIN users u ON l.user_id = u.id WHERE l.cache_id = ? ORDER BY l.created_at DESC",
    [cacheId]
  );
}

module.exports = {
  init,
  getUserByPhone,
  getUserById,
  createUser,
  updateUserNickname,
  updateUserMapPrefs,
  saveSmsCode,
  verifySmsCode,
  createCache,
  getCacheById,
  getAllCaches,
  searchCaches,
  deleteCache,
  createLog,
  getLogById,
  getLogsByCache,
  flush,
};
