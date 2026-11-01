/* =========================================================
   ملاحظاتي — منطق التطبيق
   قاعدة بيانات محلية + حسابات مستقلة + تشفير من طرف المتصفح
   ========================================================= */

import {
  checkSupport,
  createAccount,
  authenticate,
  getUser,
  importKeyBytes,
  loadNotes,
  saveNote,
  deleteAccount as removeAccount,
  deleteNoteRecord,
  deleteNoteRecords,
  deleteAllUserNotes,
  bytesToB64,
  b64ToBytes,
  randomId,
} from './db.js';

/* ---------- ثوابت ---------- */
const SESSION_KEY = 'malhazati.session.v1';
const THEME_KEY = 'malhazati.theme.v1';
const VIEW_KEY = 'malhazati.view.v1';
const SORT_KEY = 'malhazati.sort.v1';

const COLORS = ['default', 'mint', 'sky', 'amber', 'rose', 'violet'];
const COLOR_LABELS = {
  default: 'افتراضي',
  mint: 'نعناعي',
  sky: 'سماوي',
  amber: 'ذهبي',
  rose: 'وردي',
  violet: 'بنفسجي',
};
const TAG_COLORS = ['mint', 'sky', 'gold', 'violet', 'rose'];
const FILTER_META = {
  all: { title: 'كل الملاحظات', sub: 'مساحتك الخاصة للأفكار والملاحظات.', crumb: 'كل الملاحظات' },
  pinned: { title: 'الملاحظات المثبتة', sub: 'أفكارك الأهم، في المقدمة دائمًا.', crumb: 'المثبتة' },
  archived: { title: 'الملاحظات المؤرشفة', sub: 'ملاحظات أنهيتها ولا تريد حذفها.', crumb: 'المؤرشفة' },
  trash: { title: 'سلة المهملات', sub: 'عناصر محذوفة يمكن استعادتها أو حذفها نهائيًا.', crumb: 'سلة المهملات' },
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- تنسيقات ---------- */
const numberFormatter = (() => {
  try { return new Intl.NumberFormat('ar-EG-u-nu-latn'); } catch { return new Intl.NumberFormat('en-US'); }
})();
const fullDateFormatter = (() => {
  try { return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return new Intl.DateTimeFormat('en-GB'); }
})();
const timeFormatter = (() => {
  try { return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' }); }
  catch { return new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit' }); }
})();
const monthYearFormatter = (() => {
  try { return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' }); }
  catch { return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }); }
})();
const relativeFormatter = (() => {
  try { return new Intl.RelativeTimeFormat('ar-EG-u-nu-latn', { numeric: 'auto', style: 'long' }); }
  catch { return null; }
})();

const formatNum = (value) => numberFormatter.format(Number(value) || 0);

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelative(value) {
  const date = parseDate(value);
  if (!date) return '';
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60000) return 'الآن';
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return relativeFormatter ? relativeFormatter.format(minutes, 'minute') : `قبل ${Math.abs(minutes)} دقيقة`;
  const hours = Math.round(diff / 3600000);
  if (Math.abs(hours) < 24) return relativeFormatter ? relativeFormatter.format(hours, 'hour') : `قبل ${Math.abs(hours)} ساعة`;
  const days = Math.round(diff / 86400000);
  if (Math.abs(days) < 7) return relativeFormatter ? relativeFormatter.format(days, 'day') : `قبل ${Math.abs(days)} يوم`;
  return fullDateFormatter.format(date);
}

function formatFullDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${fullDateFormatter.format(date)} · ${timeFormatter.format(date)}`;
}

function formatMonthYear(value) {
  const date = parseDate(value);
  return date ? monthYearFormatter.format(date) : '—';
}

/* ---------- أدوات نصية ---------- */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizeSearch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}
function highlightText(text, query) {
  const safe = escapeHtml(text);
  const needle = String(query || '').trim();
  if (!needle) return safe;
  try {
    return safe.replace(new RegExp(`(${escapeRegExp(needle)})`, 'gi'), '<mark>$1</mark>');
  } catch {
    return safe;
  }
}
function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}
function initials(user) {
  const source = String((user && (user.name || user.email)) || 'م').trim();
  return (source.charAt(0) || 'م').toUpperCase();
}
function countWords(text) {
  const clean = String(text || '').trim();
  return clean ? clean.split(/\s+/).filter(Boolean).length : 0;
}
function validNoteDate(value, fallback) {
  return parseDate(value) ? new Date(value).toISOString() : fallback;
}

/* ---------- حالة التطبيق ---------- */
const state = {
  user: null,
  key: null,
  keyB64: '',
  notes: [],
  filter: 'all',
  tag: null,
  search: '',
  sort: localStorage.getItem(SORT_KEY) || 'updated',
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  theme: localStorage.getItem(THEME_KEY) || 'system',
  editing: null,
  isNew: false,
  dirty: false,
  editRev: 0,
  saveSeq: 0,
  saveTimer: null,
  savePromise: null,
  lastFocus: null,
  authMode: 'login',
  showAllTags: false,
  emptyAction: 'new',
};

const el = {};
const byId = (id) => document.getElementById(id);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function cacheElements() {
  [
    'bootScreen', 'authView', 'appView', 'authForm', 'authTitle', 'authSubtitle',
    'authName', 'authEmail', 'authPassword', 'authConfirm', 'authEye', 'authSubmit',
    'authError', 'authErrorText', 'nameField', 'confirmField', 'strengthMeter',
    'strengthBar', 'strengthText', 'registerHint', 'sidebar', 'scrim', 'menuBtn',
    'sideClose', 'newNoteBtn', 'newNoteBtn2', 'fabNew', 'emptyBtn', 'emptyBtnText',
    'emptyState', 'emptyTitle', 'emptyText', 'searchInput', 'searchBox', 'searchClear',
    'themeToggle', 'settingsBtn', 'sortSelect', 'notesGrid', 'pageTitle', 'pageSubtitle',
    'crumb', 'filterInfo', 'filterChip', 'resultCount', 'sortHint', 'countAll',
    'countPinned', 'countArchived', 'countTrash', 'tagList', 'manageTagsBtn',
    'statActive', 'statPinned', 'statTags', 'statWords', 'sideAvatar', 'sideName',
    'sideEmail', 'userCard', 'sideThemeBtn', 'lockBtn', 'editorBackdrop',
    'editorHeading', 'saveState', 'saveStateText', 'edPin', 'edArchive', 'edClose',
    'edTitle', 'edContent', 'edTags', 'tagInput', 'colorSwatches', 'edWords',
    'edChars', 'edDate', 'edDelete', 'edDone', 'editorTagsWrap', 'settingsBackdrop',
    'settingsClose', 'profileAvatar', 'profileName', 'profileEmail', 'profileSince',
    'setNotesCount', 'setWordsCount', 'setTagsCount', 'exportBtn', 'importBtn',
    'importFile', 'lockNowBtn', 'emptyTrashBtn', 'deleteAllBtn', 'deleteAccountBtn',
    'confirmBackdrop', 'confirmIcon', 'confirmTitle', 'confirmText', 'confirmCancel',
    'confirmOk', 'toastStack',
  ].forEach((id) => { el[id] = byId(id); });
}

/* ---------- المظهر ---------- */
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme(choice) {
  if (choice === 'system') return systemThemeQuery.matches ? 'dark' : 'light';
  return choice === 'dark' ? 'dark' : 'light';
}

function setUse(button, iconId) {
  if (!button) return;
  const use = button.querySelector('use');
  if (use) use.setAttribute('href', iconId);
}

function applyTheme(choice = state.theme) {
  const valid = ['light', 'dark', 'system'].includes(choice) ? choice : 'system';
  state.theme = valid;
  const resolved = resolvedTheme(valid);
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0d1311' : '#0b5d4b');
  const iconId = resolved === 'dark' ? '#i-sun' : '#i-moon';
  const label = resolved === 'dark' ? 'التبديل إلى المظهر الفاتح' : 'التبديل إلى المظهر الداكن';
  [{ button: el.themeToggle }, { button: el.sideThemeBtn }].forEach(({ button }) => {
    setUse(button, iconId);
    if (button) button.title = label;
  });
  $$('[data-theme-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeChoice === valid);
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === valid));
  });
}

function setTheme(choice) {
  state.theme = choice;
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* ignore */ }
  applyTheme(choice);
}

function toggleTheme() {
  const current = resolvedTheme(state.theme);
  setTheme(current === 'dark' ? 'light' : 'dark');
}

systemThemeQuery.addEventListener('change', () => {
  if (state.theme === 'system') applyTheme('system');
});

/* ---------- الجلسة ---------- */
function saveSession() {
  if (!state.user || !state.keyB64) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: state.user.id,
      keyB64: state.keyB64,
      at: Date.now(),
    }));
  } catch { /* التخزين قد يكون معطلًا */ }
}
function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/* ---------- إشعارات ---------- */
function toast(message, options = {}) {
  const { type = 'success', actionLabel = '', onAction = null, duration = 3300 } = options;
  if (!el.toastStack) return;
  const node = document.createElement('div');
  node.className = `toast${type === 'danger' ? ' danger' : ''}`;
  node.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-${type === 'danger' ? 'alert' : 'check-circle'}"></use></svg><span>${escapeHtml(message)}</span>`;
  if (actionLabel) {
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      if (typeof onAction === 'function') onAction();
      node.remove();
    });
    node.appendChild(action);
  }
  el.toastStack.appendChild(node);
  const timer = window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 250);
  }, actionLabel ? 6000 : duration);
  node.addEventListener('mouseenter', () => window.clearTimeout(timer), { once: true });
}

