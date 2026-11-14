// בדיקות קצה-לקצה ב-Chrome עם תצורת iPhone (Playwright).
// הרצה: python3 -m http.server 8080 --directory app   ואז   node tests/e2e.cjs
// הערה: זה Chromium ולא WebKit/Safari — ראו README לגבי מה שנבדק רק כאן.
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, devices } = pw;

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = process.env.OUT || path.join(__dirname, 'artifacts');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

async function newCtx(browser, opts = {}) {
  const { defaultBrowserType, ...iphone } = devices['iPhone 14'];
  const ctx = await browser.newContext({ ...iphone, locale: 'he-IL', acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  return { ctx, page };
}

async function saveBlobLinks(page, selector, prefix) {
  const urls = await page.$$eval(selector, (els) => els.map((e) => e.href || e.src));
  const files = [];
  for (let i = 0; i < urls.length; i++) {
    const b64 = await page.evaluate(async (u) => {
      const b = await (await fetch(u)).blob();
      return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
    }, urls[i]);
    const ext = prefix.endsWith('pdf') ? 'pdf' : 'png';
    const f = path.join(OUT, `${prefix}-${i + 1}.${ext}`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    files.push(f);
  }
  return files;
}

const itemCount = (page) => page.evaluate(async () => (await window.__app.S.listItems(await window.__app.S.activeListId())).length);

async function addBySearch(page, q, nameExact) {
  await page.fill('.search-input', q);
  await page.waitForTimeout(250);
  const card = page.locator('.pcard', { has: page.locator('.pname', { hasText: nameExact }) }).first();
  await card.locator('.add-btn').click();
  await page.waitForTimeout(150);
  return card;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const { ctx, page } = await newCtx(browser);
  await page.goto(BASE + '#home');
  await page.waitForSelector('.active-card');
  check('מסך הבית נטען עם "הקנייה הקרובה"', await page.locator('.card-title', { hasText: 'הקנייה הקרובה' }).count());
  check('אין טקסט "null" בעמוד', !(await page.locator('body').innerText()).includes('null'));

  // ---------- חיפוש ----------
  await page.click('.tab[data-tab=search]');
  await page.fill('.search-input', 'חלבב');
  await page.waitForTimeout(250);
  const typoNames = await page.$$eval('.pcard .pname', (e) => e.map((x) => x.textContent));
  check('טעות כתיב "חלבב" מוצאת חלב', typoNames.some((n) => n.startsWith('חלב')), typoNames.slice(0, 3).join(' | '));
  await page.fill('.search-input', 'קוטג');
  await page.waitForTimeout(250);
  check('כתיב חלקי "קוטג" מוצא קוטג\'', (await page.locator('.pcard .pname', { hasText: "קוטג'" }).count()) >= 3);
  await page.fill('.search-input', 'שמפו מותג א');
  await page.waitForTimeout(250);
  check('חיפוש לפי שם + מותג', (await page.locator('.pcard').count()) === 1);
  await page.fill('.search-input', 'פסתה');
  await page.waitForTimeout(250);
  check('טעות כתיב "פסתה" מוצאת פסטה', (await page.locator('.pcard .pname', { hasText: 'פסטה' }).count()) >= 1);

  // ---------- הבחנה בין גדלים ----------
  await page.fill('.search-input', 'חלב 3% בקרטון');
  await page.waitForTimeout(250);
  const sizes = await page.$$eval('.pcard', (cards) => cards.filter((c) => c.querySelector('.pname').textContent === 'חלב 3% בקרטון').map((c) => c.querySelector('.size-pill')?.textContent));
  check('שתי אריזות של אותו מוצר מוצגות עם גודל בולט', sizes.includes('1 ליטר') && sizes.includes('2 ליטר'), sizes.join(', '));
  check('תווית אזהרה על וריאציות', (await page.locator('.tag-variant').count()) > 0);
  await page.screenshot({ path: path.join(OUT, '01-search-variants.png') });
  const cards = page.locator('.pcard', { has: page.locator('.pname', { hasText: 'חלב 3% בקרטון' }) });
  await cards.filter({ has: page.locator('.size-pill', { hasText: '1 ליטר' }) }).locator('.add-btn').click();
  await page.waitForTimeout(150);
  await cards.filter({ has: page.locator('.size-pill', { hasText: '2 ליטר' }) }).locator('.add-btn').click();
  await page.waitForTimeout(200);
  check('החיפוש נשמר אחרי הוספה', (await page.inputValue('.search-input')) === 'חלב 3% בקרטון');
  check('הכרטיס מציג כמות אחרי הוספה', (await page.locator('.pcard.in-list').count()) === 2);
  const its = await page.evaluate(async () => (await window.__app.S.listItems(await window.__app.S.activeListId())).map((i) => i.snapshot.sizeText));
  check('נוצרו שני פריטים נפרדים לפי גודל', its.length === 2 && its.includes('1 ליטר') && its.includes('2 ליטר'), its.join(', '));

  // ---------- גיליון מוצר: כמות, הערה, תחליף ----------
  await page.fill('.search-input', 'קוטג 5% 250');
  await page.waitForTimeout(250);
  await page.locator('.pcard .pcard-main').first().click();
  await page.waitForSelector('.psheet');
  check('בגיליון המוצר מוצגות וריאציות אחרות', (await page.locator('.variants .variant-chip').count()) >= 1);
  await page.locator('.psheet .stepper-big .step-btn').first().click(); // + → 2
  await page.fill('.psheet textarea', 'רק 5%');
  await page.locator('.psheet .chip', { hasText: 'הכי טרי' }).click();
  await page.locator('.seg-btn', { hasText: 'מותג אחר בסדר' }).click();
  await page.screenshot({ path: path.join(OUT, '02-product-sheet.png') });
  await page.locator('.psheet .btn-primary').click();
  await page.waitForTimeout(400);
  const cot = await page.evaluate(async () => (await window.__app.S.listItems(await window.__app.S.activeListId())).find((i) => i.snapshot.name.startsWith('קוטג')));
  check('כמות, הערה והעדפת תחליף נשמרו', cot && cot.qty === 2 && cot.note === 'רק 5%, הכי טרי' && cot.subst === 'any', JSON.stringify(cot && { q: cot.qty, n: cot.note, s: cot.subst }));

  // ---------- מוצר ידני עם תמונה ----------
  const photo = path.join(OUT, 'test-photo.png');
  {
    const p2 = await ctx.newPage();
    const b64 = await p2.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#3a7'; x.fillRect(0, 0, 600, 400); x.fillStyle = '#fff'; x.font = 'bold 90px sans-serif'; x.fillText('TEST', 170, 230); return c.toDataURL('image/png').split(',')[1]; });
    fs.writeFileSync(photo, Buffer.from(b64, 'base64'));
    await p2.close();
  }
  await page.goto(BASE + '#settings');
  await page.locator('.card', { hasText: 'מוצרים אישיים' }).locator('button', { hasText: '+ הוספה' }).click();
  await page.waitForSelector('.form');
  await page.setInputFiles('#photo-in', photo);
  await page.waitForSelector('.photo-prev img');
  await page.locator('.form input.input').nth(0).fill('חומוס של השכן (בדיקה)');
  await page.locator('.form input.input').nth(1).fill('מעדניית בדיקה');
  await page.locator('.form input.input').nth(2).fill('400');
  await page.locator('.form input.input').nth(3).fill('1234567');
  await page.locator('.form .btn-primary').click();
  await page.waitForTimeout(500);
  check('מוצר אישי נשמר ונוסף לרשימה', (await itemCount(page)) === 4);
  await page.goto(BASE + '#search');
  await page.fill('.search-input', '1234567');
  await page.waitForTimeout(250);
  check('חיפוש לפי ברקוד מוצא את המוצר האישי', (await page.locator('.pcard .pname', { hasText: 'חומוס של השכן' }).count()) === 1);
  check('תמונת המוצר האישי מוצגת', await page.locator('.pcard .thumb img').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false));

  // ---------- שמירה אחרי סגירה ופתיחה ----------
  await page.close();
  const page2 = await ctx.newPage();
  page2.errors = [];
  page2.on('pageerror', (e) => page2.errors.push(e.message));
  await page2.goto(BASE + '#list');
  await page2.waitForSelector('.irow');
  check('הרשימה נשמרה אחרי סגירה ופתיחה מחדש', (await page2.locator('.irow').count()) === 4);
  check('קיבוץ לפי מחלקות', (await page2.locator('.dept-title').count()) >= 2);
  check('מוצר ללא תמונה מציג תחליף', (await page2.locator('.irow .thumb.noimg').count()) >= 1);
  await page2.screenshot({ path: path.join(OUT, '03-list.png') });

  // ---------- ביטול פעולה ----------
  await page2.locator('.irow', { hasText: '2 ליטר' }).locator('.irow-main').click();
  await page2.waitForSelector('.psheet');
  await page2.locator('.btn-danger', { hasText: 'הסרה' }).click();
  await page2.waitForTimeout(300);
  check('הסרה עובדת', (await page2.locator('.irow').count()) === 3);
  await page2.locator('.toast-btn', { hasText: 'בטל' }).click();
  await page2.waitForTimeout(300);
  check('ביטול מחזיר את הפריט', (await page2.locator('.irow').count()) === 4);

  // ---------- מצב קניות ----------
  await page2.locator('.btn', { hasText: 'מצב קניות' }).first().click();
  await page2.waitForSelector('.scard');
  await page2.locator('.scard').first().locator('.btn-bought').click();
  await page2.waitForTimeout(300);
  const lastDone = await page2.locator('.scard').last().getAttribute('class');
  check('פריט שנקנה עובר לתחתית', lastDone.includes('done'));
  check('התקדמות מתעדכנת', (await page2.locator('.progress-text').innerText()).includes('1 מתוך 4'));
  await page2.locator('.scard:not(.done)').first().locator('.btn-missing').click();
  await page2.waitForTimeout(300);
  await page2.screenshot({ path: path.join(OUT, '04-shopping-mode.png'), fullPage: false });
  await page2.locator('.shop-top .icon-btn').click();

  // ---------- עבודה ללא אינטרנט ----------
  await page2.evaluate(() => navigator.serviceWorker.ready);
  await page2.reload();
  await page2.waitForSelector('.irow');
  await page2.waitForTimeout(500);
  await ctx.setOffline(true);
  await page2.reload();
  await page2.waitForSelector('.irow', { timeout: 8000 }).catch(() => {});
  check('ללא אינטרנט: האפליקציה והרשימה נטענות', (await page2.locator('.irow').count()) === 4);
  const offImg = await page2.locator('.irow', { hasText: 'חומוס של השכן' }).locator('.thumb img').evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false);
  check('ללא אינטרנט: תמונת מוצר שמורה מוצגת', offImg);
  await page2.goto(BASE + '#search');
  await page2.fill('.search-input', 'במבה');
  await page2.waitForTimeout(400);
  check('ללא אינטרנט: החיפוש בקטלוג עובד מהמטמון', (await page2.locator('.pcard').count()) >= 1);
  await ctx.setOffline(false);

  // ---------- שיתוף: רשימה קצרה ----------
  await page2.goto(BASE + '#list');
  await page2.waitForSelector('.irow');
  await page2.locator('.sticky-actions .btn', { hasText: 'שיתוף' }).click();
  await page2.waitForSelector('.share');
  const text = await page2.evaluate(async () => {
    const m = await import('./js/share.js');
    const S = window.__app.S;
    const id = await S.activeListId();
    return m.buildText(await S.getList(id), await S.listItems(id));
  });
  fs.writeFileSync(path.join(OUT, 'share-text.txt'), text);
  check('טקסט שיתוף כולל שם, גודל, כמות והערה', text.includes('קוטג') && text.includes('×2') && text.includes('רק 5%') && text.includes('250 גרם'));
  check('אין קישור וואטסאפ שמתיימר לצרף תמונות', (await page2.locator('a', { hasText: 'טקסט בלבד' }).count()) === 1);
  await page2.locator('.share label.switch-row input').check();
  await page2.locator('.share .btn', { hasText: 'הכנת תמונות' }).click();
  await page2.waitForSelector('.prep-img');
  const shortImgs = await saveBlobLinks(page2, '.prep-img', 'share-short');
  check('רשימה קצרה → תמונה אחת', shortImgs.length === 1, shortImgs.map((f) => path.basename(f)).join(','));
  check('הודעת חלופה כשאין Web Share לקבצים', (await page2.locator('.share p.muted', { hasText: 'לא תומך בשיתוף קבצים' }).count()) === 1 || (await page2.evaluate(() => !!navigator.canShare)));
  await page2.screenshot({ path: path.join(OUT, '05-share-sheet.png') });
  await page2.locator('.sheet-close').last().click();

  // ---------- שיתוף: רשימה ארוכה ----------
  await page2.goto(BASE + '#search');
  const many = ['פסטה פנה', 'אורז בסמטי', 'טונה בשמן', 'קטשופ', 'שמן קנולה', 'קמח לבן', 'סוכר לבן', 'קפה נמס', 'במבה', 'ביסלי גריל', 'שוקולד חלב', 'מים מינרליים', 'סודה', 'חזה עוף טרי', 'עגבניות', 'מלפפונים', 'בננות', 'נוזל כלים', 'נייר טואלט', 'שמפו לשיער רגיל', 'משחת שיניים', 'חיתולים מידה 4', 'גלידת וניל', 'ביצים L', 'לחם אחיד פרוס', 'פיתות'];
  for (const n of many) {
    await page2.fill('.search-input', n);
    await page2.waitForTimeout(160);
    const c = page2.locator('.pcard', { has: page2.locator('.pname', { hasText: new RegExp('^' + n + '$') }) }).first();
    if (await c.locator('.add-btn').count()) await c.locator('.add-btn').click();
    await page2.waitForTimeout(80);
  }
  const total = await itemCount(page2);
  check('רשימה ארוכה נבנתה', total >= 28, String(total));
  await page2.goto(BASE + '#list');
  await page2.waitForSelector('.irow');
  await page2.locator('.sticky-actions .btn', { hasText: 'שיתוף' }).click();
  await page2.locator('.share .btn', { hasText: 'הכנת תמונות' }).click();
  await page2.waitForSelector('.prep-img');
  await page2.waitForTimeout(300);
  const longImgs = await saveBlobLinks(page2, '.prep-img', 'share-long');
  check('רשימה ארוכה מתחלקת לכמה תמונות קריאות', longImgs.length >= 3, `${longImgs.length} תמונות`);
  await page2.locator('.share .btn', { hasText: 'הכנת PDF' }).click();
  await page2.waitForSelector('.prep-pdf');
  const pdfs = await saveBlobLinks(page2, '.prep a.btn[download$=".pdf"]', 'share-long-pdf');
  check('נוצר PDF', pdfs.length === 1 && fs.statSync(pdfs[0]).size > 10000);
  await page2.locator('.sheet-close').last().click();

  // ---------- גיבוי ושחזור ----------
  const backupPath = path.join(OUT, 'backup.json');
  const json = await page2.evaluate(async () => { const m = await import('./js/backup.js'); return await (await m.exportBackup()).text(); });
  fs.writeFileSync(backupPath, json);
  const bk = JSON.parse(json);
  check('גיבוי כולל גרסה, סיכום ביקורת ותמונה אישית', bk.version === 1 && bk.sha256 && bk.payload.images.some((i) => i.source === 'user'));
  // קובץ פגום נדחה
  const bad = JSON.parse(json); bad.payload.data.items[0].qty = 999;
  fs.writeFileSync(path.join(OUT, 'backup-tampered.json'), JSON.stringify(bad));
  // מחיקת כל המידע
  await page2.evaluate(async () => { for (const s of ['lists', 'items', 'images', 'custom', 'favorites', 'history', 'meta']) await window.__app.db.clear(s); });
  await page2.goto(BASE + '#home');
  await page2.reload();
  await page2.waitForSelector('.active-card');
  check('אחרי מחיקה הרשימה ריקה', (await itemCount(page2)) === 0);
  await page2.goto(BASE + '#settings');
  await page2.setInputFiles('#restore-in', path.join(OUT, 'backup-tampered.json'));
  await page2.waitForTimeout(400);
  check('גיבוי שהשתנה נדחה באימות', (await page2.locator('#toast').innerText()).includes('סיכום הביקורת'));
  await page2.setInputFiles('#restore-in', backupPath);
  await page2.waitForSelector('.dialog');
  await page2.locator('.dialog .btn-danger').click();
  await page2.waitForTimeout(800);
  check('שחזור מחזיר את כל הפריטים', (await itemCount(page2)) === total, String(await itemCount(page2)));
  await page2.goto(BASE + '#list');
  await page2.waitForSelector('.irow');
  const restoredImg = await page2.locator('.irow', { hasText: 'חומוס של השכן' }).locator('.thumb img').evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false);
  check('שחזור מחזיר את התמונה האישית', restoredImg);
  check('ללא שגיאות JavaScript', page2.errors.length === 0, page2.errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---------- מקור קטלוג לא זמין ----------
  {
    const { ctx: c2, page: p } = await newCtx(browser, { serviceWorkers: 'block' }); // ניתוב בדיקה לא חל על בקשות של SW
    await p.route('**/catalog/**', (r) => r.abort());
    await p.goto(BASE + '#search');
    await p.fill('.search-input', 'חלב');
    await p.waitForSelector('.empty.error');
    check('קטלוג לא זמין: הודעת שגיאה עם "נסה שוב"', (await p.locator('.empty.error button', { hasText: 'נסה שוב' }).count()) === 1);
    await p.screenshot({ path: path.join(OUT, '06-catalog-error.png') });
    await p.unroute('**/catalog/**');
    await p.locator('.empty.error button').click();
    await p.waitForSelector('.pcard', { timeout: 5000 }).catch(() => {});
    check('"נסה שוב" טוען את הקטלוג', (await p.locator('.pcard').count()) > 0);
    // manifest עם מקור שנכשל
    await p.route('**/catalog/manifest.json', async (r) => {
      const res = await r.fetch(); const m = await res.json();
      m.isSample = false;
      m.sources = [{ id: 'shufersal', status: 'ok', count: 120 }, { id: 'ramilevy', status: 'error', error: 'HTTP 403 — הגישה נדחתה', count: 0 }];
      r.fulfill({ response: res, json: m });
    });
    await p.goto(BASE + '#settings');
    await p.reload();
    await p.waitForSelector('.sources');
    check('הגדרות מציגות מקור שאינו זמין', (await p.locator('.sources td.bad', { hasText: 'לא זמין' }).count()) === 1);
    await p.locator('.sources').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(OUT, '07-settings-sources.png') });
    await c2.close();
  }

  // ---------- Web Share API (מדומה — Chrome בלינוקס אינו תומך בשיתוף קבצים) ----------
  {
    const { ctx: c3, page: p } = await newCtx(browser);
    await p.addInitScript(() => {
      window.__shared = [];
      let first = true;
      navigator.canShare = (d) => !!(d && d.files && d.files.every((f) => f instanceof File));
      navigator.share = async (d) => {
        if (first) { first = false; const e = new Error('activation expired'); e.name = 'NotAllowedError'; throw e; }
        window.__shared.push({ n: d.files ? d.files.length : 0, types: d.files ? d.files.map((f) => f.type) : [], names: d.files ? d.files.map((f) => f.name) : [], text: d.text || null });
      };
    });
    await p.goto(BASE + '#search');
    await p.fill('.search-input', 'במבה');
    await p.waitForTimeout(250);
    await p.locator('.pcard .add-btn').first().click();
    await p.goto(BASE + '#list');
    await p.waitForSelector('.irow');
    await p.locator('.sticky-actions .btn', { hasText: 'שיתוף' }).click();
    await p.locator('.share .btn', { hasText: 'הכנת תמונות' }).click();
    await p.waitForSelector('.prep-img');
    await p.waitForTimeout(200);
    check('Safari חוסם שיתוף מיידי → הודעה ללחיצה נוספת', (await p.locator('.share p.muted', { hasText: 'לחצו על כפתור השיתוף' }).count()) === 1);
    await p.locator('.share .btn', { hasText: 'שיתוף 1 תמונות' }).click();
    await p.waitForTimeout(200);
    const shared = await p.evaluate(() => window.__shared);
    check('שיתוף קבצים נקרא עם תמונת PNG ושם קובץ בעברית', shared.length === 1 && shared[0].types[0] === 'image/png' && shared[0].names[0] === 'הקנייה הקרובה.png', JSON.stringify(shared));
    await p.locator('.share .btn', { hasText: 'הכנת PDF' }).click();
    await p.waitForTimeout(800);
    const shared2 = await p.evaluate(() => window.__shared);
    check('PDF משותף מיד אחרי ההכנה', shared2.length === 2 && shared2[1].types[0] === 'application/pdf');
    await c3.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} בדיקות עברו`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
