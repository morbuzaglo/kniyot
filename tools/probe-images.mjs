// בדיקת מקורות תמונה לפי ברקוד (רץ ב-GitHub Actions, שם יש גישה לרשת).
import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('app/catalog/manifest.json', 'utf8'));
let all = [];
for (const s of m.shards) all = all.concat(JSON.parse(fs.readFileSync('app/catalog/' + s, 'utf8')));
const withBc = all.filter((p) => p.barcode);
const pick = (f, n) => withBc.filter(f).sort(() => Math.random() - 0.5).slice(0, n);
const sample = [...pick((p) => p.chains.includes('ramilevy'), 15), ...pick((p) => p.chains.length === 1 && p.chains[0] === 'shufersal', 15), ...pick((p) => p.chains.length === 1 && p.chains[0] === 'osherad', 10)];
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', origin: 'https://morbuzaglo.github.io', referer: 'https://morbuzaglo.github.io/' };
async function get(url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'manual' });
    const b = r.status === 200 ? (await r.arrayBuffer()).byteLength : 0;
    return `${r.status} ${r.headers.get('content-type') || ''} ${b}B acao=${r.headers.get('access-control-allow-origin')} loc=${r.headers.get('location') || ''}`;
  } catch (e) { return 'ERR ' + (e.cause?.code || e.message); }
}
for (const u of ['https://www.rami-levy.co.il/robots.txt', 'https://img.rami-levy.co.il/robots.txt', 'https://www.shufersal.co.il/robots.txt']) {
  const r = await fetch(u, { headers: UA }).catch(() => null);
  console.log('### ' + u + ' ' + (r ? r.status : 'ERR') + '\n' + (r ? (await r.text()).slice(0, 1200) : ''));
}
const stats = {};
for (const p of sample) {
  const bc = p.barcode;
  console.log(`\n== ${bc} [${p.chains.join(',')}] ${p.name}`);
  for (const [k, u] of Object.entries({ rl_small: `https://img.rami-levy.co.il/product/${bc}/small.jpg`, rl_large: `https://img.rami-levy.co.il/product/${bc}/large.jpg` })) {
    const res = await get(u);
    console.log(`  ${k}: ${res}`);
    (stats[k + ':' + p.chains.join(',')] ||= []).push(res.startsWith('200 image') ? 1 : 0);
  }
}
for (const p of pick((p) => p.chains.includes('shufersal'), 4)) {
  const u = `https://www.shufersal.co.il/online/he/p/P_${p.barcode}`;
  try {
    const r = await fetch(u, { headers: UA });
    const t = await r.text();
    const og = t.match(/property="og:image"\s+content="([^"]+)"/) || t.match(/(https:\/\/res\.cloudinary\.com\/shufersal[^"' ]+)/);
    console.log(`\nshufersal page ${p.barcode}: ${r.status} og=${og ? og[1] : 'none'}`);
    if (og) console.log('  img:', await get(og[1]));
  } catch (e) { console.log('shufersal page ERR', e.message); }
}
console.log('\nSTATS', JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, `${v.reduce((a, b) => a + b, 0)}/${v.length}`]))));
