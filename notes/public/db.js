/* =========================================================
   ملاحظاتي — قاعدة البيانات المحلية (IndexedDB) والتشفير
   ---------------------------------------------------------
   • لا يوجد أي خادم: كل البيانات تبقى داخل هذا المتصفح.
   • كلمات المرور لا تُخزَّن أبدًا؛ يُخزَّن فقط مُتحقِّق PBKDF2.
   • محتوى كل ملاحظة يُشفَّر بـ AES-256-GCM بمفتاح مشتق من
     كلمة مرور صاحب الحساب، وعزل كامل بين المستخدمين.
   ========================================================= */

const DB_NAME = 'malhazati';
const DB_VERSION = 1;
const PBKDF2_ITERATIONS = 210000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------- أدوات ثنائية ---------- */
export function bytesToB64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function b64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function checkSupport() {
  if (typeof indexedDB === 'undefined') {
    const err = new Error('NO_IDB');
    err.code = 'NO_IDB';
    throw err;
  }
  if (!crypto || !crypto.subtle || !crypto.getRandomValues) {
    const err = new Error('NO_CRYPTO');
    err.code = 'NO_CRYPTO';
    throw err;
  }
}

/* ---------- فتح قاعدة البيانات ---------- */
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('users')) {
        const users = db.createObjectStore('users', { keyPath: 'id' });
        users.createIndex('emailKey', 'emailKey', { unique: true });
      }
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('userId', 'userId', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('DB_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('DB_BLOCKED'));
  });
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('DB_TX_FAILED'));
    tx.onabort = () => reject(tx.error || new Error('DB_TX_ABORTED'));
  });
}

/* ---------- اشتقاق المفاتيح ---------- */
export async function deriveMaterial(password, salt, iterations = PBKDF2_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password).normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      512
    )
  );
  return {
    verifier: bits.slice(0, KEY_BYTES),
    keyBytes: bits.slice(KEY_BYTES, KEY_BYTES * 2),
  };
}

export async function importKeyBytes(bytes) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* ---------- الحسابات ---------- */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function findUserByEmailKey(emailKey) {
  const db = await openDB();
  const tx = db.transaction('users', 'readonly');
  const request = tx.objectStore('users').index('emailKey').get(emailKey);
  return requestToPromise(request);
}

export async function getUser(userId) {
  const db = await openDB();
  const tx = db.transaction('users', 'readonly');
  const user = await requestToPromise(tx.objectStore('users').get(userId));
  return user ? publicUser(user) : null;
}

export async function createAccount({ name, email, password }) {
  checkSupport();
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanEmail = normalizeEmail(email);
  const emailKey = cleanEmail;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
    const err = new Error('INVALID_EMAIL');
    err.code = 'INVALID_EMAIL';
    throw err;
  }
  if (String(password || '').length < 8) {
    const err = new Error('WEAK_PASSWORD');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }

  const existing = await findUserByEmailKey(emailKey);
  if (existing) {
    const err = new Error('EMAIL_TAKEN');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }

  const salt = randomBytes(SALT_BYTES);
  const { verifier, keyBytes } = await deriveMaterial(password, salt);

  const user = {
    id: randomId(),
    name: cleanName,
    email: cleanEmail,
    emailKey,
    salt: bytesToB64(salt),
    verifier: bytesToB64(verifier),
    iterations: PBKDF2_ITERATIONS,
    createdAt: new Date().toISOString(),
  };

  const db = await openDB();
  const tx = db.transaction('users', 'readwrite');
  try {
    tx.objectStore('users').add(user);
    await transactionDone(tx);
  } catch (err) {
    if (err && err.name === 'ConstraintError') {
      const e = new Error('EMAIL_TAKEN');
      e.code = 'EMAIL_TAKEN';
      throw e;
    }
    throw err;
  }

  return { user: publicUser(user), keyBytes };
}

