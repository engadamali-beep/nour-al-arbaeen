/* ملاحظاتي - خادم التطبيق: واجهة API + قاعدة بيانات SQLite محلية + ملفات ثابتة */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const COLORS = ['default', 'amber', 'sky', 'rose', 'violet', 'mint'];

app.use(express.json({ limit: '1mb' }));

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/* ---------- المصادقة (token = جلسة دائمة لمدة 7 أيام) ---------- */
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return bad(res, 'يجب تسجيل الدخول', 401);
  const nowSec = Math.floor(Date.now() / 1000);
  const s = db.prepare('SELECT token, user_id FROM sessions WHERE token = ?').get(token);
  if (!s || s.expires_at < nowSec) {
    if (s) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return bad(res, 'انتهت صلاحية الجلسة — يرجى تسجيل الدخول مرة أخرى', 401);
  }
  const u = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(s.user_id);
  if (!u) return bad(res, 'المستخدم غير موجود', 401);
  req.user = u;
  req.token = token;
  next();
}

/* ---------- إنشاء حساب / تسجيل الدخول / جلسة ---------- */
app.post('/api/auth/register', (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim().slice(0, 60);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'يرجى إدخال بريد إلكتروني صحيح');
  if (password.length < 6) return bad(res, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return bad(res, 'هذا البريد الإلكتروني مسجل مسبقًا', 409);
  const hash = bcrypt.hashSync(password, 12);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hash);
  const user = { id: Number(info.lastInsertRowid), name, email };
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
  return res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return bad(res, 'البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, u.id, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
  return res.json({ token, user: { id: u.id, name: u.name, email: u.email } });
});

app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  return res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

/* ---------- الملاحظات ---------- */
app.get('/api/notes', auth, (req, res) => {
  const notes = db.prepare('SELECT * FROM notes WHERE user_id = ? AND archived = 0 ORDER BY pinned DESC, updated_at DESC').all(req.user.id);
  return res.json({ notes });
});

app.get('/api/notes/archived', auth, (req, res) => {
  const notes = db.prepare('SELECT * FROM notes WHERE user_id = ? AND archived = 1 ORDER BY updated_at DESC').all(req.user.id);
  return res.json({ notes });
});

app.post('/api/notes', auth, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim().slice(0, 120);
  const content = String(body.content || '').slice(0, 20000);
  const color = COLORS.includes(String(body.color)) ? String(body.color) : 'default';
  const pinned = body.pinned ? 1 : 0;
  const archived = body.archived ? 1 : 0;
  const ts = nowStr();
  const info = db.prepare('INSERT INTO notes (user_id, title, content, color, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, title, content, color, pinned, archived, ts, ts);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.json({ note });
});

app.put('/api/notes/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const n = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!n) return bad(res, 'الملاحظة غير موجودة', 404);
  const title = String(body.title === undefined ? n.title : body.title).trim().slice(0, 120);
  const content = String(body.content === undefined ? n.content : body.content).slice(0, 20000);
  const color = COLORS.includes(String(body.color === undefined ? n.color : body.color)) ? String(body.color === undefined ? n.color : body.color) : n.color;
  const pinned = body.pinned === undefined ? n.pinned : (body.pinned ? 1 : 0);
  const archived = body.archived === undefined ? n.archived : (body.archived ? 1 : 0);
  const updated_at = nowStr();
  db.prepare('UPDATE notes SET title = ?, content = ?, color = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?').run(title, content, color, pinned, archived, updated_at, id);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  return res.json({ note });
});

app.delete('/api/notes/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (!r.changes) return bad(res, 'الملاحظة غير موجودة', 404);
  return res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'server_error' }); });

app.listen(PORT, () => { console.log(`ملاحظاتي: الخادم يعمل على http://localhost:${PORT}`); });
