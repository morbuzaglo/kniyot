// לוגיקת הרשימות: יצירה, פריטים, סטטוסים, מועדפים, היסטוריה ותמונות שמורות.
import { db, uid, getMeta, setMeta } from './db.js';
import { dept } from './categories.js';

export const ACTIVE_NAME = 'הקנייה הקרובה';

// ---------- אתחול ----------
export async function ensureDefaults() {
  const lists = await db.all('lists');
  if (!lists.length) {
    const now = Date.now();
    const active = { id: uid(), name: ACTIVE_NAME, kind: 'list', archived: false, createdAt: now, updatedAt: now };
    await db.putMany('lists', [
      active,
      { id: uid(), name: 'קנייה שבועית', kind: 'template', archived: false, createdAt: now, updatedAt: now },
      { id: uid(), name: 'אירוח', kind: 'template', archived: false, createdAt: now, updatedAt: now },
    ]);
    await setMeta('activeListId', active.id);
  }
  let activeId = await getMeta('activeListId');
  const act = activeId && (await db.get('lists', activeId));
  if (!act || act.archived || act.kind !== 'list') {
    const cand = (await db.all('lists')).find((l) => l.kind === 'list' && !l.archived);
    if (cand) activeId = cand.id;
    else {
      const l = await createList(ACTIVE_NAME);
      activeId = l.id;
    }
    await setMeta('activeListId', activeId);
  }
  return activeId;
}

export const activeListId = () => getMeta('activeListId');
export const setActiveList = (id) => setMeta('activeListId', id);

// ---------- רשימות ----------
export async function createList(name, kind = 'list') {
  const now = Date.now();
  const l = { id: uid(), name: name || 'רשימה חדשה', kind, archived: false, createdAt: now, updatedAt: now };
  await db.put('lists', l);
  return l;
}