export async function authenticate(email, password) {
  checkSupport();
  const emailKey = normalizeEmail(email);
  const record = await findUserByEmailKey(emailKey);

  if (!record) {
    const err = new Error('INVALID_CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }

  const salt = b64ToBytes(record.salt);
  const { verifier, keyBytes } = await deriveMaterial(password, salt, record.iterations || PBKDF2_ITERATIONS);
  const stored = b64ToBytes(record.verifier);

  if (!constantTimeEqual(verifier, stored)) {
    const err = new Error('INVALID_CREDENTIALS');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }

  return { user: publicUser(record), keyBytes };
}

export async function deleteAccount(userId) {
  const db = await openDB();
  const tx = db.transaction(['users', 'notes'], 'readwrite');
  tx.objectStore('users').delete(userId);
  const notes = tx.objectStore('notes');
  const index = notes.index('userId');
  const cursorRequest = index.openCursor(IDBKeyRange.only(userId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await transactionDone(tx);
}

/* ---------- تشفير الملاحظات ---------- */
export async function sealNote(key, note) {
  const iv = randomBytes(IV_BYTES);
  const payload = {
    title: String(note.title || '').slice(0, 120),
    content: String(note.content || '').slice(0, 100000),
    tags: Array.isArray(note.tags) ? note.tags.slice(0, 10).map((t) => String(t).slice(0, 24)) : [],
  };
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload))
  );
  return {
    iv: bytesToB64(iv),
    payload: bytesToB64(new Uint8Array(cipher)),
  };
}

export async function openNote(key, record) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(record.iv) },
    key,
    b64ToBytes(record.payload)
  );
  const data = JSON.parse(decoder.decode(new Uint8Array(plain)));
  return {
    id: record.id,
    userId: record.userId,
    color: record.color || 'default',
    pinned: !!record.pinned,
    archived: !!record.archived,
    deleted: !!record.deleted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    title: typeof data.title === 'string' ? data.title : '',
    content: typeof data.content === 'string' ? data.content : '',
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

/* ---------- عمليات الملاحظات ---------- */
export async function saveNote(key, note) {
  const sealed = await sealNote(key, note);
  const record = {
    id: note.id,
    userId: note.userId,
    color: note.color || 'default',
    pinned: !!note.pinned,
    archived: !!note.archived,
    deleted: !!note.deleted,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    iv: sealed.iv,
    payload: sealed.payload,
  };
  const db = await openDB();
  const tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').put(record);
  await transactionDone(tx);
  return record;
}

export async function getNoteRecords(userId) {
  const db = await openDB();
  const tx = db.transaction('notes', 'readonly');
  const request = tx.objectStore('notes').index('userId').getAll(IDBKeyRange.only(userId));
  const records = await requestToPromise(request);
  return Array.isArray(records) ? records : [];
}

export async function loadNotes(userId, key) {
  const records = await getNoteRecords(userId);
  const notes = [];
  let failed = 0;
  await Promise.all(
    records.map(async (record) => {
      try {
        notes.push(await openNote(key, record));
      } catch {
        failed += 1;
      }
    })
  );
  return { notes, failed };
}

export async function deleteNoteRecord(noteId) {
  const db = await openDB();
  const tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').delete(noteId);
  await transactionDone(tx);
}

export async function deleteNoteRecords(noteIds) {
  if (!noteIds.length) return;
  const db = await openDB();
  const tx = db.transaction('notes', 'readwrite');
  const store = tx.objectStore('notes');
  noteIds.forEach((id) => store.delete(id));
  await transactionDone(tx);
}

export async function deleteAllUserNotes(userId) {
  const db = await openDB();
  const tx = db.transaction('notes', 'readwrite');
  const index = tx.objectStore('notes').index('userId');
  const request = index.openCursor(IDBKeyRange.only(userId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await transactionDone(tx);
}

/* ---------- مساحة التخزين (تقريبية) ---------- */
export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
