// שכבת אחסון מקומית (IndexedDB). כל המידע האישי נשאר במכשיר.
const DB_NAME = 'kniyot';
const DB_VERSION = 1;
export const STORES = ['lists', 'items', 'images', 'custom', 'favorites', 'history', 'meta'];

let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('listId', 'listId');
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('custom')) db.createObjectStore('custom', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'productKey' });
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'productKey' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbp;
}

function p(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, (e) => { try { t.abort(); } catch {} reject(e); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

export const db = {
  get: (store, key) => tx([store], 'readonly', (t) => p(t.objectStore(store).get(key))),
  all: (store) => tx([store], 'readonly', (t) => p(t.objectStore(store).getAll())),
  put: (store, val) => tx([store], 'readwrite', (t) => p(t.objectStore(store).put(val))),
  del: (store, key) => tx([store], 'readwrite', (t) => p(t.objectStore(store).delete(key))),
  byIndex: (store, index, value) => tx([store], 'readonly', (t) => p(t.objectStore(store).index(index).getAll(value))),
  putMany: (store, vals) => tx([store], 'readwrite', (t) => { const s = t.objectStore(store); vals.forEach((v) => s.put(v)); }),
  clear: (store) => tx([store], 'readwrite', (t) => p(t.objectStore(store).clear())),
  tx,
};

export async function getMeta(key, dflt = null) {
  const r = await db.get('meta', key);
  return r ? r.value : dflt;
}
export function setMeta(key, value) {
  return db.put('meta', { key, value });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** בקשת אחסון קבוע (Safari 17+; ניתן בדרך כלל לאפליקציה שנוספה למסך הבית). */
export async function storageStatus() {
  const s = { persisted: null, usage: null, quota: null };
  try { if (navigator.storage?.persisted) s.persisted = await navigator.storage.persisted(); } catch {}
  try { if (navigator.storage?.estimate) Object.assign(s, await navigator.storage.estimate()); } catch {}
  return s;
}
export async function requestPersist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
