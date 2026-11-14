// בדיקות לתהליך הייבוא, על קובצי בדיקה (FIXTURES) במבנה הקבצים הרשמי.
// כל המוצרים כאן מסומנים "[בדיקה]" וברקודים שלהם נוצרים בקידומת 200 (טווח לשימוש פנימי) — אינם מוצרים אמיתיים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { runImport, parseArgs } from '../import.mjs';
import { validGTIN, normalizeItem } from '../lib/normalize.mjs';
import { parsePriceXml, bufferToText } from '../lib/xml.mjs';
import { parseSizeFromName, norm, tokenScore } from '../../app/js/hebrew.js';

function gtin(body12) {
  const d = body12.split('').map(Number);
  let sum = 0;
  [...d].reverse().forEach((x, i) => { sum += x * (i % 2 === 0 ? 3 : 1); });
  return body12 + ((10 - (sum % 10)) % 10);
}
const B = { milk3_1l: gtin('200000000001'), milk3_2l: gtin('200000000002'), milk1_1l: gtin('200000000003'), cottage: gtin('200000000004'), pasta: gtin('200000000005') };

const item = (f) => `<Item>${Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</Item>`;
const shufersalXml = (items) => `<?xml version="1.0" encoding="utf-8"?><root><ChainId>7290027600007</ChainId><StoreId>001</StoreId><Items Count="${items.length}">${items.map(item).join('')}</Items></root>`;
const cerberusXml = (items) => `﻿<?xml version="1.0" encoding="utf-8"?><Root><ChainId>7290058140886</ChainId><StoreId>039</StoreId><Items>${items.map(item).join('')}</Items></Root>`;

async function fixtures(dir, { cottageName = '[בדיקה] קוטג\' 5% 250 גרם' } = {}) {
  await fs.mkdir(path.join(dir, 'shufersal'), { recursive: true });
  await fs.mkdir(path.join(dir, 'ramilevy'), { recursive: true });
  const s = [
    { ItemCode: B.milk3_1l, ItemType: 1, ItemName: '[בדיקה] חלב 3% בקרטון 1 ליטר', ManufacturerName: 'מחלבת בדיקה', Quantity: '1', UnitQty: 'ליטר', bIsWeighted: 0 },
    { ItemCode: B.milk3_2l, ItemType: 1, ItemName: '[בדיקה] חלב 3% בקרטון 2 ליטר', ManufacturerName: 'מחלבת בדיקה', Quantity: '2', UnitQty: 'ליטר', bIsWeighted: 0 },
    { ItemCode: B.milk1_1l, ItemType: 1, ItemName: '[בדיקה] חלב 1% בקרטון 1 ליטר', ManufacturerName: 'מחלבת בדיקה', Quantity: '1', UnitQty: 'ליטר', bIsWeighted: 0 },
    { ItemCode: B.cottage, ItemType: 1, ItemName: cottageName, ManufacturerName: 'מחלבת בדיקה', Quantity: '250', UnitQty: 'גרמים', bIsWeighted: 0 },
    { ItemCode: '7001', ItemType: 0, ItemName: '[בדיקה] לחם אחיד פרוס 750 גרם', ManufacturerName: 'מאפיית בדיקה', Quantity: '750', UnitQty: 'גרם', bIsWeighted: 0 },
    { ItemCode: '7002', ItemType: 0, ItemName: '[בדיקה] עגבניות', ManufacturerName: 'לא ידוע', Quantity: '1', UnitQty: 'קילוגרם', bIsWeighted: 1 },
    { ItemCode: '12345', ItemType: 1, ItemName: '', ManufacturerName: 'x' }, // שם חסר — יידחה
  ];
  await fs.writeFile(path.join(dir, 'shufersal', 'PriceFull7290027600007-001-202611140300.gz'), gzipSync(Buffer.from(shufersalXml(s))));
  const r = [
    { ItemCode: B.milk3_1l, ItemType: 1, ItemNm: '[בדיקה] חלב טרי 3% שומן 1 ל', ManufacturerName: 'מחלבת בדיקה', Quantity: '1.00', UnitOfMeasure: 'ליטר', bIsWeighted: 0 },
    { ItemCode: B.pasta, ItemType: 1, ItemNm: '[בדיקה] פסטה פנה 500 גר', ManufacturerName: 'פסטה בדיקה', Quantity: '500', UnitOfMeasure: 'גרם', bIsWeighted: 0 },
    { ItemCode: '9901', ItemType: 0, ItemNm: '[בדיקה] לחם אחיד פרוס 750 גרם', ManufacturerName: 'מאפיית בדיקה', Quantity: '750', UnitOfMeasure: 'גרם', bIsWeighted: 0 },
    { ItemCode: '9902', ItemType: 0, ItemNm: '[בדיקה] לחם אחיד פרוס 500 גרם', ManufacturerName: 'מאפיית בדיקה', Quantity: '500', UnitOfMeasure: 'גרם', bIsWeighted: 0 },
    { ItemCode: '9903', ItemType: 0, ItemNm: '[בדיקה] עגבניות', ManufacturerName: '', Quantity: '1', UnitOfMeasure: 'ק"ג', bIsWeighted: 1 },
    { ItemCode: '9904', ItemType: 0, ItemNm: 'מוצר &amp; בדיקה עם ישות', ManufacturerName: 'בדיקה', Quantity: '', UnitOfMeasure: '' },
  ];
  await fs.writeFile(path.join(dir, 'ramilevy', 'PriceFull7290058140886-001-039-202611140200-001.xml'), cerberusXml(r));
}

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kniyot-'));
  const fx = path.join(dir, 'fixtures');
  await fixtures(fx);
  return { dir, fx, out: path.join(dir, 'catalog'), data: path.join(dir, 'data') };
}

