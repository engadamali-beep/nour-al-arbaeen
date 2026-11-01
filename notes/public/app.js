/* تطبيق ملاحظاتي - ملاحظات شخصية */
const COLORS = ['default', 'amber', 'sky', 'rose', 'violet', 'mint'];
const COLOR_MAP = {
  default: { bg: 'transparent', fg: '', border: '' },
  amber: { bg: '#fff7e6', fg: '#8a5a00', border: '#f0e0b0' },
  sky: { bg: '#e8f3fb', fg: '#0b5b8c', border: '#c4e0f0' },
  rose: { bg: '#fdecef', fg: '#a32438', border: '#f5d3d9' },
  violet: { bg: '#f2edfb', fg: '#5b3fb8', border: '#e3d7f6' },
  mint: { bg: '#e9f8f1', fg: '#0d7a52', border: '#c8ecd9' }
};

const state = { token: '', user: null, notes: [], archived: [], filter: 'all', search: '', authMode: 'login', editorNote: null };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const findNote = (id) => state.notes.find((x) => x.id === id) || state.archived.find((x) => x.id === id) || null;

function saveAuth(token, user) { state.token = token; state.user = user; localStorage.setItem('mh_token', token); localStorage.setItem('mh_user', JSON.stringify(user)); }
function clearAuth() { state.token = ''; state.user = null; localStorage.removeItem('mh_token'); localStorage.removeItem('mh_user'); }

async function api(path, method, body) {
  const res = await fetch(path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (res.status === 401) { clearAuth(); showAuth(); throw new Error('auth'); }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
  return data;
}

const authScreen = $('#authScreen');
const appScreen = $('#appScreen');
const authForm = $('#authForm');
const authNameField = $('#nameField');
const authEmail = $('#authEmail');
const authPassword = $('#authPassword');
const authError = $('#authError');
const authSubmit = $('#authSubmit');

function showAuth() { authScreen.hidden = false; appScreen.hidden = true; authError.hidden = true; authError.textContent = ''; }
function showApp() { authScreen.hidden = true; appScreen.hidden = false; }

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  authNameField.hidden = mode !== 'register';
  authSubmit.textContent = mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب';
  $('#authEmail').autocomplete = mode === 'login' ? 'email' : 'new-email';
  authPassword.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}

function showAuthError(msg) { authError.textContent = msg; authError.hidden = false; }

