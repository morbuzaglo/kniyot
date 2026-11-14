// תמונות מוצר לפי ברקוד משרת התמונות הציבורי של רמי לוי (img.rami-levy.co.il).
// robots.txt של השרת מתיר במפורש את /product/, והשרת מאפשר CORS (Access-Control-Allow-Origin: *).
// התמונות לא מועתקות ולא מתארחות אצלנו: הקטלוג שומר רק את הכתובת, והאייפון טוען אותה ישירות.
// כאן רק בודקים אילו ברקודים באמת יש להם תמונה, כדי לא להציג תמונות שבורות.
import fs from 'node:fs/promises';
import path from 'node:path';
import { UA, sleep } from './http.mjs';

export const rlImageUrl = (barcode) => `https://img.rami-levy.co.il/product/${barcode}/small.jpg`;

export async function attachRamiLevyImages(db, { cacheFile, limit = 30000, concurrency = 2, recheckDays = 30, log = console.log, errors = [] }) {
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')); } catch {}
  const now = Date.now();
  const st = { checked: 0, fromCache: 0, found: 0, missing: 0, failed: 0 };
  const todo = [];
  for (const p of Object.values(db.products)) {
    if (!p.barcode) continue;
    const c = cache[p.barcode];
    if (c && (c.ok || now - c.at < recheckDays * 86400e3)) {
      st.fromCache++;
      if (c.ok) setImg(p);
      continue;
    }
    todo.push(p);
  }
  const queue = todo.slice(0, limit);
  let consecutiveFail = 0, stop = false;
  async function worker() {
    while (queue.length && !stop) {
      const p = queue.shift();
      try {
        const r = await fetch(rlImageUrl(p.barcode), { method: 'HEAD', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
        if (r.status === 200 && (r.headers.get('content-type') || '').startsWith('image/')) {
          cache[p.barcode] = { ok: 1, at: now };
          setImg(p);
          st.found++;
        } else if (r.status === 403 || r.status === 404) {
          cache[p.barcode] = { ok: 0, at: now };   // אין תמונה (השרת מחזיר 403 לקובץ שלא קיים)
          st.missing++;
        } else if (r.status === 429 || r.status >= 500) {
          throw new Error('HTTP ' + r.status);
        }
        st.checked++;
        consecutiveFail = 0;
      } catch (e) {
        st.failed++;
        if (++consecutiveFail >= 10) { stop = true; errors.push({ source: 'rami-levy-images', error: 'הופסק אחרי כשלונות רצופים: ' + e.message }); }
        await sleep(3000);
      }
      await sleep(400);
      if (st.checked && st.checked % 2000 === 0) { log(`  תמונות רמי לוי: ${st.checked} נבדקו…`); await save(); }
    }
  }
  async function save() { await fs.mkdir(path.dirname(cacheFile), { recursive: true }); await fs.writeFile(cacheFile, JSON.stringify(cache)); }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await save();
  log(`תמונות רמי לוי: נבדקו ${st.checked}, מהמטמון ${st.fromCache}, נמצאו ${st.found}, אין ${st.missing}, כשלונות ${st.failed}${todo.length > limit ? `, נדחו ${todo.length - limit}` : ''}`);
  return st;
}

function setImg(p) {
  // תמונה שהורדה מ-OFF ונשמרה אצלנו נשארת; אחרת — כתובת רמי לוי
  if (p.img && p.img.startsWith('catalog/')) return;
  p.img = rlImageUrl(p.barcode);
  p.imgCredit = { source: 'רמי לוי', license: 'קישור ישיר', url: null };
}