/* ---------- تأكيد ---------- */
let confirmResolver = null;

function syncBodyLock() {
  const open = !el.editorBackdrop.hidden || !el.settingsBackdrop.hidden || !el.confirmBackdrop.hidden;
  document.body.classList.toggle('is-locked', open);
}

function askConfirm({ title, text, ok = 'تأكيد', cancel = 'إلغاء', danger = true } = {}) {
  if (confirmResolver) {
    const previous = confirmResolver;
    confirmResolver = null;
    previous(false);
  }
  el.confirmTitle.textContent = title || 'هل أنت متأكد؟';
  el.confirmText.textContent = text || 'لا يمكن التراجع عن هذا الإجراء.';
  el.confirmOk.textContent = ok;
  el.confirmCancel.textContent = cancel;
  el.confirmOk.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  el.confirmIcon.className = `confirm-icon${danger ? '' : ' info'}`;
  setUse(el.confirmIcon, danger ? '#i-alert' : '#i-info');
  el.confirmBackdrop.hidden = false;
  syncBodyLock();
  window.setTimeout(() => el.confirmCancel.focus(), 30);
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function settleConfirm(value) {
  const resolve = confirmResolver;
  confirmResolver = null;
  el.confirmBackdrop.hidden = true;
  syncBodyLock();
  if (resolve) resolve(value);
}

/* ---------- الإقلاع والواجهات ---------- */
let bootHidden = false;
function hideBoot() {
  if (bootHidden) return;
  bootHidden = true;
  el.bootScreen.classList.add('is-hiding');
  window.setTimeout(() => { el.bootScreen.hidden = true; }, 380);
}

function showFatal(error) {
  bootHidden = true;
  const noIdb = error && error.code === 'NO_IDB';
  const noCrypto = error && error.code === 'NO_CRYPTO';
  el.bootScreen.innerHTML = `
    <div class="empty-state" style="max-width:520px;margin:24px;background:var(--surface)">
      <div class="empty-art" aria-hidden="true"><span class="empty-sheet back"></span><span class="empty-sheet front"><i></i><i></i><i></i></span></div>
      <h2>تعذّر تشغيل التطبيق</h2>
      <p>${noIdb
        ? 'متصفحك لا يسمح بقواعد البيانات المحلية (IndexedDB). جرّب Chrome أو Edge أو Safari في وضع عادي، وليس وضع التصفح المتخفي.'
        : noCrypto
          ? 'هذا المتصفح لا يدعم التشفير الآمن المطلوب. يرجى تحديث المتصفح أو استخدام متصفح حديث.'
          : 'حدث خطأ غير متوقع أثناء تهيئة مساحتك. أعد تحميل الصفحة للمحاولة مرة أخرى.'}</p>
      <button class="btn btn-primary" id="fatalReload">إعادة المحاولة</button>
    </div>`;
  const button = byId('fatalReload');
  if (button) button.addEventListener('click', () => window.location.reload());
}

function setAuthBusy(busy) {
  if (!el.authSubmit) return;
  const label = el.authSubmit.querySelector('.btn-label');
  const spinner = el.authSubmit.querySelector('.spinner');
  el.authSubmit.disabled = busy;
  if (spinner) spinner.hidden = !busy;
  if (label) {
    if (busy) {
      label.textContent = state.authMode === 'register' ? 'جارٍ إنشاء الحساب…' : 'جارٍ التحقق…';
    } else {
      label.textContent = state.authMode === 'register' ? 'إنشاء الحساب' : 'تسجيل الدخول';
    }
  }
}

function clearAuthError() {
  el.authError.hidden = true;
  el.authErrorText.textContent = '';
}

function showAuthError(message) {
  el.authErrorText.textContent = message;
  el.authError.hidden = false;
}

function authErrorMessage(error) {
  const code = error && error.code;
  if (code === 'INVALID_EMAIL') return 'يرجى إدخال بريد إلكتروني صحيح.';
  if (code === 'WEAK_PASSWORD') return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
  if (code === 'EMAIL_TAKEN') return 'هذا البريد مسجّل مسبقًا على هذا المتصفح. سجّل الدخول بدلًا من ذلك.';
  if (code === 'INVALID_CREDENTIALS') return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (code === 'NO_IDB') return 'المتصفح لا يدعم قاعدة البيانات المحلية.';
  if (code === 'NO_CRYPTO') return 'المتصفح لا يدعم التشفير المطلوب.';
  return 'تعذّر إتمام العملية. حاول مرة أخرى.';
}

function updateStrength() {
  const password = el.authPassword.value;
  const visible = state.authMode === 'register' && password.length > 0;
  el.strengthMeter.hidden = !visible;
  if (!visible) return;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const level = Math.min(4, score);
  el.strengthMeter.dataset.level = String(level);
  el.strengthText.textContent = ['', 'ضعيفة', 'مقبولة', 'جيدة', 'قوية'][level] || 'قوة كلمة المرور';
}

function setAuthMode(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';
  $$('.auth-tab').forEach((tab) => {
    const active = tab.dataset.mode === state.authMode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  const isRegister = state.authMode === 'register';
  el.nameField.hidden = !isRegister;
  el.confirmField.hidden = !isRegister;
  el.registerHint.hidden = !isRegister;
  el.authTitle.textContent = isRegister ? 'أنشئ مساحتك الخاصة' : 'مرحبًا بعودتك';
  el.authSubtitle.textContent = isRegister
    ? 'حساب محلي مستقل، وبياناتك تبقى على هذا الجهاز.'
    : 'سجّل الدخول للوصول إلى مساحتك الخاصة.';
  el.authPassword.autocomplete = isRegister ? 'new-password' : 'current-password';
  el.authSubmit.querySelector('.btn-label').textContent = isRegister ? 'إنشاء الحساب' : 'تسجيل الدخول';
  clearAuthError();
  updateStrength();
}

function showAuth() {
  state.user = null;
  state.key = null;
  state.keyB64 = '';
  state.notes = [];
  state.editing = null;
  state.dirty = false;
  state.filter = 'all';
  state.tag = null;
  state.search = '';
  state.showAllTags = false;
  closeAllModals();
  closeSidebar();
  if (el.searchInput) el.searchInput.value = '';
  if (el.sidebar) el.sidebar.classList.remove('open');
  el.appView.hidden = true;
  el.authView.hidden = false;
  el.authPassword.value = '';
  el.authConfirm.value = '';
  setAuthMode('login');
  hideBoot();
  syncBodyLock();
  window.setTimeout(() => el.authEmail.focus(), 60);
}

async function completeSignIn(user, keyBytes, { welcome = false } = {}) {
  state.user = user;
  state.key = await importKeyBytes(keyBytes);
  state.keyB64 = bytesToB64(keyBytes);
  saveSession();
  await enterApp(user, { welcome });
}

async function enterApp(user, { welcome = false } = {}) {
  const result = await loadNotes(user.id, state.key);
  if (result.failed > 0 && result.notes.length === 0) {
    clearSession();
    state.user = null;
    state.key = null;
    state.keyB64 = '';
    showAuth();
    showAuthError('تعذّر فتح جلستك السابقة. يرجى تسجيل الدخول من جديد.');
    return;
  }
  state.notes = result.notes;
  if (welcome && state.notes.length === 0) {
    await seedWelcomeNote();
  }
  renderProfile();
  render();
  applyTheme(state.theme);
  el.authView.hidden = true;
  el.appView.hidden = false;
  hideBoot();
  syncBodyLock();
  saveSession();
  if (result.failed > 0) {
    toast(`تعذّر فك تشفير ${formatNum(result.failed)} ملاحظة. قد تكون تالفة.`, { type: 'danger' });
  }
}

async function seedWelcomeNote() {
  const now = new Date().toISOString();
  const note = {
    id: randomId(),
    userId: state.user.id,
    title: 'مرحبًا بك في ملاحظاتي',
    content: [
      'هذه مساحتك الشخصية للأفكار — هادئة، عربية، وخاصة بك وحدك.',
      '',
      'ما يمكنك فعله الآن:',
      '• أنشئ ملاحظة جديدة بالزر الأخضر أو بالضغط على حرف N.',
      '• ثبّت الملاحظات المهمة، وأرشِف ما انتهيت منه، وضع الباقي في السلة.',
      '• أضف وسومًا لتجمع أفكارك، واستخدم البحث الفوري للوصول إليها.',
      '• غيّر لون الملاحظة لتنظيم بصري أسرع.',
      '',
      'مهم: بياناتك مشفّرة ومحفوظة داخل هذا المتصفح فقط. احتفظ بنسخة احتياطية من الإعدادات قبل تغيير الجهاز أو المتصفح، ولا تنسَ كلمة المرور — فلا يمكن استعادتها.',
    ].join('\n'),
    tags: ['ترحيب', 'دليل سريع'],
    color: 'mint',
    pinned: true,
    archived: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await saveNote(state.key, note);
    state.notes.push(note);
  } catch {
    toast('تعذّر إنشاء ملاحظة الترحيب.', { type: 'danger' });
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (el.authSubmit.disabled) return;
  clearAuthError();
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  const isRegister = state.authMode === 'register';
  const name = el.authName.value.trim();

  if (!emailPattern.test(email)) return showAuthError('يرجى إدخال بريد إلكتروني صحيح.');
  if (isRegister) {
    if (name.length < 2) return showAuthError('يرجى إدخال اسمك (حرفان على الأقل).');
    if (password.length < 8) return showAuthError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
    if (el.authConfirm.value !== password) return showAuthError('تأكيد كلمة المرور غير مطابق.');
  } else if (!password) {
    return showAuthError('يرجى إدخال كلمة المرور.');
  }

  setAuthBusy(true);
  try {
    if (isRegister) {
      const { user, keyBytes } = await createAccount({ name, email, password });
      await completeSignIn(user, keyBytes, { welcome: true });
      toast('تم إنشاء حسابك. أهلاً بك في ملاحظاتي.');
    } else {
      const { user, keyBytes } = await authenticate(email, password);
      await completeSignIn(user, keyBytes);
      toast(`أهلاً بعودتك${user.name ? `، ${user.name}` : ''}.`);
    }
  } catch (error) {
    showAuthError(authErrorMessage(error));
  } finally {
    setAuthBusy(false);
  }
}
/* ---------- الحسابات والعرض ---------- */
function getCounts() {
  const active = [];
  const archived = [];
  const trash = [];
  state.notes.forEach((note) => {
    if (note.deleted) trash.push(note);
    else if (note.archived) archived.push(note);
    else active.push(note);
  });
  const tags = new Set();
  let words = 0;
  active.forEach((note) => {
    note.tags.forEach((tag) => tags.add(tag));
    words += countWords(note.content);
  });
  return {
    active: active.length,
    pinned: active.filter((note) => note.pinned).length,
    archived: archived.length,
    trash: trash.length,
    tags: tags.size,
    words,
  };
}

function visibleNotes() {
  let list = state.notes.filter((note) => {
    if (state.filter === 'trash') return !!note.deleted;
    if (note.deleted) return false;
    if (state.filter === 'archived') return !!note.archived;
    if (note.archived) return false;
    if (state.filter === 'pinned') return !!note.pinned;
    return true;
  });

  if (state.tag) list = list.filter((note) => note.tags.includes(state.tag));

  const query = normalizeSearch(state.search.trim());
  if (query) {
    list = list.filter((note) => normalizeSearch(
      `${note.title} ${note.content} ${note.tags.join(' ')}`
    ).includes(query));
  }

  const pinnedFirst = state.filter === 'all' || state.filter === 'pinned';
  return list.slice().sort((a, b) => {
    if (pinnedFirst && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (state.sort === 'title') {
      return String(a.title || '').localeCompare(String(b.title || ''), 'ar');
    }
    if (state.sort === 'created') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function render() {
  if (!state.user) return;
  const counts = getCounts();
  el.countAll.textContent = formatNum(counts.active);
  el.countPinned.textContent = formatNum(counts.pinned);
  el.countArchived.textContent = formatNum(counts.archived);
  el.countTrash.textContent = formatNum(counts.trash);
  el.statActive.textContent = formatNum(counts.active);
  el.statPinned.textContent = formatNum(counts.pinned);
  el.statTags.textContent = formatNum(counts.tags);
  el.statWords.textContent = formatNum(counts.words);
  syncNavActive();
  renderTags(counts);
  const list = visibleNotes();
  renderNotes(list);
  renderPageMeta(list);
  renderSettingsStats();
}

function renderTags(counts) {
  const tagCounts = new Map();
  state.notes.forEach((note) => {
    if (note.deleted || note.archived) return;
    note.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  });

  if (state.tag && !tagCounts.has(state.tag)) state.tag = null;

  const entries = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'));

  if (!entries.length) {
    el.tagList.innerHTML = '<p class="tag-empty">لا توجد وسوم بعد</p>';
    el.manageTagsBtn.hidden = true;
    return;
  }

  const limit = state.showAllTags ? entries.length : 8;
  el.tagList.innerHTML = entries.slice(0, limit).map(([tag, count]) => {
    const color = tagColor(tag);
    return `<button type="button" class="tag-item${state.tag === tag ? ' active' : ''}" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot" style="background:var(--${color});color:var(--${color})"></span>
      <span class="tag-name">${escapeHtml(tag)}</span>
      <span class="tag-count">${formatNum(count)}</span>
    </button>`;
  }).join('');

  el.manageTagsBtn.hidden = entries.length <= 8;
  el.manageTagsBtn.textContent = state.showAllTags ? 'أقل' : 'عرض الكل';
  void counts;
}

function renderPageMeta(list) {
  const query = state.search.trim();
  let title = FILTER_META[state.filter] ? FILTER_META[state.filter].title : 'ملاحظاتي';
  let subtitle = FILTER_META[state.filter] ? FILTER_META[state.filter].sub : '';
  let crumb = FILTER_META[state.filter] ? FILTER_META[state.filter].crumb : 'ملاحظاتي';

  if (state.tag) {
    title = `#${state.tag}`;
    subtitle = `كل ما يتعلق بوسم «${state.tag}».`;
    crumb = `#${state.tag}`;
  }
  if (query) {
    title = 'نتائج البحث';
    subtitle = `نتائج البحث عن «${query}».`;
    crumb = 'البحث';
  }

  el.pageTitle.textContent = title;
  el.pageSubtitle.textContent = subtitle;
  el.crumb.textContent = crumb;
  void list;
}

function renderFilterInfo(list) {
  const query = state.search.trim();
  const special = Boolean(query) || Boolean(state.tag) || state.filter === 'archived' || state.filter === 'trash';
  if (!special) {
    el.filterInfo.hidden = true;
    return;
  }
  el.filterInfo.hidden = false;

  let label;
  if (state.tag) label = `#${state.tag}`;
  else if (query) label = `بحث: «${query.length > 26 ? `${query.slice(0, 26)}…` : query}»`;
  else label = FILTER_META[state.filter].title;

  el.filterChip.innerHTML = `<span>${escapeHtml(label)}</span><svg class="ico" aria-hidden="true"><use href="#i-x"></use></svg>`;
  el.filterChip.title = 'مسح التصفية';
  el.resultCount.textContent = list.length === 1
    ? 'نتيجة واحدة'
    : `${formatNum(list.length)} نتائج`;
  void list;
}

function noteTitle(note) {
  if (note.title && note.title.trim()) return note.title.trim();
  const firstLine = String(note.content || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 80);
  return 'ملاحظة بلا عنوان';
}

function noteExcerpt(note) {
  const clean = String(note.content || '').trim();
  if (!clean) return 'لا يوجد محتوى نصي بعد.';
  return clean.length > 260 ? `${clean.slice(0, 260)}…` : clean;
}

function cardHTML(note) {
  const query = state.search.trim();
  const title = highlightText(noteTitle(note), query);
  const excerpt = highlightText(noteExcerpt(note), query);
  const pinnedBadge = note.pinned && !note.deleted
    ? '<span class="mini-badge"><svg class="ico" aria-hidden="true"><use href="#i-pin"></use></svg> مثبتة</span>'
    : '';
  const archivedBadge = note.archived && !note.deleted
    ? '<span class="mini-badge arch"><svg class="ico" aria-hidden="true"><use href="#i-archive"></use></svg> مؤرشفة</span>'
    : '';

  const tags = note.tags.slice(0, 3).map((tag) => `<span class="note-tag">${escapeHtml(tag)}</span>`).join('');
  const moreTag = note.tags.length > 3 ? `<span class="note-tag">+${formatNum(note.tags.length - 3)}</span>` : '';

  let actions = '';
  if (note.deleted) {
    actions = `
      <button type="button" class="note-act" data-act="restore" aria-label="استعادة الملاحظة" title="استعادة"><svg class="ico" aria-hidden="true"><use href="#i-restore"></use></svg></button>
      <button type="button" class="note-act danger" data-act="purge" aria-label="حذف نهائي" title="حذف نهائي"><svg class="ico" aria-hidden="true"><use href="#i-trash"></use></svg></button>`;
  } else if (note.archived) {
    actions = `
      <button type="button" class="note-act" data-act="restore" aria-label="استعادة من الأرشيف" title="استعادة"><svg class="ico" aria-hidden="true"><use href="#i-restore"></use></svg></button>
      <button type="button" class="note-act danger" data-act="delete" aria-label="نقل إلى سلة المهملات" title="حذف"><svg class="ico" aria-hidden="true"><use href="#i-trash"></use></svg></button>`;
  } else {
    actions = `
      <button type="button" class="note-act${note.pinned ? ' active' : ''}" data-act="pin" aria-label="${note.pinned ? 'إلغاء التثبيت' : 'تثبيت'}" title="${note.pinned ? 'إلغاء التثبيت' : 'تثبيت'}"><svg class="ico" aria-hidden="true"><use href="#i-pin"></use></svg></button>
      <button type="button" class="note-act" data-act="archive" aria-label="أرشفة" title="أرشفة"><svg class="ico" aria-hidden="true"><use href="#i-archive"></use></svg></button>
      <button type="button" class="note-act danger" data-act="delete" aria-label="نقل إلى سلة المهملات" title="حذف"><svg class="ico" aria-hidden="true"><use href="#i-trash"></use></svg></button>`;
  }

  return `<article class="note-card" data-id="${escapeHtml(note.id)}" data-color="${escapeHtml(note.color || 'default')}" tabindex="0" aria-label="${escapeHtml(noteTitle(note))}">
    <div class="note-top">
      <span class="note-swatch" aria-hidden="true"></span>
      <span class="note-badges">${pinnedBadge}${archivedBadge}</span>
      <span class="note-actions">${actions}</span>
    </div>
    <h3 class="note-title">${title}</h3>
    <p class="note-excerpt">${excerpt}</p>
    <div class="note-tags">${tags}${moreTag}</div>
    <div class="note-foot">
      <time datetime="${escapeHtml(note.updatedAt || '')}" title="${escapeHtml(formatFullDate(note.updatedAt))}">${escapeHtml(formatRelative(note.updatedAt))}</time>
      <span class="note-open">فتح <svg class="ico" aria-hidden="true"><use href="#i-chevron"></use></svg></span>
    </div>
  </article>`;
}

function renderNotes(list) {
  el.notesGrid.className = `notes-grid${state.view === 'list' ? ' list-view' : ''}`;
  el.notesGrid.innerHTML = list.map(cardHTML).join('');
  renderFilterInfo(list);
  el.sortHint.textContent = {
    updated: 'مرتبة حسب آخر تعديل',
    created: 'مرتبة حسب تاريخ الإنشاء',
    title: 'مرتبة أبجديًا',
  }[state.sort] || 'مرتبة حسب آخر تعديل';

  const query = state.search.trim();
  const hasNotes = list.length > 0;
  el.emptyState.hidden = hasNotes;
  if (hasNotes) return;

  if (query) {
    el.emptyTitle.textContent = 'لا نتائج مطابقة';
    el.emptyText.textContent = 'لم نجد ملاحظات تطابق بحثك. جرّب كلمة أخرى أو امسح البحث.';
    el.emptyBtnText.textContent = 'مسح البحث';
    state.emptyAction = 'clear-search';
    el.emptyBtn.hidden = false;
  } else if (state.tag) {
    el.emptyTitle.textContent = 'لا ملاحظات بهذا الوسم';
    el.emptyText.textContent = `لم نجد ملاحظات تحمل الوسم «${state.tag}».`;
    el.emptyBtnText.textContent = 'مسح الوسم';
    state.emptyAction = 'clear-tag';
    el.emptyBtn.hidden = false;
  } else if (state.filter === 'trash') {
    el.emptyTitle.textContent = 'سلة المهملات فارغة';
    el.emptyText.textContent = 'كل ما تحذفه سيظهر هنا قبل حذفه نهائيًا.';
    state.emptyAction = 'none';
    el.emptyBtn.hidden = true;
  } else if (state.filter === 'archived') {
    el.emptyTitle.textContent = 'لا توجد ملاحظات مؤرشفة';
    el.emptyText.textContent = 'أرشِف الملاحظات التي انتهيت منها لتبقى مساحتك مرتبة.';
    state.emptyAction = 'none';
    el.emptyBtn.hidden = true;
  } else if (state.filter === 'pinned') {
    el.emptyTitle.textContent = 'لا توجد ملاحظات مثبتة';
    el.emptyText.textContent = 'ثبّت الأفكار المهمة لتظهر دائمًا في المقدمة.';
    el.emptyBtnText.textContent = 'إضافة ملاحظة';
    state.emptyAction = 'new';
    el.emptyBtn.hidden = false;
  } else {
    el.emptyTitle.textContent = 'ابدأ بفكرتك الأولى';
    el.emptyText.textContent = 'لا توجد ملاحظات هنا بعد. أنشئ ملاحظة وستظهر في هذه المساحة.';
    el.emptyBtnText.textContent = 'إنشاء ملاحظة';
    state.emptyAction = 'new';
    el.emptyBtn.hidden = false;
  }
}

function renderProfile() {
  if (!state.user) return;
  const letter = initials(state.user);
  el.sideAvatar.textContent = letter;
  el.profileAvatar.textContent = letter;
  el.sideName.textContent = state.user.name || 'مستخدم';
  el.sideEmail.textContent = state.user.email || '—';
  el.profileName.textContent = state.user.name || 'مستخدم';
  el.profileEmail.textContent = state.user.email || '—';
  el.profileSince.textContent = `عضو منذ ${formatMonthYear(state.user.createdAt)}`;
  el.userCard.title = `${state.user.name || 'مستخدم'} — ${state.user.email || ''}`;
}

function renderSettingsStats() {
  if (!state.user) return;
  const visible = state.notes.filter((note) => !note.deleted);
  const tags = new Set();
  let words = 0;
  visible.forEach((note) => {
    note.tags.forEach((tag) => tags.add(tag));
    words += countWords(note.content);
  });
  el.setNotesCount.textContent = formatNum(visible.length);
  el.setWordsCount.textContent = formatNum(words);
  el.setTagsCount.textContent = formatNum(tags.size);
  el.profileSince.textContent = `عضو منذ ${formatMonthYear(state.user.createdAt)}`;
}
/* ---------- المحرر ---------- */
const SAVE_STATE_LABELS = {
  saved: 'تم الحفظ',
  typing: 'تعديلات غير محفوظة',
  saving: 'جارٍ الحفظ…',
  error: 'تعذّر الحفظ',
  draft: 'مسودة جديدة',
};

function setSaveState(kind) {
  el.saveState.dataset.state = kind;
  el.saveStateText.textContent = SAVE_STATE_LABELS[kind] || '';
}

function collectEditor() {
  if (!state.editing) return;
  state.editing.title = el.edTitle.value;
  state.editing.content = el.edContent.value;
}

function editorIsEmpty() {
  const ed = state.editing;
  if (!ed) return true;
  return !String(ed.title || '').trim() && !String(ed.content || '').trim() && ed.tags.length === 0;
}

function updateEditorMeta() {
  const ed = state.editing;
  if (!ed) return;
  const content = ed.content || '';
  el.edWords.textContent = `${formatNum(countWords(content))} كلمة`;
  el.edChars.textContent = `${formatNum(content.length)} حرف`;
  el.edDate.textContent = ed.updatedAt ? formatFullDate(ed.updatedAt) : 'مسودة جديدة';
}

function syncEditorFlags() {
  const ed = state.editing;
  if (!ed) return;
  el.edPin.classList.toggle('active', !!ed.pinned);
  el.edPin.setAttribute('aria-pressed', String(!!ed.pinned));
  el.edPin.title = ed.pinned ? 'إلغاء التثبيت' : 'تثبيت';
  el.edPin.disabled = !!ed.deleted;
  el.edArchive.classList.toggle('active', !!ed.archived);
  el.edArchive.setAttribute('aria-pressed', String(!!ed.archived));
  el.edArchive.title = ed.archived ? 'استعادة من الأرشيف' : 'أرشفة';
  el.edArchive.disabled = !!ed.deleted;
}

function updateDeleteButton() {
  const ed = state.editing;
  if (!ed) return;
  el.edDelete.hidden = state.isNew && !ed.createdAt;
  el.edDelete.innerHTML = ed.deleted
    ? '<svg class="ico" aria-hidden="true"><use href="#i-trash"></use></svg> حذف نهائيًا'
    : '<svg class="ico" aria-hidden="true"><use href="#i-trash"></use></svg> حذف';
}

function renderSwatches() {
  if (!state.editing) return;
  $$('.swatch', el.colorSwatches).forEach((swatch) => {
    const active = swatch.dataset.color === (state.editing.color || 'default');
    swatch.classList.toggle('active', active);
    swatch.setAttribute('aria-pressed', String(active));
  });
}

function renderEditorTags() {
  const ed = state.editing;
  if (!ed) return;
  el.edTags.innerHTML = ed.tags.map((tag) => `
    <span class="tag-chip">${escapeHtml(tag)}
      <button type="button" data-remove-tag="${escapeHtml(tag)}" aria-label="إزالة الوسم ${escapeHtml(tag)}">
        <svg class="ico" aria-hidden="true"><use href="#i-x"></use></svg>
      </button>
    </span>`).join('');
  el.tagInput.placeholder = ed.tags.length >= 10 ? 'الحد الأقصى 10 وسوم' : 'أضف وسمًا ثم Enter';
}

function buildSwatches() {
  el.colorSwatches.innerHTML = '';
  COLORS.forEach((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.color = color;
    button.title = COLOR_LABELS[color] || color;
    button.setAttribute('aria-label', `لون ${COLOR_LABELS[color] || color}`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      if (!state.editing) return;
      state.editing.color = color;
      renderSwatches();
      markDirty();
    });
    el.colorSwatches.appendChild(button);
  });
}

function markDirty() {
  if (!state.editing) return;
  state.editRev += 1;
  state.dirty = true;
  setSaveState(state.isNew && editorIsEmpty() ? 'draft' : 'typing');
  scheduleEditorSave();
}

function scheduleEditorSave() {
  if (!state.editing) return;
  if (state.saveTimer) window.clearTimeout(state.saveTimer);
  if (state.isNew && editorIsEmpty()) {
    setSaveState('draft');
    return;
  }
  state.saveTimer = window.setTimeout(() => {
    state.saveTimer = null;
    void saveEditor();
  }, 800);
}

async function saveEditor() {
  const ed = state.editing;
  if (!ed) return true;
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  collectEditor();
  if (state.isNew && editorIsEmpty()) {
    setSaveState('draft');
    return true;
  }

  const rev = state.editRev;
  const seq = ++state.saveSeq;
  const now = new Date().toISOString();
  const snapshot = {
    ...ed,
    title: String(ed.title || '').trim(),
    tags: [...ed.tags],
    createdAt: ed.createdAt || now,
    updatedAt: now,
  };

  setSaveState('saving');
  const promise = (async () => {
    try {
      await saveNote(state.key, snapshot);
      if (seq !== state.saveSeq) return true;

      state.isNew = false;
      ed.createdAt = snapshot.createdAt;
      ed.updatedAt = snapshot.updatedAt;

      const index = state.notes.findIndex((note) => note.id === snapshot.id);
      if (index >= 0) state.notes[index] = snapshot;
      else state.notes.push(snapshot);

      el.edDelete.hidden = false;
      updateDeleteButton();

      if (state.editRev === rev) {
        state.dirty = false;
        setSaveState('saved');
      } else {
        setSaveState('typing');
        scheduleEditorSave();
      }
      updateEditorMeta();
      render();
      return true;
    } catch {
      if (seq === state.saveSeq) {
        setSaveState('error');
        toast('تعذّر حفظ الملاحظة. تحقق من مساحة التخزين وحاول مجددًا.', { type: 'danger' });
      }
      return false;
    }
  })();

  state.savePromise = promise;
  try {
    return await promise;
  } finally {
    if (state.savePromise === promise) state.savePromise = null;
  }
}

async function flushEditor() {
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  if (!state.editing) return true;
  collectEditor();
  if (state.isNew && editorIsEmpty()) return true;

  if (state.savePromise) {
    const ok = await state.savePromise;
    if (!ok) return false;
  }
  if (!state.editing) return true;
  if (state.dirty || state.isNew) return saveEditor();
  return true;
}

function openEditor(note) {
  if (!state.user || state.editing) return;
  state.lastFocus = document.activeElement;
  state.isNew = !note;
  state.dirty = false;
  state.editRev = 0;
  state.saveSeq += 1;
  state.savePromise = null;
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }

  state.editing = note
    ? { ...note, tags: [...note.tags] }
    : {
      id: randomId(),
      userId: state.user.id,
      title: '',
      content: '',
      tags: [],
      color: 'default',
      pinned: false,
      archived: false,
      deleted: false,
      createdAt: null,
      updatedAt: null,
    };

  el.edTitle.value = state.editing.title;
  el.edContent.value = state.editing.content;
  el.tagInput.value = '';
  el.editorHeading.textContent = note ? 'تعديل الملاحظة' : 'ملاحظة جديدة';
  renderSwatches();
  renderEditorTags();
  syncEditorFlags();
  updateDeleteButton();
  updateEditorMeta();
  setSaveState(note ? 'saved' : 'draft');
  el.edContent.scrollTop = 0;
  el.editorBackdrop.hidden = false;
  syncBodyLock();

  window.setTimeout(() => {
    el.edTitle.focus();
    const length = el.edTitle.value.length;
    try { el.edTitle.setSelectionRange(length, length); } catch { /* ignore */ }
  }, 50);
}

function hideEditor() {
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  state.editing = null;
  state.dirty = false;
  state.isNew = false;
  state.savePromise = null;
  el.editorBackdrop.hidden = true;
  syncBodyLock();
  if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
    try { state.lastFocus.focus(); } catch { /* ignore */ }
  }
}

async function closeEditor() {
  if (!state.editing) return;
  const ok = await flushEditor();
  if (!ok) return;
  const wasNew = state.isNew;
  const empty = editorIsEmpty();
  hideEditor();
  if (wasNew && empty) setSaveState('draft');
}

function addEditorTag(raw) {
  const ed = state.editing;
  if (!ed) return;
  const tag = String(raw || '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!tag) return;
  if (ed.tags.length >= 10) {
    toast('يمكنك إضافة 10 وسوم كحد أقصى.', { type: 'danger' });
    return;
  }
  if (ed.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
    el.tagInput.value = '';
    return;
  }
  ed.tags.push(tag);
  el.tagInput.value = '';
  renderEditorTags();
  markDirty();
}

function removeEditorTag(tag) {
  const ed = state.editing;
  if (!ed) return;
  ed.tags = ed.tags.filter((existing) => existing !== tag);
  renderEditorTags();
  markDirty();
}

function toggleEditorFlag(flag) {
  const ed = state.editing;
  if (!ed || ed.deleted) return;
  ed[flag] = !ed[flag];
  syncEditorFlags();
  markDirty();
}

async function handleEditorDelete() {
  const ed = state.editing;
  if (!ed) return;

  if (ed.deleted) {
    const ok = await askConfirm({
      title: 'حذف الملاحظة نهائيًا؟',
      text: 'ستُحذف هذه الملاحظة من قاعدة البيانات المحلية ولا يمكن استعادتها.',
      ok: 'حذف نهائي',
    });
    if (!ok) return;
    try {
      await deleteNoteRecord(ed.id);
      state.notes = state.notes.filter((note) => note.id !== ed.id);
      hideEditor();
      render();
      toast('حُذفت الملاحظة نهائيًا.');
    } catch {
      toast('تعذّر حذف الملاحظة.', { type: 'danger' });
    }
    return;
  }

  if (state.isNew && editorIsEmpty()) {
    hideEditor();
    return;
  }

  collectEditor();
  ed.deleted = true;
  ed.updatedAt = new Date().toISOString();
  state.dirty = true;
  const ok = await saveEditor();
  if (!ok) return;
  hideEditor();
  render();
  toast('نُقلت الملاحظة إلى سلة المهملات.', {
    actionLabel: 'استعادة',
    onAction: () => { void restoreNote(ed); },
  });
}
/* ---------- التنقل والعرض ---------- */
function syncNavActive() {
  $$('.nav-item').forEach((item) => {
    const active = item.dataset.filter === state.filter;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

function syncViewButtons() {
  $$('.view-btn').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncSearchClear() {
  if (!el.searchClear) return;
  el.searchClear.hidden = !el.searchInput.value;
}

function setView(view) {
  state.view = view === 'list' ? 'list' : 'grid';
  try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* ignore */ }
  syncViewButtons();
  render();
}

function setSort(sort) {
  state.sort = ['updated', 'created', 'title'].includes(sort) ? sort : 'updated';
  try { localStorage.setItem(SORT_KEY, state.sort); } catch { /* ignore */ }
  if (el.sortSelect) el.sortSelect.value = state.sort;
  render();
}

function setFilter(filter, { close = true } = {}) {
  state.filter = FILTER_META[filter] ? filter : 'all';
  state.tag = null;
  if (el.searchInput) el.searchInput.value = state.search;
  syncNavActive();
  syncSearchClear();
  render();
  if (close) closeSidebar();
}

function clearSearch() {
  state.search = '';
  if (el.searchInput) {
    el.searchInput.value = '';
    el.searchInput.focus();
  }
  syncSearchClear();
  render();
}

function clearTag() {
  state.tag = null;
  if (state.filter !== 'trash' && state.filter !== 'archived') state.filter = 'all';
  syncNavActive();
  render();
}

function resetFilters() {
  state.filter = 'all';
  state.tag = null;
  state.search = '';
  if (el.searchInput) el.searchInput.value = '';
  syncNavActive();
  syncSearchClear();
  render();
}

/* ---------- ثبات التغييرات على الملاحظات ---------- */
async function persistNote(note, { message = '', toastOptions = {} } = {}) {
  if (!note || !state.user) return false;
  try {
    const snapshot = { ...note, updatedAt: new Date().toISOString() };
    await saveNote(state.key, snapshot);
    const index = state.notes.findIndex((item) => item.id === snapshot.id);
    if (index >= 0) state.notes[index] = snapshot;
    else state.notes.push(snapshot);
    render();
    if (message) toast(message, toastOptions);
    return true;
  } catch {
    toast('تعذّر حفظ التغييرات. تحقق من مساحة التخزين وحاول مرة أخرى.', { type: 'danger' });
    return false;
  }
}

async function restoreNote(note) {
  if (!note || !state.user) return;
  await persistNote(
    { ...note, deleted: false, archived: false },
    { message: 'استُعيدت الملاحظة إلى مساحتك.' }
  );
}

async function handleNoteAction(note, action) {
  if (!note || !state.user) return;

  if (action === 'pin') {
    const pinned = !note.pinned;
    await persistNote(
      { ...note, pinned, archived: pinned ? false : note.archived },
      { message: pinned ? 'ثُبّتت الملاحظة في المقدمة.' : 'أُلغي تثبيت الملاحظة.' }
    );
    return;
  }

  if (action === 'archive') {
    await persistNote(
      { ...note, archived: true, pinned: false },
      {
        message: 'أُرشفت الملاحظة.',
        toastOptions: { actionLabel: 'تراجع', onAction: () => { void restoreNote(note); } },
      }
    );
    return;
  }

  if (action === 'delete') {
    await persistNote(
      { ...note, deleted: true, pinned: false },
      {
        message: 'نُقلت الملاحظة إلى سلة المهملات.',
        toastOptions: { actionLabel: 'استعادة', onAction: () => { void restoreNote(note); } },
      }
    );
    return;
  }

  if (action === 'restore') {
    await restoreNote(note);
    return;
  }

  if (action === 'purge') {
    const ok = await askConfirm({
      title: 'حذف الملاحظة نهائيًا؟',
      text: 'ستُحذف هذه الملاحظة من قاعدة البيانات المحلية ولا يمكن استعادتها.',
      ok: 'حذف نهائي',
    });
    if (!ok) return;
    try {
      await deleteNoteRecord(note.id);
      state.notes = state.notes.filter((item) => item.id !== note.id);
      render();
      toast('حُذفت الملاحظة نهائيًا.');
    } catch {
      toast('تعذّر حذف الملاحظة.', { type: 'danger' });
    }
  }
}

/* ---------- النسخ الاحتياطي ---------- */
function readFileText(file) {
  return new Promise((resolve, reject) => {
    if (typeof file.text === 'function') {
      file.text().then(resolve, reject);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function backupDateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function normalizeImportedNote(raw, fallbackDate) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title === undefined || raw.title === null ? '' : raw.title).slice(0, 120);
  const content = String(raw.content === undefined || raw.content === null ? '' : raw.content).slice(0, 100000);
  const tags = Array.isArray(raw.tags)
    ? raw.tags
      .map((tag) => String(tag).replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 24))
      .filter(Boolean)
      .slice(0, 10)
    : [];
  if (!title.trim() && !content.trim() && !tags.length) return null;
  return {
    id: randomId(),
    userId: state.user.id,
    title,
    content,
    tags,
    color: COLORS.includes(raw.color) ? raw.color : 'default',
    pinned: !!raw.pinned,
    archived: !!raw.archived,
    deleted: !!raw.deleted,
    createdAt: validNoteDate(raw.createdAt, fallbackDate),
    updatedAt: validNoteDate(raw.updatedAt, fallbackDate),
  };
}

async function exportBackup() {
  if (!state.user) return;
  const ok = await askConfirm({
    title: 'تنزيل نسخة احتياطية؟',
    text: 'سيُنزّل ملف JSON يحتوي على ملاحظاتك بصيغة نصية مقروءة. احفظه في مكان آمن ولا تشاركه مع أحد.',
    ok: 'تنزيل النسخة',
    danger: false,
  });
  if (!ok) return;

  try {
    const payload = {
      app: 'malhazati',
      version: 1,
      exportedAt: new Date().toISOString(),
      user: { name: state.user.name, email: state.user.email },
      notes: state.notes.map((note) => ({
        id: note.id,
        title: note.title,
        content: note.content,
        tags: [...note.tags],
        color: note.color,
        pinned: !!note.pinned,
        archived: !!note.archived,
        deleted: !!note.deleted,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `malhazati-backup-${backupDateStamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('تم تنزيل النسخة الاحتياطية.');
  } catch {
    toast('تعذّر إنشاء النسخة الاحتياطية.', { type: 'danger' });
  }
}

async function importBackup(file) {
  if (!file || !state.user) return;
  if (file.size > 15 * 1024 * 1024) {
    toast('الملف كبير جدًا. الحد الأقصى 15 ميغابايت.', { type: 'danger' });
    return;
  }

  let data;
  try {
    data = JSON.parse(await readFileText(file));
  } catch {
    toast('تعذّر قراءة الملف. تأكد من أنه نسخة احتياطية صالحة.', { type: 'danger' });
    return;
  }

  if (!data || !Array.isArray(data.notes)) {
    toast('الملف لا يحتوي على نسخة احتياطية معروفة.', { type: 'danger' });
    return;
  }

  const now = new Date().toISOString();
  const existing = new Set(state.notes.map((note) => `${String(note.title || '').trim()}\u0000${note.createdAt}`));
  const candidates = [];
  let skipped = 0;

  data.notes.forEach((raw) => {
    const note = normalizeImportedNote(raw, now);
    if (!note) return;
    const key = `${String(note.title || '').trim()}\u0000${note.createdAt}`;
    if (existing.has(key)) {
      skipped += 1;
      return;
    }
    existing.add(key);
    candidates.push(note);
  });

  if (!candidates.length) {
    toast(skipped ? 'كل ملاحظات النسخة موجودة لديك مسبقًا.' : 'لا توجد ملاحظات صالحة في الملف.', {
      type: skipped ? 'success' : 'danger',
    });
    return;
  }

  const ok = await askConfirm({
    title: 'استيراد النسخة الاحتياطية؟',
    text: `سيُضاف ${formatNum(candidates.length)} ملاحظة إلى حسابك الحالي${skipped ? `، وسيُتجاوز ${formatNum(skipped)} عنصرًا مكررًا` : ''}. لن تُحذف ملاحظاتك الحالية.`,
    ok: 'استيراد',
    danger: false,
  });
  if (!ok) return;

  let imported = 0;
  for (const note of candidates) {
    try {
      await saveNote(state.key, note);
      state.notes.push(note);
      imported += 1;
    } catch { /* نتابع بقية العناصر */ }
  }

  render();
  if (imported > 0) {
    toast(`تم استيراد ${formatNum(imported)} ملاحظة بنجاح.`);
  } else {
    toast('تعذّر استيراد الملاحظات. تحقق من مساحة التخزين.', { type: 'danger' });
  }
}

/* ---------- إجراءات الإعدادات ---------- */
async function emptyTrash() {
  if (!state.user) return;
  const trashed = state.notes.filter((note) => note.deleted);
  if (!trashed.length) {
    toast('سلة المهملات فارغة بالفعل.');
    return;
  }
  const ok = await askConfirm({
    title: 'تفريغ سلة المهملات؟',
    text: `ستُحذف ${formatNum(trashed.length)} ملاحظة نهائيًا ولا يمكن استعادتها.`,
    ok: 'تفريغ السلة',
  });
  if (!ok) return;
  try {
    await deleteNoteRecords(trashed.map((note) => note.id));
    state.notes = state.notes.filter((note) => !note.deleted);
    render();
    toast('فُرّغت سلة المهملات.');
  } catch {
    toast('تعذّر تفريغ سلة المهملات.', { type: 'danger' });
  }
}

async function deleteAllNotes() {
  if (!state.user) return;
  if (!state.notes.length) {
    toast('لا توجد ملاحظات لحذفها.');
    return;
  }
  const ok = await askConfirm({
    title: 'حذف كل الملاحظات؟',
    text: `ستُحذف ${formatNum(state.notes.length)} ملاحظة نهائيًا من هذا الجهاز، بما فيها المؤرشفة وفي سلة المهملات.`,
    ok: 'حذف الكل',
  });
  if (!ok) return;
  try {
    await deleteAllUserNotes(state.user.id);
    state.notes = [];
    render();
    toast('حُذفت كل الملاحظات.');
  } catch {
    toast('تعذّر حذف الملاحظات.', { type: 'danger' });
  }
}

async function deleteCurrentAccount() {
  if (!state.user) return;
  const email = state.user.email || 'هذا الحساب';
  const ok = await askConfirm({
    title: 'حذف الحساب نهائيًا؟',
    text: `سيُحذف حساب «${email}» وكل ملاحظاته من هذا المتصفح. لا يمكن التراجع عن هذا الإجراء.`,
    ok: 'حذف الحساب',
  });
  if (!ok) return;
  try {
    await removeAccount(state.user.id);
    clearSession();
    closeSettings();
    showAuth();
    toast('حُذف الحساب وكل بياناته من هذا المتصفح.');
  } catch {
    toast('تعذّر حذف الحساب.', { type: 'danger' });
  }
}

async function lockApp() {
  if (!state.user) return;
  const ok = await flushEditor();
  if (!ok) return;
  hideEditor();
  closeSettings();
  clearSession();
  showAuth();
  toast('تم قفل التطبيق. سجّل الدخول للمتابعة.');
}

/* ---------- النوافذ ---------- */
let settingsLastFocus = null;

function openSettings() {
  if (!state.user) return;
  settingsLastFocus = document.activeElement;
  renderProfile();
  renderSettingsStats();
  applyTheme(state.theme);
  el.settingsBackdrop.hidden = false;
  syncBodyLock();
  window.setTimeout(() => el.settingsClose.focus(), 40);
}

function closeSettings() {
  if (el.settingsBackdrop.hidden) return;
  el.settingsBackdrop.hidden = true;
  syncBodyLock();
  if (settingsLastFocus && typeof settingsLastFocus.focus === 'function') {
    try { settingsLastFocus.focus(); } catch { /* ignore */ }
  }
  settingsLastFocus = null;
}

function closeSidebar() {
  if (!el.sidebar) return;
  el.sidebar.classList.remove('open');
  if (el.scrim) el.scrim.hidden = true;
}

function openSidebar() {
  if (!el.sidebar) return;
  el.sidebar.classList.add('open');
  if (el.scrim) el.scrim.hidden = false;
}

function closeAllModals() {
  if (confirmResolver) settleConfirm(false);
  el.editorBackdrop.hidden = true;
  el.settingsBackdrop.hidden = true;
  el.confirmBackdrop.hidden = true;
  state.editing = null;
  state.dirty = false;
  state.isNew = false;
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  syncBodyLock();
}

/* ---------- أحداث الواجهة ---------- */
function togglePasswordVisibility() {
  const showing = el.authPassword.type === 'text';
  el.authPassword.type = showing ? 'password' : 'text';
  el.authEye.setAttribute('aria-label', showing ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
  setUse(el.authEye, showing ? '#i-eye' : '#i-eye-off');
}

function updateEditorCounters() {
  collectEditor();
  updateEditorMeta();
  markDirty();
}

function handleEscape() {
  if (!el.confirmBackdrop.hidden) {
    settleConfirm(false);
    return;
  }
  if (!el.editorBackdrop.hidden) {
    void closeEditor();
    return;
  }
  if (!el.settingsBackdrop.hidden) {
    closeSettings();
    return;
  }
  if (el.sidebar && el.sidebar.classList.contains('open')) {
    closeSidebar();
    return;
  }
  if (!el.appView.hidden && el.searchInput.value) clearSearch();
}

function bindEvents() {
  /* المصادقة */
  $$('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      setAuthMode(tab.dataset.mode);
      const target = state.authMode === 'register' ? el.authName : el.authEmail;
      if (target) target.focus();
    });
  });
  el.authForm.addEventListener('submit', handleAuthSubmit);
  el.authEye.addEventListener('click', togglePasswordVisibility);
  el.authPassword.addEventListener('input', updateStrength);
  [el.authEmail, el.authPassword, el.authConfirm, el.authName].forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => { if (!el.authError.hidden) clearAuthError(); });
  });

  /* الشريط الجانبي */
  el.menuBtn.addEventListener('click', openSidebar);
  el.sideClose.addEventListener('click', closeSidebar);
  el.scrim.addEventListener('click', closeSidebar);
  el.userCard.addEventListener('click', openSettings);
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => setFilter(item.dataset.filter));
  });
  el.manageTagsBtn.addEventListener('click', () => {
    state.showAllTags = !state.showAllTags;
    renderTags(getCounts());
  });
  el.tagList.addEventListener('click', (event) => {
    const button = event.target.closest('.tag-item');
    if (!button) return;
    const tag = button.dataset.tag || '';
    state.tag = state.tag === tag ? null : tag;
    state.filter = 'all';
    state.search = '';
    if (el.searchInput) el.searchInput.value = '';
    syncNavActive();
    syncSearchClear();
    render();
    closeSidebar();
  });

  /* البحث والترتيب والعرض */
  let searchTimer = null;
  el.searchInput.addEventListener('input', () => {
    state.search = el.searchInput.value;
    syncSearchClear();
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      render();
    }, 90);
  });
  el.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (searchTimer) window.clearTimeout(searchTimer);
      render();
    }
  });
  el.searchClear.addEventListener('click', clearSearch);
  el.sortSelect.addEventListener('change', () => setSort(el.sortSelect.value));
  $$('.view-btn').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  el.filterChip.addEventListener('click', resetFilters);

  /* بطاقات الملاحظات */
  el.notesGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.note-card');
    if (!card) return;
    const note = state.notes.find((item) => item.id === card.dataset.id);
    if (!note) return;
    const actionButton = event.target.closest('[data-act]');
    if (actionButton) {
      event.stopPropagation();
      void handleNoteAction(note, actionButton.dataset.act);
      return;
    }
    openEditor(note);
  });
  el.notesGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.note-card');
    if (!card || event.target !== card) return;
    event.preventDefault();
    const note = state.notes.find((item) => item.id === card.dataset.id);
    if (note) openEditor(note);
  });

  /* إنشاء الملاحظات */
  [el.newNoteBtn, el.newNoteBtn2, el.fabNew].forEach((button) => {
    if (!button) return;
    button.addEventListener('click', () => {
      closeSidebar();
      openEditor(null);
    });
  });
  el.emptyBtn.addEventListener('click', () => {
    if (state.emptyAction === 'clear-search') clearSearch();
    else if (state.emptyAction === 'clear-tag') clearTag();
    else openEditor(null);
  });

  /* المظهر */
  el.themeToggle.addEventListener('click', toggleTheme);
  el.sideThemeBtn.addEventListener('click', toggleTheme);
  $$('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
  });

  /* المحرر */
  el.edClose.addEventListener('click', () => { void closeEditor(); });
  el.edDone.addEventListener('click', () => { void closeEditor(); });
  el.edDelete.addEventListener('click', () => { void handleEditorDelete(); });
  el.edPin.addEventListener('click', () => toggleEditorFlag('pinned'));
  el.edArchive.addEventListener('click', () => toggleEditorFlag('archived'));
  el.edTitle.addEventListener('input', updateEditorCounters);
  el.edContent.addEventListener('input', updateEditorCounters);
  el.edTitle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.edContent.focus();
    }
  });
  el.edContent.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void closeEditor();
    }
  });
  el.editorBackdrop.addEventListener('click', (event) => {
    if (event.target === el.editorBackdrop) void closeEditor();
  });
  el.edTags.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-tag]');
    if (!button) return;
    removeEditorTag(button.dataset.removeTag);
  });
  el.tagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '،') {
      event.preventDefault();
      addEditorTag(el.tagInput.value);
    } else if (event.key === 'Backspace' && !el.tagInput.value && state.editing && state.editing.tags.length) {
      event.preventDefault();
      removeEditorTag(state.editing.tags[state.editing.tags.length - 1]);
    }
  });
  el.tagInput.addEventListener('blur', () => {
    if (el.tagInput.value.trim()) addEditorTag(el.tagInput.value);
  });

  /* الإعدادات */
  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsClose.addEventListener('click', closeSettings);
  el.settingsBackdrop.addEventListener('click', (event) => {
    if (event.target === el.settingsBackdrop) closeSettings();
  });
  el.exportBtn.addEventListener('click', () => { void exportBackup(); });
  el.importBtn.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', () => {
    const file = el.importFile.files && el.importFile.files[0];
    el.importFile.value = '';
    if (file) void importBackup(file);
  });
  el.lockNowBtn.addEventListener('click', () => { void lockApp(); });
  el.lockBtn.addEventListener('click', () => { void lockApp(); });
  el.emptyTrashBtn.addEventListener('click', () => { void emptyTrash(); });
  el.deleteAllBtn.addEventListener('click', () => { void deleteAllNotes(); });
  el.deleteAccountBtn.addEventListener('click', () => { void deleteCurrentAccount(); });

  /* التأكيد */
  el.confirmCancel.addEventListener('click', () => settleConfirm(false));
  el.confirmOk.addEventListener('click', () => settleConfirm(true));
  el.confirmBackdrop.addEventListener('click', (event) => {
    if (event.target === el.confirmBackdrop) settleConfirm(false);
  });

  /* اختصارات لوحة المفاتيح */
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!el.confirmBackdrop.hidden || !el.editorBackdrop.hidden || !el.settingsBackdrop.hidden
        || (el.sidebar && el.sidebar.classList.contains('open')) || (!el.appView.hidden && el.searchInput.value)) {
        event.preventDefault();
        handleEscape();
      }
      return;
    }

    if (event.defaultPrevented) return;
    const target = event.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      if (el.appView.hidden) return;
      event.preventDefault();
      el.searchInput.focus();
      el.searchInput.select();
      return;
    }

    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (el.appView.hidden || !el.editorBackdrop.hidden || !el.settingsBackdrop.hidden) return;

    if (event.key === '/' ) {
      event.preventDefault();
      el.searchInput.focus();
      return;
    }

    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openEditor(null);
    }
  });

  /* حفظ تلقائي قبل إخفاء الصفحة */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.editing) void flushEditor();
  });

  /* إغلاق الشريط الجانبي عند العودة إلى سطح المكتب */
  const wideQuery = window.matchMedia('(min-width: 941px)');
  const handleWide = (event) => { if (event.matches) closeSidebar(); };
  if (wideQuery.addEventListener) wideQuery.addEventListener('change', handleWide);
}

/* ---------- الإقلاع ---------- */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;
  try {
    const url = new URL('./sw.js', import.meta.url);
    const registration = await navigator.serviceWorker.register(url.href, { scope: './' });
    window.setTimeout(() => { registration.update().catch(() => {}); }, 5000);
  } catch { /* التطبيق يعمل حتى دون عامل الخدمة */ }
}

async function boot() {
  cacheElements();
  state.sort = ['updated', 'created', 'title'].includes(state.sort) ? state.sort : 'updated';
  state.view = state.view === 'list' ? 'list' : 'grid';
  state.theme = ['light', 'dark', 'system'].includes(state.theme) ? state.theme : 'system';

  buildSwatches();
  applyTheme(state.theme);
  if (el.sortSelect) el.sortSelect.value = state.sort;
  syncViewButtons();
  bindEvents();

  try {
    checkSupport();
  } catch (error) {
    showFatal(error);
    return;
  }

  try {
    if (navigator.storage && navigator.storage.persist) void navigator.storage.persist().catch(() => {});
  } catch { /* ignore */ }

  const session = readSession();
  if (session && session.userId && session.keyB64) {
    try {
      const user = await getUser(session.userId);
      if (!user) throw new Error('NO_USER');
      const keyBytes = b64ToBytes(session.keyB64);
      if (!keyBytes || keyBytes.length !== 32) throw new Error('BAD_KEY');
      state.user = user;
      state.key = await importKeyBytes(keyBytes);
      state.keyB64 = session.keyB64;
      await enterApp(user);
      void registerServiceWorker();
      return;
    } catch {
      clearSession();
    }
  }

  showAuth();
  void registerServiceWorker();
}

void boot();