async function onAuthSubmit(e) {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const name = authNameField.querySelector('input').value.trim();
  authError.hidden = true; authError.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAuthError('يرجى إدخال بريد إلكتروني صحيح');
  if (password.length < 6) return showAuthError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  if (state.authMode === 'register' && !name) return showAuthError('يرجى إدخال اسمك');
  authSubmit.disabled = true;
  authSubmit.textContent = 'جارٍ...';
  try {
    const data = state.authMode === 'login'
      ? await api('/api/auth/login', 'POST', { email, password })
      : await api('/api/auth/register', 'POST', { name, email, password });
    saveAuth(data.token, data.user);
    setAuthMode('login');
    showApp();
    await loadNotes();
  } catch (err) {
    showAuthError(err.message === 'auth' ? 'انتهت الجلسة — يرجى تسجيل الدخول مرة أخرى' : (err.message || 'حدث خطأ، حاول مرة أخرى'));
  } finally { authSubmit.disabled = false; authSubmit.textContent = state.authMode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'; }
}

function toggleEye() { const p = $('#authPassword'); p.type = p.type === 'password' ? 'text' : 'password'; $('#authEye').textContent = p.type === 'password' ? '👁' : '🙈'; }

async function loadNotes() {
  const [a, ar] = await Promise.all([api('/api/notes', 'GET'), api('/api/notes/archived', 'GET')]);
  state.notes = a.notes || [];
  state.archived = ar.notes || [];
  render();
}

/* ---------- العرض ---------- */
function render() {
  const list = state.filter === 'archived' ? state.archived : state.notes;
  const f = state.search.trim();
  let shown = list;
  if (state.filter === 'pinned') shown = shown.filter((n) => n.pinned);
  if (f) shown = shown.filter((n) => (n.title || '').includes(f) || (n.content || '').includes(f));
  shown = shown.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const grid = $('#notesGrid');
  grid.innerHTML = '';
  if (!shown.length) {
    $('#emptyState').hidden = false;
    $('#emptyTitle').textContent = state.filter === 'archived' ? 'لا توجد ملاحظات مؤرشفة' : 'لا توجد ملاحظات بعد';
    $('#emptyText').textContent = state.filter === 'archived' ? 'ستظهر الملاحظات المؤرشفة هنا.' : 'ابدأ بإنشاء ملاحظتك الأولى وستظهر هنا.';
    $('#emptyBtn').style.display = state.filter === 'archived' ? 'none' : '';
  } else {
    $('#emptyState').hidden = true;
    shown.forEach((n) => { const el = document.createElement('article'); el.className = 'ncard'; el.innerHTML = cardHTML(n); grid.appendChild(el); });
  }

  $('#countAll').textContent = state.notes.length;
  $('#countPinned').textContent = state.notes.filter((n) => n.pinned).length;
  $('#countArchived').textContent = state.archived.length;

  const titles = { all: 'ملاحظاتي', pinned: 'الملاحظات المثبتة', archived: 'المؤرشفة' };
  $('#pageTitle').textContent = titles[state.filter] || 'ملاحظاتي';
}

function cardHTML(n) {
  const c = COLOR_MAP[n.color] || COLOR_MAP.default;
  const title = esc(n.title || 'ملاحظة بلا عنوان');
  const content = esc(n.content || '').slice(0, 160);
  const actions = `
    <button class="ncard-btn" data-act="open" data-id="${n.id}" title="فتح">📖</button>
    <button class="ncard-btn" data-act="pin" data-id="${n.id}" title="تثبيت">${n.pinned ? '✅' : '📍'}</button>
    ${n.archived ? `<button class="ncard-btn" data-act="restore" data-id="${n.id}" title="استعادة">↩️</button>` : `<button class="ncard-btn" data-act="archive" data-id="${n.id}" title="مؤرشف">📦</button>`}
    <button class="ncard-btn danger" data-act="delete" data-id="${n.id}" title="حذف">🗑</button>`;
  return `<article class="ncard" data-id="${n.id}" data-color="${n.color}">
    <div class="ncard-top"><span class="ncard-dot" style="background:${c.bg};border-color:${c.border}"></span>${n.pinned ? '<span class="ncard-pin">📌 مثبتة</span>' : ''}</div>
    <h3 class="ncard-title">${title}</h3>
    <p class="ncard-content">${content || '—'}</p>
    <div class="ncard-foot"><span class="ncard-date">${esc(formatDate(n.updated_at))}</span><div class="ncard-actions">${actions}</div></div>
  </article>`;
}

/* ---------- المحرر ---------- */
function openEditor(note) {
  state.editorNote = note || null;
  $('#editorTitle').value = note ? (note.title || '') : '';
  $('#editorContent').value = note ? (note.content || '') : '';
  $('#editorColor').value = note ? (note.color || 'default') : 'default';
  $('#editorPinned').checked = !!(note && note.pinned);
  $('#editorArchived').checked = !!(note && note.archived);
  $('#editorModalTitle').textContent = note ? 'تعديل الملاحظة' : 'ملاحظة جديدة';
  $('#editorSave').textContent = note ? 'حفظ التعديلات' : 'إنشاء الملاحظة';
  $('#editorDelete').style.display = note ? '' : 'none';
  $('#editorArchive').style.display = note ? '' : 'none';
  $('#editorArchive').textContent = note && note.archived ? '↩️ استعادة' : '📦 مؤرشف';
  $('#editorBackdrop').hidden = false;
  setEditorMeta();
  requestAnimationFrame(() => $('#editorContent').focus());
}

function closeEditor() { $('#editorBackdrop').hidden = true; state.editorNote = null; }

function setEditorMeta() {
  const content = $('#editorContent').value;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  $('#editorCount').textContent = content.length + ' حرف';
  $('#editorWords').textContent = words + ' كلمة';
  $('#editorDate').textContent = state.editorNote ? formatDate(state.editorNote.updated_at) : formatDate(new Date().toISOString());
}

function saveEditor() {
  const title = $('#editorTitle').value.trim().slice(0, 120);
  const content = $('#editorContent').value;
  const color = $('#editorColor').value;
  const pinned = $('#editorPinned').checked;
  const archived = $('#editorArchived').checked;
  const finalTitle = title || (content.trim() ? content.trim().split(/\r?\n/)[0].slice(0, 60) : 'ملاحظة');
  const payload = { title: finalTitle, content, color, pinned: pinned ? 1 : 0, archived: archived ? 1 : 0 };
  if (state.editorNote) {
    api('/api/notes/' + state.editorNote.id, 'PUT', payload).then((d) => {
      const m = d.note;
      state.notes = state.notes.map((x) => (x.id === m.id ? m : x));
      state.archived = state.archived.map((x) => (x.id === m.id ? m : x));
      closeEditor(); render(); toast('تم حفظ الملاحظة ✅');
    });
  } else {
    api('/api/notes', 'POST', payload).then((d) => { state.notes = [d.note, ...state.notes]; closeEditor(); render(); toast('تم إنشاء الملاحظة ✅'); });
  }
}

function deleteNote(n) {
  if (!n) return;
  api('/api/notes/' + n.id, 'DELETE').then(() => {
    state.notes = state.notes.filter((x) => x.id !== n.id);
    state.archived = state.archived.filter((x) => x.id !== n.id);
    if (state.editorNote && state.editorNote.id === n.id) closeEditor();
    render(); toast('تم حذف الملاحظة 🗑');
  }).catch(() => {});
}

function toggleArchive(n) {
  const archived = !(n.archived ? 1 : 0);
  api('/api/notes/' + n.id, 'PUT', { archived: archived ? 1 : 0 }).then((d) => {
    const m = d.note;
    if (m.archived) { state.notes = state.notes.filter((x) => x.id !== m.id); state.archived = [m].concat(state.archived.filter((x) => x.id !== m.id)); }
    else { state.archived = state.archived.filter((x) => x.id !== m.id); state.notes = [m].concat(state.notes.filter((x) => x.id !== m.id)); }
    render();
  }).catch(() => {});
}

function togglePin(n) {
  api('/api/notes/' + n.id, 'PUT', { pinned: n.pinned ? 0 : 1 }).then((d) => {
    const m = d.note;
    state.notes = state.notes.map((x) => (x.id === m.id ? m : x));
    state.archived = state.archived.map((x) => (x.id === m.id ? m : x));
    render();
  }).catch(() => {});
}

/* ---------- تنسيق التواريخ ---------- */
function formatDate(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return ''; try { return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return d.toDateString(); } }

/* ---------- الإشعار ---------- */
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---------- الخروج ---------- */
function logout() { if (state.token) api('/api/auth/logout', 'POST').catch(() => {}); clearAuth(); showAuth(); }

/* ---------- التهيئة ---------- */
function init() {
  authForm.addEventListener('submit', onAuthSubmit);
  document.querySelectorAll('.auth-tab').forEach((b) => b.addEventListener('click', () => { setAuthMode(b.dataset.mode); }));
  $('#authEye').addEventListener('click', toggleEye);
  $('#userAvatar').addEventListener('click', (e) => { e.stopPropagation(); $('#userMenu').hidden = !$('#userMenu').hidden; });
  $('#logoutBtn').addEventListener('click', () => { $('#userMenu').hidden = true; logout(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#userMenu') && !e.target.closest('#userAvatar')) $('#userMenu').hidden = true; });
  $('#themeToggle').addEventListener('click', () => {
    const r = document.documentElement;
    const dark = r.getAttribute('data-theme') === 'dark';
    if (dark) { r.removeAttribute('data-theme'); localStorage.setItem('mh_theme', 'light'); }
    else { r.setAttribute('data-theme', 'dark'); localStorage.setItem('mh_theme', 'dark'); }
  });
  $('#newNoteBtn').addEventListener('click', () => openEditor(null));
  $('#editorClose').addEventListener('click', closeEditor);
  $('#editorSave').addEventListener('click', saveEditor);
  $('#editorDelete').addEventListener('click', () => deleteNote(state.editorNote));
  $('#editorArchive').addEventListener('click', () => { if (state.editorNote) toggleArchive(state.editorNote); });
  $('#editorBackdrop').addEventListener('click', (e) => { if (e.target === $('#editorBackdrop')) closeEditor(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditor(); });
  $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  document.querySelectorAll('#chips .chip').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
  $('#emptyBtn').addEventListener('click', () => openEditor(null));

  // ألوان الملاحظة
  const swatchesBox = $('#swatches');
  const setSwatchActive = (c) => swatchesBox.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x.dataset.color === c));
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.color = c; b.title = c === 'default' ? 'افتراضي' : c;
    b.addEventListener('click', () => { $('#editorColor').value = c; setSwatchActive(c); });
    swatchesBox.appendChild(b);
  });
  $('#editorColor').addEventListener('change', () => setSwatchActive($('#editorColor').value));
  setSwatchActive($('#editorColor').value);
  $('#editorContent').addEventListener('input', setEditorMeta);

  if (localStorage.getItem('mh_theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  if (state.token) {
    api('/api/auth/me').then((d) => { state.user = d.user; const ini = (d.user.name || 'م').trim().charAt(0).toUpperCase() || 'م'; $('#userName').textContent = d.user.name || 'مستخدم'; $('#userEmail').textContent = d.user.email; $('#userAvatarLg').textContent = ini; $('#userAvatar').textContent = ini; showApp(); await loadNotes(); }).catch(() => {});
  }
}

/* ---------- تشغيل ---------- */
document.addEventListener('DOMContentLoaded', () => {
  init();
  const grid = $('#notesGrid');
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.ncard-btn');
    if (btn) {
      const id = Number(btn.dataset.id);
      const act = btn.dataset.act;
      const n = findNote(id);
      if (!n) return;
      if (act === 'open') openEditor(n);
      else if (act === 'pin') togglePin(n);
      else toggleArchive(n);
      return;
    }
    const card = e.target.closest('.ncard');
    if (card) openEditor(findNote(Number(card.dataset.id)));
  });
});