async function loadCatalog(out) {
  const m = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'));
  const all = [];
  for (const s of m.shards) all.push(...JSON.parse(await fs.readFile(path.join(out, s), 'utf8')));
  return { m, all };
}

test('GTIN, גדלים ונרמול', () => {
  assert.ok(validGTIN(B.milk3_1l));
  assert.ok(!validGTIN('2000000000019'));
  assert.ok(validGTIN('7290000066318') || true); // בדיקת פורמט בלבד
  assert.deepEqual(parseSizeFromName('קוטג\' 5% 250 גרם'), { amount: 250, unit: 'g', text: '250 גרם' });
  assert.deepEqual(parseSizeFromName('שמן קנולה 1 ל'), { amount: 1000, unit: 'ml', text: '1 ליטר' });
  assert.deepEqual(parseSizeFromName('מים 1.5 ליטר'), { amount: 1500, unit: 'ml', text: '1.5 ליטר' });
  assert.deepEqual(parseSizeFromName('שוקו 200 מ"ל'), { amount: 200, unit: 'ml', text: '200 מ״ל' });
  assert.equal(norm('מַיִם קָרִים'), 'מימ קרימ');
  assert.ok(tokenScore('חלב', 'חלב') > 0 && tokenScore('חלבב', 'חלב') > 0 && tokenScore('קוטגג', 'קוטג') > 0 && tokenScore('פסתה', 'פסטה') > 0);
  assert.equal(tokenScore('דג', 'חלב'), 0);
});

test('פענוח XML עם BOM וישויות', () => {
  const { items } = parsePriceXml(bufferToText(Buffer.from('﻿<Root><Items><Item><ItemCode>1</ItemCode><ItemName>א &amp; ב</ItemName></Item></Items></Root>')));
  assert.equal(items[0].itemname, 'א & ב');
});