export async function allLists() {
  const [lists, items] = await Promise.all([db.all('lists'), db.all('items')]);
  const stats = {};
  for (const it of items) {
    const s = (stats[it.listId] ||= { total: 0, done: 0 });
    s.total++;
    if (it.status !== 'open') s.done++;
  }
  return lists
    .map((l) => ({ ...l, stats: stats[l.id] || { total: 0, done: 0 } }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getList = (id) => db.get('lists', id);

export async function updateList(id, patch) {
  const l = await db.get('lists', id);
  if (!l) return;
  Object.assign(l, patch, { updatedAt: Date.now() });
  await db.put('lists', l);
  return l;
}

/** שכפול רשימה (גם "רשימה חדשה מקנייה קודמת" ו"שמור כתבנית"). הסטטוסים מתאפסים. */
export async function duplicateList(id, { name, kind = 'list' } = {}) {
  const src = await db.get('lists', id);
  const items = await listItems(id);
  const l = await createList(name || src.name + ' (עותק)', kind);
  l.fromListId = id;
  await db.put('lists', l);
  await db.putMany('items', items.map((it) => ({ ...it, id: uid(), listId: l.id, status: 'open', doneAt: null })));
  return l;
}

/** מחיקת רשימה. מחזיר נתונים לשחזור (ביטול). */
export async function deleteList(id) {
  const list = await db.get('lists', id);
  const items = await listItems(id);
  await db.tx(['lists', 'items'], 'readwrite', (t) => {
    t.objectStore('lists').delete(id);
    const s = t.objectStore('items');
    items.forEach((i) => s.delete(i.id));
  });
  return { list, items };
}
export async function restoreList({ list, items }) {
  await db.put('lists', list);
  await db.putMany('items', items);
}

// ---------- פריטים ----------
export async function listItems(listId) {
  const items = await db.byIndex('items', 'listId', listId);
  return items.sort((a, b) => a.addedAt - b.addedAt);
}

export function snapshotOf(p) {
  return {
    name: p.name,
    brand: p.brand || '',
    sizeText: p.size?.text || p.sizeText || '',
    cat: p.cat || 'other',
    barcode: p.barcode || '',
    img: p.img || null,          // כתובת התמונה בקטלוג (אם יש)
    imgKey: p.imgKey || null,    // מפתח התמונה השמורה ב-IndexedDB
  };
}

/** הוספת מוצר לרשימה. אם המוצר כבר ברשימה — מגדיל כמות. */
export async function addToList(listId, product, { qty = 1, unit = null, note = '' } = {}) {
  const items = await listItems(listId);
  const existing = items.find((i) => i.productKey === product.key && i.status === 'open');
  let item;
  if (existing) {
    existing.qty = round(existing.qty + qty);
    if (note && !existing.note.includes(note)) existing.note = (existing.note ? existing.note + ' · ' : '') + note;
    item = existing;
  } else {
    item = {
      id: uid(), listId, productKey: product.key,
      snapshot: snapshotOf(product),
      qty, unit: unit || defaultUnit(product), note, subst: 'ask',
      status: 'open', addedAt: Date.now(), doneAt: null,
    };
  }
  await db.put('items', item);
  await touch(listId);
  await bumpHistory(product);
  if (!item.snapshot.imgKey && product.img) cacheImage(product.img).then(async (k) => {
    if (!k) return;
    const fresh = await db.get('items', item.id);
    if (fresh) { fresh.snapshot.imgKey = k; await db.put('items', fresh); }
  });
  return { item, wasExisting: !!existing };
}

export function defaultUnit(p) {
  if (p.weighted) return 'kg';
  return 'unit';
}

export const UNITS = { unit: 'יח׳', kg: 'ק״ג', g: 'גרם', pack: 'אריזות', l: 'ליטר' };

export function round(x) { return Math.round(x * 100) / 100; }

export async function updateItem(id, patch) {
  const it = await db.get('items', id);
  if (!it) return null;
  const before = structuredClone(it);
  Object.assign(it, patch);
  if ('status' in patch) it.doneAt = patch.status === 'open' ? null : Date.now();
  await db.put('items', it);
  await touch(it.listId);
  return { before, after: it };
}

export async function removeItem(id) {
  const it = await db.get('items', id);
  await db.del('items', id);
  if (it) await touch(it.listId);
  return it;
}
export const restoreItem = (it) => db.put('items', it).then(() => touch(it.listId));

async function touch(listId) {
  const l = await db.get('lists', listId);
  if (l) { l.updatedAt = Date.now(); await db.put('lists', l); }
}

/** קיבוץ פריטים לפי מחלקות בסדר הסופר. */
export function groupByDept(items) {
  const groups = new Map();
  for (const it of items) {
    const d = dept(it.snapshot.cat);
    if (!groups.has(d.id)) groups.set(d.id, { dept: d, items: [] });
    groups.get(d.id).items.push(it);
  }
  return [...groups.values()].sort((a, b) => a.dept.order - b.dept.order);
}

// ---------- מועדפים והיסטוריה ----------
export async function toggleFavorite(product) {
  const f = await db.get('favorites', product.key);
  if (f) { await db.del('favorites', product.key); return false; }
  await db.put('favorites', { productKey: product.key, snapshot: snapshotOf(product), addedAt: Date.now() });
  if (product.img) cacheImage(product.img);
  return true;
}
export const favorites = () => db.all('favorites').then((f) => f.sort((a, b) => b.addedAt - a.addedAt));

async function bumpHistory(product) {
  const h = (await db.get('history', product.key)) || { productKey: product.key, count: 0 };
  h.count++;
  h.lastAt = Date.now();
  h.snapshot = snapshotOf(product);
  await db.put('history', h);
}
export async function history() {
  const h = await db.all('history');
  return {
    recent: [...h].sort((a, b) => b.lastAt - a.lastAt).slice(0, 20),
    frequent: h.filter((x) => x.count >= 2).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 20),
  };
}

// ---------- תמונות ----------
// תמונות של פריטים ברשימות נשמרות כ-Blob ב-IndexedDB כדי שיהיו זמינות ללא אינטרנט
// וכדי שאפשר יהיה לצייר אותן על canvas בשיתוף (אותו מקור — אין "זיהום" של ה-canvas).
const urlCache = new Map();

export async function cacheImage(url) {
  const key = 'c:' + url;
  try {
    if (await db.get('images', key)) return key;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    await db.put('images', { key, blob, type: blob.type, source: 'catalog', url, savedAt: Date.now() });
    return key;
  } catch {
    return null;
  }
}

export async function saveUserImage(blob) {
  const key = 'u:' + uid();
  await db.put('images', { key, blob, type: blob.type, source: 'user', savedAt: Date.now() });
  return key;
}

export async function getImageBlob(key) {
  if (!key) return null;
  const r = await db.get('images', key);
  return r ? r.blob : null;
}

/** כתובת להצגת תמונה: קודם עותק מקומי, אחרת כתובת הקטלוג. */
export async function imageURL(snapshotOrProduct) {
  const key = snapshotOrProduct.imgKey || (snapshotOrProduct.img ? 'c:' + snapshotOrProduct.img : null);
  if (key) {
    if (urlCache.has(key)) return urlCache.get(key);
    const b = await getImageBlob(key);
    if (b) {
      const u = URL.createObjectURL(b);
      urlCache.set(key, u);
      return u;
    }
  }
  return snapshotOrProduct.img || null;
}

/** ניקוי תמונות קטלוג שאינן בשימוש באף רשימה/מועדף. */
export async function pruneImages() {
  const [imgs, items, favs, custom] = await Promise.all([db.all('images'), db.all('items'), db.all('favorites'), db.all('custom')]);
  const used = new Set();
  for (const it of items) { if (it.snapshot.imgKey) used.add(it.snapshot.imgKey); if (it.snapshot.img) used.add('c:' + it.snapshot.img); }
  for (const f of favs) { if (f.snapshot.imgKey) used.add(f.snapshot.imgKey); if (f.snapshot.img) used.add('c:' + f.snapshot.img); }
  for (const c of custom) if (c.imgKey) used.add(c.imgKey);
  let n = 0;
  for (const im of imgs) if (!used.has(im.key)) { await db.del('images', im.key); n++; }
  return n;
}

// ---------- מוצרים אישיים ----------
export const customProducts = () => db.all('custom');
export async function saveCustom(prod) {
  if (!prod.id) prod.id = uid();
  prod.updated = new Date().toISOString();
  await db.put('custom', prod);
  return prod;
}
export const deleteCustom = (id) => db.del('custom', id);
