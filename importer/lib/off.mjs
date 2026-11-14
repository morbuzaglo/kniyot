// העשרה אופציונלית מ-Open Food Facts (מאגר פתוח, רישיון ODbL; תמונות CC BY-SA) לפי ברקוד:
// תמונה, ולפעמים קטגוריה. קצב: עד ~85 בקשות לדקה (המגבלה המפורסמת היא 100), עם מטמון מקומי.
import fs from 'node:fs/promises';
import path from 'node:path';
import { http, sleep, UA } from './http.mjs';
import { categorizeFromOFF } from './categorize.mjs';

const FIELDS = 'code,product_name,product_name_he,brands,quantity,image_front_url,image_front_small_url,categories_tags';

export async function enrichFromOFF(db, { cacheDir, imgDir, limit = 500, downloadImages = true, log = console.log, errors = [] }) {
  await fs.mkdir(cacheDir, { recursive: true });
  if (downloadImages) await fs.mkdir(imgDir, { recursive: true });
  let sharp = null;
  if (downloadImages) { try { sharp = (await import('sharp')).default; } catch { /* לא חובה */ } }

  const todo = Object.values(db.products).filter((p) => p.barcode && !p.img);
  const st = { checked: 0, fromCache: 0, found: 0, images: 0, notFound: 0, failed: 0, skippedByLimit: Math.max(0, todo.length - limit) };
  let consecutiveFail = 0;
  for (const p of todo.slice(0, limit)) {
    const cf = path.join(cacheDir, p.barcode + '.json');
    let data = null;
    try {
      const c = JSON.parse(await fs.readFile(cf, 'utf8'));
      if (c.status === 1 || Date.now() - c.cachedAt < 30 * 86400e3) { data = c; st.fromCache++; }
    } catch {}
    if (!data) {
      try {
        const res = await http(`https://world.openfoodfacts.org/api/v2/product/${p.barcode}.json?fields=${FIELDS}`, { retries: 1, timeout: 20000 });
        data = await res.json();
        data.cachedAt = Date.now();
        await fs.writeFile(cf, JSON.stringify(data));
        consecutiveFail = 0;
      } catch (e) {
        st.failed++;
        consecutiveFail++;
        if (consecutiveFail >= 5) { errors.push({ source: 'openfoodfacts', error: 'הופסק אחרי 5 כשלונות רצופים: ' + e.message }); break; }
        continue;
      } finally {
        await sleep(700);
      }
    }
    st.checked++;
    if (data.status !== 1 || !data.product) { st.notFound++; continue; }
    st.found++;
    const op = data.product;
    if (p.cat === 'other') { const c = categorizeFromOFF(op.categories_tags); if (c) p.cat = c; }
    const imgUrl = op.image_front_small_url || op.image_front_url;
    if (!imgUrl) continue;
    p.imgCredit = { source: 'Open Food Facts', license: 'CC BY-SA 3.0', url: `https://world.openfoodfacts.org/product/${p.barcode}` };
    if (!downloadImages) { p.img = imgUrl; st.images++; continue; }
    try {
      const buf = Buffer.from(await (await http(imgUrl, { retries: 1, timeout: 30000, headers: { 'user-agent': UA } })).arrayBuffer());
      const file = path.join(imgDir, p.barcode + '.jpg');
      if (sharp) await sharp(buf).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toFile(file);
      else await fs.writeFile(file, buf);
      p.img = 'catalog/img/' + p.barcode + '.jpg';
      st.images++;
    } catch (e) {
      st.failed++;
    }
    await sleep(300);
  }
  log(`Open Food Facts: נבדקו ${st.checked}, נמצאו ${st.found}, תמונות ${st.images}, לא נמצאו ${st.notFound}, כשלונות ${st.failed}${st.skippedByLimit ? `, נדחו להרצה הבאה ${st.skippedByLimit}` : ''}`);
  return st;
}