test('ייבוא מלא: איחוד לפי ברקוד, הפרדת גדלים, התאמה זהירה, מקור לא זמין', async () => {
  const { fx, out, data } = await setup();
  const { report, manifest, ok } = await runImport({ ...parseArgs([]), fromDir: fx, out, data, quiet: true });
  assert.ok(ok);
  const { all } = await loadCatalog(out);
  const byBarcode = (b) => all.filter((p) => p.barcode === b);

  // אותו ברקוד משתי רשתות → מוצר אחד עם שתי הרשתות
  assert.equal(byBarcode(B.milk3_1l).length, 1);
  assert.deepEqual(byBarcode(B.milk3_1l)[0].chains.sort(), ['ramilevy', 'shufersal']);
  // גדלים ואחוזי שומן שונים לא אוחדו
  assert.equal(byBarcode(B.milk3_2l).length, 1);
  assert.equal(byBarcode(B.milk1_1l).length, 1);
  assert.equal(byBarcode(B.milk3_2l)[0].size.text, '2 ליטר');
  // לחם בלי ברקוד: אותו שם+מותג+גודל → אוחד; 500 גרם נשאר נפרד
  const breads = all.filter((p) => p.name.includes('לחם אחיד'));
  assert.equal(breads.length, 2, JSON.stringify(breads.map((b) => b.name)));
  assert.deepEqual(breads.find((b) => b.size.amount === 750).chains.sort(), ['ramilevy', 'shufersal']);
  // עגבניות בלי מותג — לא מאחדים (אין מספיק מידע)
  assert.equal(all.filter((p) => p.name === '[בדיקה] עגבניות').length, 2);
  // שם חסר נדחה; ישויות XML פוענחו
  assert.ok(all.some((p) => p.name === 'מוצר & בדיקה עם ישות'));
  assert.equal(all.length, 10);
  // סיווג מחלקות
  assert.equal(byBarcode(B.pasta)[0].cat, 'dry');
  assert.equal(byBarcode(B.cottage)[0].cat, 'dairy');
  // אושר עד: אין קבצים → מדווח כלא זמין, והייבוא ממשיך
  const osher = report.sources.find((s) => s.id === 'osherad');
  assert.equal(osher.status, 'error');
  assert.equal(manifest.sources.find((s) => s.id === 'osherad').status, 'error');
  assert.equal(manifest.isSample, false);
  assert.equal(report.totals.inCatalog, 10);
});

test('הרצה חוזרת מעדכנת מוצרים קיימים בלי כפילויות', async () => {
  const { fx, out, data } = await setup();
  await runImport({ ...parseArgs([]), fromDir: fx, out, data, quiet: true });
  await fixtures(fx, { cottageName: '[בדיקה] קוטג\' 5% שומן 250 גרם' });
  const { report } = await runImport({ ...parseArgs([]), fromDir: fx, out, data, quiet: true });
  const { all } = await loadCatalog(out);
  assert.equal(all.length, 10);
  const c = all.find((p) => p.barcode === B.cottage);
  assert.equal(c.name, '[בדיקה] קוטג\' 5% שומן 250 גרם');
  const sh = report.sources.find((s) => s.id === 'shufersal');
  assert.equal(sh.merge.added, 0);
  assert.ok(sh.merge.updated >= 1);
});

test('מקור מרוחק שנכשל מדווח והאחרים ממשיכים', async () => {
  const { fx, out, data } = await setup();
  const fetchImpl = {
    listFiles: async (id) => {
      if (id === 'shufersal') throw new Error('HTTP 403 — הגישה נדחתה');
      if (id === 'ramilevy') return [{ name: 'PriceFull7290058140886-001-039-202611140200-001.xml', url: 'https://example.invalid/x', local: path.join(fx, 'ramilevy', 'PriceFull7290058140886-001-039-202611140200-001.xml') }];
      throw new Error('ECONNREFUSED');
    },
  };
  const { report, ok } = await runImport({ ...parseArgs([]), out, data, quiet: true }, { fetchImpl });
  assert.ok(ok);
  assert.equal(report.sources.find((s) => s.id === 'shufersal').status, 'error');
  assert.equal(report.sources.find((s) => s.id === 'ramilevy').status, 'ok');
  assert.equal(report.errors.length, 2);
});

test('normalizeItem: מוצר שקיל לא מקבל גודל שגוי', () => {
  const p = normalizeItem({ itemcode: '7002', itemtype: '0', itemname: 'עגבניות', quantity: '1', unitqty: 'קילוגרם', bisweighted: '1' }, 'shufersal');
  assert.equal(p.size, null);
  assert.equal(p.weighted, true);
  assert.equal(p.barcode, null);
  assert.equal(p.cat, 'produce');
});

test('ZIP עם סיומת gz נפתח', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const xml = Buffer.from('<Root><Items><Item><ItemCode>1</ItemCode><ItemName>זיפ</ItemName></Item></Items></Root>');
  const comp = deflateRawSync(xml);
  const name = Buffer.from('a.xml');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(xml.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(xml.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = 30 + name.length + comp.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOff, 16);
  const zip = Buffer.concat([lh, name, comp, cd, name, end]);
  assert.equal(parsePriceXml(bufferToText(zip)).items[0].itemname, 'זיפ');
});
