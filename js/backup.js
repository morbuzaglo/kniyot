// גיבוי ושחזור: קובץ JSON אחד הכולל את כל המידע האישי והתמונות (base64),
// עם גרסת פורמט וסיכום ביקורת (SHA-256) לאימות תקינות.
import { db, STORES } from './db.js';

export const BACKUP_FORMAT = 'kniyot-backup';
export const BACKUP_VERSION = 1;
const DATA_STORES = STORES.filter((s) => s !== 'images');

function blobToB64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
}

async function sha256(str) {
  if (!crypto?.subtle) return null; // דורש HTTPS / localhost
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function exportBackup({ includeCatalogImages = true } = {}) {
  const data = {};
  for (const s of DATA_STORES) data[s] = await db.all(s);
  const images = [];
  for (const im of await db.all('images')) {
    if (!includeCatalogImages && im.source !== 'user') continue;
    images.push({ key: im.key, type: im.type, source: im.source, url: im.url || null, savedAt: im.savedAt, b64: await blobToB64(im.blob) });
  }
  const payload = { data, images };
  const body = JSON.stringify(payload);
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: { lists: data.lists.length, items: data.items.length, custom: data.custom.length, favorites: data.favorites.length, images: images.length },
    sha256: await sha256(body),
    payload,
  };
  const json = JSON.stringify(backup);
  const d = new Date();
  const name = `גיבוי-קניות-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  return new File([json], name, { type: 'application/json' });
}

/** בודק קובץ גיבוי בלי לכתוב דבר. זורק שגיאה בעברית אם הקובץ פגום. */
export async function inspectBackup(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { throw new Error('הקובץ אינו JSON תקין'); }
  if (obj?.format !== BACKUP_FORMAT) throw new Error('זה אינו קובץ גיבוי של האפליקציה');
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) throw new Error(`גרסת גיבוי ${obj.version} אינה נתמכת בגרסה זו של האפליקציה`);
  const pl = obj.payload;
  if (!pl || typeof pl !== 'object' || !pl.data || !Array.isArray(pl.images)) throw new Error('מבנה הגיבוי חסר');
  for (const s of DATA_STORES) if (!Array.isArray(pl.data[s])) throw new Error(`חסר בגיבוי: ${s}`);
  if (obj.sha256) {
    const h = await sha256(JSON.stringify(pl));
    if (h && h !== obj.sha256) throw new Error('סיכום הביקורת אינו תואם — הקובץ השתנה או נפגם');
  }
  for (const it of pl.data.items) if (!it.id || !it.listId || !it.snapshot) throw new Error('פריט פגום בגיבוי');
  for (const im of pl.images) if (!im.key || typeof im.b64 !== 'string') throw new Error('תמונה פגומה בגיבוי');
  return { backup: obj, counts: obj.counts, exportedAt: obj.exportedAt, verified: !!obj.sha256 };
}

/** שחזור: mode='replace' מוחק את המידע הקיים ומחליף; mode='merge' מוסיף/דורס לפי מזהה. */
export async function restoreBackup(backup, mode = 'replace') {
  const pl = backup.payload;
  const images = pl.images.map((im) => ({ key: im.key, type: im.type, source: im.source, url: im.url, savedAt: im.savedAt, blob: b64ToBlob(im.b64, im.type || 'image/jpeg') }));
  await db.tx(STORES, 'readwrite', (t) => {
    for (const s of STORES) {
      const st = t.objectStore(s);
      if (mode === 'replace') st.clear();
      const rows = s === 'images' ? images : pl.data[s];
      for (const r of rows) st.put(r);
    }
  });
}
