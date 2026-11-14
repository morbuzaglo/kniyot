// מקורות הקטלוג. כל מקור מחזיר רשימת קבצים להורדה ופונקציית הורדה.
// שופרסל: אתר המחירים הציבורי (prices.shufersal.co.il).
// רמי לוי, אושר עד: שרת הפרסום המשותף publishedprices.co.il (Cerberus), עם משתמש ציבורי ללא סיסמה
//   כפי שהרשתות מפרסמות לצורך חוק שקיפות המחירים.
// הערה: מבנה האתרים מבוסס על התיעוד/הקוד הפתוח המוכר להם; לא ניתן היה לאמת אותו מסביבת הפיתוח (חסומה לרשת).
import fs from 'node:fs/promises';
import path from 'node:path';
import { http, CookieJar } from '../lib/http.mjs';

export const SOURCES = {
  shufersal: { id: 'shufersal', name: 'שופרסל', kind: 'shufersal', home: 'https://prices.shufersal.co.il/' },
  ramilevy: { id: 'ramilevy', name: 'רמי לוי', kind: 'cerberus', user: 'RamiLevi', home: 'https://url.publishedprices.co.il/' },
  osherad: { id: 'osherad', name: 'אושר עד', kind: 'cerberus', user: 'osherad', home: 'https://url.publishedprices.co.il/' },
};

const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"');

/** בוחר את קובץ ה-PriceFull העדכני ביותר לכל סניף, עד maxStores סניפים. */
function pickLatestPerStore(names, maxStores) {
  const byStore = new Map();
  for (const n of names) {
    const m = n.name.match(/PriceFull(\d+)-(\d+)-(\d+)/i);
    if (!m) continue;
    const store = m[1] + '-' + m[2];
    const ts = m[3];
    if (!byStore.has(store) || byStore.get(store).ts < ts) byStore.set(store, { ...n, ts, store });
  }
  // סניפים עם הקבצים הגדולים ביותר (יותר מוצרים) קודם, אם יש מידע על גודל
  return [...byStore.values()].sort((a, b) => (b.size || 0) - (a.size || 0) || b.ts.localeCompare(a.ts)).slice(0, maxStores);
}

// ---------- שופרסל ----------
async function listShufersal({ maxStores, maxPages = 30 }) {
  const files = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=0&page=${page}`;
    const html = await (await http(url)).text();
    const links = [...html.matchAll(/href="(https:\/\/[^"]+PriceFull[^"]+)"/gi)].map((m) => decodeHtml(m[1]));
    if (!links.length) break;
    for (const l of links) files.push({ url: l, name: decodeURIComponent(l.split('?')[0].split('/').pop()) });
    if (pickLatestPerStore(files, maxStores).length >= maxStores && page >= 2) break;
  }
  if (!files.length) throw new Error('לא נמצאו קישורי PriceFull בעמוד (ייתכן שמבנה האתר השתנה)');
  return pickLatestPerStore(files, maxStores);
}

// ---------- Cerberus (publishedprices.co.il) ----------
async function cerberusSession(user) {
  const base = 'https://url.publishedprices.co.il';
  const jar = new CookieJar();
  const loginPage = await (await http(base + '/login', { jar })).text();
  const token = (loginPage.match(/name="csrftoken"\s+(?:value|content)="([^"]+)"/) || loginPage.match(/csrftoken"\s*content="([^"]+)"/) || [])[1];
  if (!token) throw new Error('לא נמצא csrftoken בעמוד הכניסה');
  const form = new URLSearchParams({ r: '', username: user, password: '', Submit: 'Sign in', csrftoken: token });
  await http(base + '/login/user', { method: 'POST', jar, body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const filePage = await (await http(base + '/file', { jar })).text();
  const token2 = (filePage.match(/name="csrftoken"\s+(?:value|content)="([^"]+)"/) || [])[1] || token;
  if (/login/i.test(filePage.slice(0, 2000)) && !/file\/json\/dir/.test(filePage)) throw new Error(`הכניסה עם המשתמש הציבורי "${user}" נכשלה`);
  return { base, jar, token: token2 };
}

async function listCerberus(src, { maxStores }) {
  const s = await cerberusSession(src.user);
  const form = new URLSearchParams({ sEcho: '1', iColumns: '5', iDisplayStart: '0', iDisplayLength: '100000', sSearch: 'PriceFull', cd: '/', csrftoken: s.token });
  const res = await http(s.base + '/file/json/dir', { method: 'POST', jar: s.jar, body: form, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' } });
  const json = await res.json();
  const rows = (json.aaData || []).map((r) => ({ name: r.fname || r.name, size: Number(r.size) || 0, url: s.base + '/file/d/' + encodeURIComponent(r.fname || r.name) }));
  if (!rows.length) throw new Error('רשימת הקבצים ריקה');
  const picked = pickLatestPerStore(rows, maxStores);
  return picked.map((p) => ({ ...p, jar: s.jar }));
}

export async function listFiles(id, opts) {
  const src = SOURCES[id];
  if (!src) throw new Error('מקור לא מוכר: ' + id);
  return src.kind === 'shufersal' ? listShufersal(opts) : listCerberus(src, opts);
}

export async function download(file) {
  const res = await http(file.url, { jar: file.jar, timeout: 180000 });
  return Buffer.from(await res.arrayBuffer());
}

// ---------- קבצים מקומיים (הורדה ידנית / בדיקות) ----------
// מבנה: <dir>/<chainId>/*.xml|*.gz   או   <dir>/<chainId>__שם.xml
export async function listLocal(dir) {
  const out = {};
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && SOURCES[e.name]) {
      for (const f of await fs.readdir(path.join(dir, e.name))) if (/\.(xml|gz)$/i.test(f)) (out[e.name] ||= []).push(path.join(dir, e.name, f));
    } else if (e.isFile()) {
      const m = e.name.match(/^([a-z]+)__.+\.(xml|gz)$/i);
      if (m && SOURCES[m[1]]) (out[m[1]] ||= []).push(path.join(dir, e.name));
    }
  }
  return out;
}
