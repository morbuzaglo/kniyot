// כתיבת הקטלוג שהאפליקציה צורכת: manifest.json + מקטעי מוצרים עם hash בשם (למטמון בטוח).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SHARD_SIZE = 4000;

/** מוצר "רזה" לאפליקציה — רק מה שנחוץ לחיפוש ולתצוגה. */
export function slim(p) {
  const o = { id: p.id, name: p.name, brand: p.brand || '', cat: p.cat, chains: p.chains, updated: p.updated };
  if (p.sub) o.sub = p.sub;
  if (p.size) o.size = p.size;
  if (p.barcode) o.barcode = p.barcode;
  if (p.img) o.img = p.img;
  if (p.imgCredit) o.imgCredit = p.imgCredit.source;
  if (p.weighted) o.weighted = true;
  if (p.pack) o.pack = p.pack;
  if (p.sample) o.sample = true;
  o.sources = p.sources.map((s) => ({ chain: s.chain, url: s.url ? s.url.split('?')[0] : null, updated: s.updated }));
  return o;
}

export async function writeCatalog(outDir, products, { sources, isSample = false, generatedAt = new Date().toISOString(), notes = [] }) {
  await fs.mkdir(outDir, { recursive: true });
  const list = products.map(slim).sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name, 'he'));
  const shards = [];
  for (let i = 0; i < list.length || i === 0; i += SHARD_SIZE) {
    const chunk = list.slice(i, i + SHARD_SIZE);
    const json = JSON.stringify(chunk);
    const hash = crypto.createHash('sha1').update(json).digest('hex').slice(0, 10);
    const name = `products-${shards.length}-${hash}.json`;
    await fs.writeFile(path.join(outDir, name), json);
    shards.push(name);
    if (!list.length) break;
  }
  // ניקוי מקטעים ישנים
  for (const f of await fs.readdir(outDir)) if (/^products-.*\.json$/.test(f) && !shards.includes(f)) await fs.unlink(path.join(outDir, f));

  const manifest = {
    formatVersion: 1,
    generatedAt,
    isSample,
    total: list.length,
    withBarcode: list.filter((p) => p.barcode).length,
    withImages: list.filter((p) => p.img).length,
    byCategory: list.reduce((m, p) => ((m[p.cat] = (m[p.cat] || 0) + 1), m), {}),
    sources,
    shards,
    attribution: list.some((p) => p.imgCredit) ? 'חלק מהתמונות מ-Open Food Facts (CC BY-SA 3.0)' : null,
    notes,
  };
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
