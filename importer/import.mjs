#!/usr/bin/env node
// תהליך ייבוא הקטלוג. ניתן להריץ שוב ושוב: מעדכן מוצרים קיימים, מוסיף חדשים, ומפיק דוח.
//
//   node importer/import.mjs                       # כל המקורות, 3 סניפים לרשת
//   node importer/import.mjs --sources shufersal --max-stores 5
//   node importer/import.mjs --from-dir ./downloads  # קבצים שהורדו ידנית
//   node importer/import.mjs --enrich-off --off-limit 1000   # תמונות מ-Open Food Facts
//
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, listFiles, download, listLocal } from './sources/index.mjs';
import { bufferToText, parsePriceXml } from './lib/xml.mjs';
import { normalizeItem } from './lib/normalize.mjs';
import { emptyDB, mergeProducts, applyOverrides } from './lib/merge.mjs';
import { enrichFromOFF } from './lib/off.mjs';
import { attachRamiLevyImages } from './lib/rlimages.mjs';
import { writeCatalog } from './lib/output.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const a = { sources: Object.keys(SOURCES), maxStores: 3, out: path.join(HERE, '../app/catalog'), data: path.join(HERE, 'data'), fromDir: null, enrichOff: false, offLimit: 500, rlImages: true, rlLimit: 30000, downloadImages: true, staleDays: 120, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--sources') a.sources = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--max-stores') a.maxStores = Number(v());
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '--data') a.data = path.resolve(v());
    else if (k === '--from-dir') a.fromDir = path.resolve(v());
    else if (k === '--enrich-off') a.enrichOff = true;
    else if (k === '--off-limit') a.offLimit = Number(v());
    else if (k === '--no-download-images') a.downloadImages = false;
    else if (k === '--no-rl-images') a.rlImages = false;
    else if (k === '--rl-limit') a.rlLimit = Number(v());
    else if (k === '--stale-days') a.staleDays = Number(v());
    else if (k === '--quiet') a.quiet = true;
    else if (k === '-h' || k === '--help') { console.log('ראו README.md, סעיף "ייבוא הקטלוג"'); process.exit(0); }
    else throw new Error('ארגומנט לא מוכר: ' + k);
  }
  for (const s of a.sources) if (!SOURCES[s]) throw new Error(`מקור לא מוכר "${s}". אפשריים: ${Object.keys(SOURCES).join(', ')}`);
  return a;
}

const ok0 = (reps) => reps.some((r) => r.status === 'ok');

async function readJSON(file, dflt) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return dflt; }
}

export async function runImport(opts, { fetchImpl } = {}) {
  const log = opts.quiet ? () => {} : (...m) => console.log(...m);
  const startedAt = new Date().toISOString();
  await fs.mkdir(opts.data, { recursive: true });
  const dbFile = path.join(opts.data, 'catalog-db.json');
  const db = await readJSON(dbFile, emptyDB());
  const prevReport = await readJSON(path.join(opts.data, 'import-report.json'), null);
  const errors = [];
  const sourceReports = [];
  const local = opts.fromDir ? await listLocal(opts.fromDir) : null;

  for (const id of opts.sources) {
    const src = SOURCES[id];
    const rep = { id, name: src.name, status: 'ok', files: 0, filesFailed: 0, rawItems: 0, products: 0, merge: null, error: null, fetchedAt: new Date().toISOString() };
    log(`\n== ${src.name} (${id})`);
    const normalized = [];
    try {
      let files;
      if (local) {
        files = (local[id] || []).map((f) => ({ name: path.basename(f), local: f, url: null }));
        if (!files.length) throw new Error(`אין קבצים מקומיים עבור ${id} בתיקייה ${opts.fromDir}`);
      } else {
        files = await (fetchImpl?.listFiles || listFiles)(id, { maxStores: opts.maxStores });
      }
      log(`  נמצאו ${files.length} קבצים לעיבוד`);
      for (const f of files) {
        try {
          const buf = f.local ? await fs.readFile(f.local) : await (fetchImpl?.download || download)(f);
          const { items } = parsePriceXml(bufferToText(buf));
          rep.files++;
          rep.rawItems += items.length;
          const fetchedAt = new Date().toISOString();
          for (const raw of items) {
            const p = normalizeItem(raw, id, { sourceUrl: f.url || src.home, fetchedAt });
            if (p) normalized.push(p);
          }
          log(`  ✓ ${f.name}: ${items.length} פריטים`);
        } catch (e) {
          rep.filesFailed++;
          errors.push({ source: id, file: f.name, error: e.message });
          log(`  ✗ ${f.name}: ${e.message}`);
        }
      }
      if (!normalized.length) throw new Error(rep.filesFailed ? 'כל הקבצים נכשלו' : 'לא התקבלו פריטים');
      rep.merge = mergeProducts(db, normalized);
      rep.products = new Set(normalized.map((p) => db.aliases[p.key] || p.key)).size;
      rep.lastSuccess = rep.fetchedAt;
      log(`  מוצרים ייחודיים: ${rep.products} (חדשים ${rep.merge.added}, עודכנו ${rep.merge.updated}, ללא שינוי ${rep.merge.unchanged}, אוחדו לפי ברקוד ${rep.merge.mergedByBarcode}, אוחדו בזהירות ללא ברקוד ${rep.merge.mergedLoose})`);
    } catch (e) {
      rep.status = 'error';
      rep.error = e.message;
      rep.lastSuccess = prevReport?.sources?.find((s) => s.id === id)?.lastSuccess || null;
      errors.push({ source: id, error: e.message });
      log(`  ✗ המקור לא זמין: ${e.message} — ממשיכים עם שאר המקורות`);
    }
    sourceReports.push(rep);
  }

  const overrides = await readJSON(path.join(opts.data, 'overrides.json'), {});
  const nOver = applyOverrides(db, overrides);

  let rlImages = null;
  if (opts.rlImages && !opts.fromDir && ok0(sourceReports)) {
    rlImages = await attachRamiLevyImages(db, { cacheFile: path.join(opts.data, 'rl-images.json'), limit: opts.rlLimit, log, errors });
  }

  let enrich = null;
  if (opts.enrichOff) {
    enrich = await enrichFromOFF(db, { cacheDir: path.join(opts.data, 'off-cache'), imgDir: path.join(opts.out, 'img'), limit: opts.offLimit, downloadImages: opts.downloadImages, log, errors });
  }

  // מוצרים שלא נראו זמן רב (הוסרו מהמדפים) לא נכנסים לקטלוג, אבל נשמרים במאגר האב
  const cutoff = Date.now() - opts.staleDays * 86400e3;
  const all = Object.values(db.products);
  const live = all.filter((p) => Date.parse(p.lastSeen) >= cutoff);

  const ok = sourceReports.some((s) => s.status === 'ok');
  let manifest = null;
  if (ok || all.length) {
    manifest = await writeCatalog(opts.out, live, {
      sources: sourceReports.map((s) => ({
        id: s.id, status: s.status, error: s.error,
        count: live.filter((p) => p.chains.includes(s.id)).length,
        fetchedAt: s.fetchedAt, lastSuccess: s.lastSuccess,
      })),
      notes: [`מוצרים שלא נראו ${opts.staleDays} יום הוסרו מהתצוגה: ${all.length - live.length}`],
    });
    await fs.writeFile(dbFile, JSON.stringify(db));
  }

  const report = {
    startedAt, finishedAt: new Date().toISOString(),
    options: { ...opts, out: path.relative(process.cwd(), opts.out) || '.', data: path.relative(process.cwd(), opts.data) || '.' },
    sources: sourceReports,
    totals: { inDB: all.length, inCatalog: live.length, withBarcode: manifest?.withBarcode ?? 0, withImages: manifest?.withImages ?? 0, overridesApplied: nOver },
    rlImages, enrich, errors,
  };
  await fs.writeFile(path.join(opts.data, 'import-report.json'), JSON.stringify(report, null, 2));
  log(`\nסיכום: ${live.length} מוצרים בקטלוג (${manifest?.withBarcode ?? 0} עם ברקוד, ${manifest?.withImages ?? 0} עם תמונה). שגיאות: ${errors.length}. דוח: ${path.join(opts.data, 'import-report.json')}`);
  if (!ok) log('אף מקור לא היה זמין בהרצה הזו. ' + (all.length ? 'הקטלוג נכתב מחדש מהמאגר הקיים.' : 'הקטלוג הקיים לא שונה.'));
  return { report, manifest, ok };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { ok } = await runImport(parseArgs(process.argv.slice(2)));
    process.exit(ok ? 0 : 2);
  } catch (e) {
    console.error('שגיאה:', e.message);
    process.exit(1);
  }
}
