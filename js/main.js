// נקודת הכניסה: ניתוב, מסכים ופעולות.
import { DEPARTMENTS, dept } from './categories.js';
import { catalog, loadCatalog, search, getProduct, variantsOf, variantCount, brandsFor, setCustomProducts } from './catalog.js';
import { db, getMeta, setMeta, storageStatus, requestPersist } from './db.js';
import * as S from './store.js';
import { h, $, fill, thumb, sizePill, toast, sheet, confirmDialog, promptDialog, stepper, emptyState, errorState, relTime, fmt, closeAllSheets } from './ui.js';
import * as Share from './share.js';
import { exportBackup, inspectBackup, restoreBackup } from './backup.js';

const view = () => $('#view');
const ui = {
  activeId: null,
  activeItems: [],            // פריטי הרשימה הפעילה (לסימון "כבר ברשימה" בחיפוש)
  search: { q: '', cat: null, brand: null, scroll: 0 },
  favTab: 'fav',
};

// ---------- אתחול ----------
async function boot() {
  try {
    ui.activeId = await S.ensureDefaults();
  } catch (e) {
    view().replaceChildren(errorState('לא ניתן לפתוח את האחסון המקומי בדפדפן. ייתכן שמצב גלישה פרטית חוסם אותו. ' + (e?.message || ''), () => location.reload()));
    return;
  }
  setCustomProducts(await S.customProducts());
  await refreshActive();
  loadCatalog().then(() => { if (['search', 'home', 'favs', 'settings'].includes(route().name)) render(); }, () => render());
  window.addEventListener('hashchange', render);
  setupKeyboardAwareness();
  render();
  // בקשת אחסון קבוע — בשקט, ללא חלון (Safari מחליט לפי היוריסטיקה, למשל אם האפליקציה במסך הבית)
  requestPersist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

async function refreshActive() {
  ui.activeId = (await S.activeListId()) || ui.activeId;
  ui.activeItems = ui.activeId ? await S.listItems(ui.activeId) : [];
  updateBadge();
}

function updateBadge() {
  const open = ui.activeItems.filter((i) => i.status === 'open').length;
  const b = $('#tab-list-badge');
  if (b) { b.textContent = open || ''; b.hidden = !open; }
}

function route() {
  const raw = (location.hash || '#home').slice(1);
  const [name, arg] = raw.split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : null };
}
export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

async function render() {
  const r = route();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tabFor(r.name)));
  document.body.dataset.route = r.name;
  const v = view();
  if (r.name !== 'search') v.onscroll = null;
  try {
    switch (r.name) {
      case 'search': await renderSearch(v); break;
      case 'list': await renderList(v, r.arg || ui.activeId); break;
      case 'shop': await renderShop(v, r.arg || ui.activeId); break;
      case 'lists': await renderLists(v); break;
      case 'favs': await renderFavs(v); break;
      case 'settings': await renderSettings(v); break;
      default: await renderHome(v);
    }
  } catch (e) {
    console.error(e);
    fill(v, errorState(e?.message || String(e), render));
  }
}
const tabFor = (n) => ({ list: 'list', shop: 'list', lists: 'list' }[n] || n);

function topbar(title, ...actions) {
  return h('header', { class: 'topbar' }, h('h1', {}, title), h('div', { class: 'topbar-actions' }, ...actions));
}

// ================= בית =================
async function renderHome(v) {
  const list = await S.getList(ui.activeId);
  const items = ui.activeItems;
  const done = items.filter((i) => i.status !== 'open').length;
  const lists = (await S.allLists()).filter((l) => l.kind === 'list' && !l.archived && l.id !== ui.activeId).slice(0, 4);
  const { frequent, recent } = await S.history();
  const quick = (frequent.length ? frequent : recent).slice(0, 10);

  fill(v, 
    topbar('הקניות שלי'),
    sampleBanner(),
    h('button', { class: 'fake-search', onclick: () => go('#search') }, h('span', { 'aria-hidden': 'true' }, '🔍'), 'חיפוש מוצר להוספה…'),
    h('section', { class: 'card active-card' },
      h('div', { class: 'row between' },
        h('div', {}, h('div', { class: 'eyebrow' }, 'רשימה פעילה'), h('h2', { class: 'card-title' }, list?.name || S.ACTIVE_NAME)),
        h('button', { class: 'btn btn-small btn-ghost', onclick: () => shareFlow(ui.activeId) }, 'שיתוף'),
      ),
      progress(done, items.length),
      items.length
        ? h('div', { class: 'thumb-strip' }, items.filter((i) => i.status === 'open').slice(0, 6).map((i) => thumb(i.snapshot, 's')))
        : h('p', { class: 'muted' }, 'הרשימה ריקה. חפשו מוצר והוסיפו בלחיצה.'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-primary grow', onclick: () => go('#list/' + ui.activeId) }, 'פתיחת הרשימה'),
        items.length ? h('button', { class: 'btn btn-secondary grow', onclick: () => go('#shop/' + ui.activeId) }, '🛒 מצב קניות') : null,
      ),
    ),
    quick.length ? h('section', {},
      h('h3', { class: 'section-title' }, frequent.length ? 'קונים לעיתים קרובות' : 'נוספו לאחרונה'),
      h('div', { class: 'chips-scroll' }, quick.map((x) => quickChip(x))),
    ) : null,
    h('section', {},
      h('div', { class: 'row between' }, h('h3', { class: 'section-title' }, 'רשימות נוספות'), h('button', { class: 'link-btn', onclick: () => go('#lists') }, 'כל הרשימות')),
      lists.length ? h('div', { class: 'list-cards' }, lists.map(listRow)) : h('p', { class: 'muted' }, 'אין רשימות נוספות עדיין.'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: newListFlow }, '+ רשימה חדשה'),
    ),
  );
}

function quickChip(x) {
  const p = getProduct(x.productKey) || { key: x.productKey, ...x.snapshot, size: { text: x.snapshot.sizeText } };
  return h('button', { class: 'quick-chip', onclick: () => quickAdd(p) },
    thumb(x.snapshot, 'xs'),
    h('span', { class: 'qc-text' }, h('b', {}, x.snapshot.name), h('small', {}, x.snapshot.sizeText || x.snapshot.brand || '')),
    h('span', { class: 'qc-plus', 'aria-hidden': 'true' }, '+'),
  );
}

function qtyEl(it, cls) {
  const t = Share.qtyText(it);
  return h('span', { class: cls, dir: t.startsWith('×') ? 'ltr' : 'rtl' }, t);
}

function progress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'progress-wrap' },
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { class: 'progress-bar', style: { width: pct + '%' } })),
    h('span', { class: 'progress-text' }, total ? `${done} מתוך ${total} הושלמו` : 'אין פריטים'),
  );
}

function sampleBanner() {
  if (!catalog.manifest?.isSample) return null;
  return h('div', { class: 'banner warn' },
    h('b', {}, 'קטלוג דוגמה. '),
    'המוצרים כאן הם נתוני דוגמה לפיתוח ואינם מיובאים מרשתות. להפקת קטלוג אמיתי מריצים את תהליך הייבוא (ראו הגדרות ← קטלוג).',
  );
}

// ================= חיפוש =================
let searchTimer;
async function renderSearch(v) {
  const st = ui.search;
  const input = h('input', {
    class: 'search-input', type: 'search', inputmode: 'search', enterkeyhint: 'search',
    placeholder: 'שם, מותג, קטגוריה או ברקוד', value: st.q, autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'חיפוש מוצרים',
  });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const brandSel = h('select', { class: 'select', 'aria-label': 'סינון לפי מותג' });
  const target = h('button', { class: 'target-chip', onclick: chooseTarget });

  const fillBrands = () => {
    const brands = catalog.index.length ? brandsFor(st.cat).slice(0, 200) : [];
    brandSel.replaceChildren(h('option', { value: '' }, 'כל המותגים'), ...brands.map((b) => h('option', { value: b, selected: b === st.brand }, b)));
  };
  const cats = h('div', { class: 'chips-scroll cat-chips', role: 'tablist' },
    h('button', { class: 'chip' + (!st.cat ? ' on' : ''), onclick: () => { st.cat = null; st.brand = null; rerender(); } }, 'הכול'),
    DEPARTMENTS.map((d) => h('button', { class: 'chip' + (st.cat === d.id ? ' on' : ''), onclick: () => { st.cat = st.cat === d.id ? null : d.id; st.brand = null; rerender(); } }, d.icon + ' ' + d.name)),
  );
  const rerender = () => {
    cats.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', i === 0 ? !st.cat : DEPARTMENTS[i - 1].id === st.cat));
    fillBrands();
    runSearch();
  };

  async function runSearch() {
    if (catalog.error) {
      fill(results, errorState('הקטלוג לא נטען (אין חיבור או שהשרת לא זמין). המוצרים האישיים והרשימות השמורות עדיין זמינים.', async () => {
        fill(results, loadingState());
        try { await loadCatalog({ force: true }); } catch {}
        rerender();
      }));
      if (!catalog.custom.length) return;
    }
    if (!catalog.manifest && !catalog.error) {
      fill(results, loadingState());
      try { await loadCatalog(); } catch { return runSearch(); }
      fillBrands();
    }
    const q = st.q.trim();
    if (!q && !st.cat && !st.brand) {
      fill(results, searchHome());
      return;
    }
    const found = search(q, { cat: st.cat, brand: st.brand || null });
    if (!found.length) {
      fill(results, emptyState('🔎', 'לא נמצאו מוצרים', q ? `אין תוצאות עבור "${q}". נסו מילה קצרה יותר או בדקו את הכתיב.` : 'אין מוצרים בסינון הזה.',
        h('button', { class: 'btn btn-secondary', onclick: () => customProductFlow({ name: q }) }, '+ הוספת מוצר ידנית')));
      return;
    }
    fill(results, 
      h('p', { class: 'result-count' }, found.length >= 80 ? 'מוצגות 80 התוצאות הראשונות — אפשר לדייק את החיפוש' : `${found.length} תוצאות`),
      ...found.map(productCard),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => customProductFlow({ name: q }) }, 'לא מצאתם? הוספת מוצר ידנית'),
    );
  }

  input.addEventListener('input', () => { st.q = input.value; clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  brandSel.addEventListener('change', () => { st.brand = brandSel.value || null; runSearch(); });

  const list = await S.getList(ui.activeId);
  target.replaceChildren(h('span', { class: 'muted' }, 'מוסיפים אל: '), h('b', {}, list?.name || ''), ' ▾');

  fill(v, 
    h('div', { class: 'search-head' },
      h('div', { class: 'search-box' }, h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '🔍'), input,
        st.q ? h('button', { class: 'icon-btn clear-btn', 'aria-label': 'נקה חיפוש', onclick: () => { st.q = ''; input.value = ''; runSearch(); input.focus(); } }, '✕') : null),
      cats,
      h('div', { class: 'row gap filter-row' }, target, brandSel),
    ),
    catalog.manifest?.isSample ? h('p', { class: 'sample-note' }, 'קטלוג דוגמה — לא מוצרים אמיתיים מרשתות') : null,
    results,
  );
  fillBrands();
  await runSearch();
  if (st.scroll) v.scrollTop = st.scroll;
  v.onscroll = () => { st.scroll = v.scrollTop; };
  if (!st.q && !st.cat) setTimeout(() => input.focus({ preventScroll: true }), 50);
}

function loadingState() {
  return h('div', { class: 'loading-state' }, ...Array.from({ length: 4 }, () => h('div', { class: 'skeleton' })));
}

function searchHome() {
  const wrap = h('div', {});
  S.history().then(({ recent }) => {
    if (!recent.length) {
      wrap.append(emptyState('🧺', 'מה צריך לקנות?', 'הקלידו שם מוצר, מותג או ברקוד. אפשר גם לבחור מחלקה למעלה.'));
      return;
    }
    wrap.append(h('h3', { class: 'section-title' }, 'הוספתם לאחרונה'),
      ...recent.slice(0, 12).map((x) => productCard(getProduct(x.productKey) || fromSnapshot(x.productKey, x.snapshot))));
  });
  return wrap;
}

function fromSnapshot(key, s) {
  return { key, name: s.name, brand: s.brand, size: s.sizeText ? { text: s.sizeText } : null, cat: s.cat, barcode: s.barcode, img: s.img, imgKey: s.imgKey, missingFromCatalog: true };
}

function inActive(p) {
  return ui.activeItems.find((i) => i.productKey === p.key && i.status === 'open');
}

/** כרטיס מוצר בתוצאות. ההוספה לא מנווטת לשום מקום — החיפוש נשמר. */
function productCard(p) {
  const card = h('article', { class: 'pcard' });
  const draw = () => {
    const it = inActive(p);
    const vc = variantCount(p);
    card.classList.toggle('in-list', !!it);
    card.replaceChildren(
      h('button', { class: 'pcard-main', onclick: () => productSheet(p), 'aria-label': 'פרטי מוצר: ' + p.name },
        thumb(p, 'm'),
        h('div', { class: 'pcard-text' },
          h('div', { class: 'pname' }, p.name),
          h('div', { class: 'pmeta' }, sizePill(p.size?.text), p.brand ? h('span', { class: 'brand' }, p.brand) : null),
          h('div', { class: 'ptags' },
            vc > 1 ? h('span', { class: 'tag tag-variant' }, `⚠ יש ${vc} גדלים/סוגים`) : null,
            p.custom ? h('span', { class: 'tag' }, 'מוצר אישי') : null,
            p.sample ? h('span', { class: 'tag tag-sample' }, 'דוגמה') : null,
            p.missingFromCatalog ? h('span', { class: 'tag' }, 'לא בקטלוג הנוכחי') : null,
          ),
        ),
      ),
      h('div', { class: 'pcard-action' },
        it
          ? stepper(it.qty, async (q) => { await setQty(it, q); draw(); })
          : h('button', { class: 'add-btn', 'aria-label': 'הוספה לרשימה: ' + p.name, onclick: async () => { await quickAdd(p); draw(); } }, '+'),
      ),
    );
  };
  draw();
  return card;
}

async function quickAdd(p, opts = {}) {
  const { item, wasExisting } = await S.addToList(ui.activeId, p, opts);
  await refreshActive();
  navigator.vibrate?.(10);
  toast(wasExisting ? `עודכן: ${p.name} ×${fmt(item.qty)}` : `נוסף: ${p.name}`, {
    action: 'בטל',
    onAction: async () => {
      if (wasExisting) await S.updateItem(item.id, { qty: S.round(item.qty - (opts.qty || 1)) });
      else await S.removeItem(item.id);
      await refreshActive();
      render();
    },
  });
  return item;
}

async function setQty(it, q) {
  if (q <= 0) {
    const removed = await S.removeItem(it.id);
    await refreshActive();
    toast(`הוסר: ${it.snapshot.name}`, { action: 'בטל', onAction: async () => { await S.restoreItem(removed); await refreshActive(); render(); } });
    return;
  }
  const r = await S.updateItem(it.id, { qty: q });
  it.qty = q;
  await refreshActive();
  return r;
}

async function chooseTarget() {
  const lists = (await S.allLists()).filter((l) => l.kind === 'list' && !l.archived);
  const s = sheet(h('div', { class: 'stack' },
    lists.map((l) => h('button', { class: 'option-row' + (l.id === ui.activeId ? ' on' : ''), onclick: async () => { await S.setActiveList(l.id); await refreshActive(); s.close(); render(); } },
      h('span', {}, l.name), h('small', { class: 'muted' }, `${l.stats.total} פריטים`))),
    h('button', { class: 'btn btn-ghost btn-block', onclick: async () => { s.close(); await newListFlow(); } }, '+ רשימה חדשה'),
  ), { title: 'לאיזו רשימה להוסיף?' });
}

// ---------- גיליון מוצר ----------
const QUICK_NOTES = ['האריזה הגדולה', 'האריזה הקטנה', 'הכי טרי', 'בשל', 'לא בשל מדי', 'בדיוק המוצר הזה'];

async function productSheet(p, { item = null } = {}) {
  const existing = item || inActive(p);
  let qty = existing?.qty || 1;
  let unit = existing?.unit || S.defaultUnit(p);
  let subst = existing?.subst || 'ask';
  const note = h('textarea', { class: 'input', rows: 2, placeholder: 'הערה, למשל: רק 3%, האריזה הגדולה…' }, existing?.note || '');
  const isFav = !!(await db.get('favorites', p.key));
  const favBtn = h('button', { class: 'icon-btn fav-btn' + (isFav ? ' on' : ''), 'aria-pressed': String(isFav), 'aria-label': 'מועדף',
    onclick: async () => { const on = await S.toggleFavorite(p); favBtn.classList.toggle('on', on); favBtn.setAttribute('aria-pressed', String(on)); favBtn.textContent = on ? '♥' : '♡'; } }, isFav ? '♥' : '♡');
  const variants = p.missingFromCatalog ? [] : variantsOf(p);

  const unitSel = h('select', { class: 'select', 'aria-label': 'יחידת מידה' }, Object.entries(S.UNITS).map(([k, v]) => h('option', { value: k, selected: k === unit }, v)));
  unitSel.onchange = () => { unit = unitSel.value; };

  const substRow = h('div', { class: 'seg' }, [['ask', 'לשאול'], ['same', 'רק אותו מותג'], ['any', 'מותג אחר בסדר'], ['none', 'בלי תחליף']].map(([k, label]) =>
    h('button', { class: 'seg-btn' + (subst === k ? ' on' : ''), onclick: (e) => { subst = k; e.currentTarget.parentNode.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, label)));

  const src = p.sources?.[0];
  const body = h('div', { class: 'psheet' },
    h('div', { class: 'psheet-top' }, thumb(p, 'xl'), favBtn),
    h('h2', { class: 'psheet-name' }, p.name),
    h('div', { class: 'pmeta big' }, sizePill(p.size?.text), p.brand ? h('span', { class: 'brand' }, p.brand) : null),
    h('dl', { class: 'facts' },
      h('dt', {}, 'מחלקה'), h('dd', {}, dept(p.cat).name + (p.sub ? ' · ' + p.sub : '')),
      p.barcode ? [h('dt', {}, 'ברקוד'), h('dd', { class: 'ltr' }, p.barcode)] : null,
      p.chains?.length ? [h('dt', {}, 'נמצא ב'), h('dd', {}, p.chains.map(chainName).join(', '))] : null,
      src ? [h('dt', {}, 'מקור'), h('dd', {}, src.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener' }, chainName(src.chain)) : chainName(src.chain), src.updated ? ' · עודכן ' + new Date(src.updated).toLocaleDateString('he-IL') : '')] : null,
      p.sample ? [h('dt', {}, 'הערה'), h('dd', {}, 'מוצר דוגמה — לא מיובא מרשת')] : null,
    ),
    variants.length ? h('div', { class: 'variants' },
      h('div', { class: 'variants-title' }, '⚠ שימו לב: יש גם גדלים או סוגים אחרים'),
      h('div', { class: 'chips-scroll' }, variants.slice(0, 12).map((x) =>
        h('button', { class: 'variant-chip', onclick: () => { s.close(); productSheet(x); } }, h('b', {}, x.size?.text || '—'), h('small', {}, x.name)))),
    ) : null,
    h('label', { class: 'field-label' }, 'כמות'),
    h('div', { class: 'row gap' }, stepper(qty, (q) => { qty = q || 1; }, { big: true, min: 0.25 }), unitSel),
    h('label', { class: 'field-label' }, 'הערה'),
    note,
    h('div', { class: 'chips-wrap' }, QUICK_NOTES.map((t) => h('button', { class: 'chip small', onclick: () => { note.value = note.value ? note.value + ', ' + t : t; } }, t))),
    h('label', { class: 'field-label' }, 'אם המוצר חסר'),
    substRow,
    h('button', { class: 'btn btn-primary btn-block btn-lg', onclick: async () => {
      if (existing) {
        await S.updateItem(existing.id, { qty, unit, note: note.value.trim(), subst });
        await refreshActive();
        toast('הפריט עודכן');
      } else {
        const { item: it } = await S.addToList(ui.activeId, p, { qty, unit, note: note.value.trim() });
        await S.updateItem(it.id, { subst, qty: it.qty, unit });
        await refreshActive();
        toast(`נוסף: ${p.name}`, { action: 'בטל', onAction: async () => { await S.removeItem(it.id); await refreshActive(); render(); } });
      }
      s.close();
      render();
    } }, existing ? 'עדכון ברשימה' : 'הוספה לרשימה'),
    p.custom ? h('button', { class: 'btn btn-ghost btn-block', onclick: () => { s.close(); customProductFlow(p); } }, 'עריכת המוצר האישי') : null,
  );
  const s = sheet(body, { title: existing ? 'כבר ברשימה' : 'הוספה לרשימה' });
}

export function chainName(id) {
  return { shufersal: 'שופרסל', ramilevy: 'רמי לוי', osherad: 'אושר עד', sample: 'נתוני דוגמה', custom: 'אישי' }[id] || id;
}

// ================= רשימה =================
async function renderList(v, id) {
  const list = await S.getList(id);
  if (!list) { fill(v, emptyState('🗒️', 'הרשימה לא נמצאה', 'ייתכן שנמחקה.', h('button', { class: 'btn btn-primary', onclick: () => go('#lists') }, 'לכל הרשימות'))); return; }
  const items = await S.listItems(id);
  const open = items.filter((i) => i.status === 'open');
  const bought = items.filter((i) => i.status === 'bought');
  const missing = items.filter((i) => i.status === 'missing');
  const isActive = id === ui.activeId;

  fill(v, 
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'לכל הרשימות', onclick: () => go('#lists') }, '›'),
      h('h1', { class: 'grow', onclick: () => renameList(list) }, list.name, list.kind === 'template' ? h('span', { class: 'tag' }, 'תבנית') : null),
      h('button', { class: 'icon-btn', 'aria-label': 'אפשרויות', onclick: () => listMenu(list) }, '⋯'),
    ),
    !isActive && list.kind === 'list' && !list.archived ? h('div', { class: 'banner' }, 'זו אינה הרשימה הפעילה. ', h('button', { class: 'link-btn', onclick: async () => { await S.setActiveList(id); await refreshActive(); render(); } }, 'הפוך לפעילה')) : null,
    list.kind === 'template' ? h('div', { class: 'banner' }, 'זו תבנית. ', h('button', { class: 'link-btn', onclick: () => fromTemplate(list) }, 'צור ממנה רשימת קנייה')) : null,
    progress(bought.length + missing.length, items.length),
    h('div', { class: 'row gap sticky-actions' },
      h('button', { class: 'btn btn-secondary grow', onclick: () => { if (!isActive && list.kind === 'list') S.setActiveList(id).then(refreshActive); go('#search'); } }, '+ הוספה'),
      items.length ? h('button', { class: 'btn btn-primary grow', onclick: () => go('#shop/' + id) }, '🛒 מצב קניות') : null,
      items.length ? h('button', { class: 'btn btn-ghost', onclick: () => shareFlow(id) }, 'שיתוף') : null,
    ),
    !items.length ? emptyState('🧺', 'הרשימה ריקה', 'הוסיפו מוצרים מהחיפוש או מהמועדפים.', h('button', { class: 'btn btn-primary', onclick: () => go('#search') }, 'חיפוש מוצרים')) : null,
    ...S.groupByDept(open).map((g) => h('section', { class: 'dept' },
      h('h3', { class: 'dept-title', style: { '--dept': g.dept.color } }, h('span', { 'aria-hidden': 'true' }, g.dept.icon), g.dept.name, h('small', {}, g.items.length)),
      g.items.map((it) => itemRow(it, list)))),
    missing.length ? h('section', { class: 'dept done-section' }, h('h3', { class: 'dept-title' }, '❌ לא נמצאו', h('small', {}, missing.length)), missing.map((it) => itemRow(it, list))) : null,
    bought.length ? h('details', { class: 'dept done-section', open: bought.length < 8 },
      h('summary', { class: 'dept-title' }, '✅ נקנו', h('small', {}, bought.length)),
      bought.map((it) => itemRow(it, list)),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => clearBought(list, bought) }, 'הסרת הפריטים שנקנו מהרשימה')) : null,
  );
}

function itemRow(it, list) {
  const s = it.snapshot;
  const done = it.status !== 'open';
  return h('div', { class: 'irow' + (done ? ' done ' + it.status : '') },
    h('button', { class: 'check' + (it.status === 'bought' ? ' on' : ''), role: 'checkbox', 'aria-checked': String(it.status === 'bought'), 'aria-label': 'סימון נקנה: ' + s.name,
      onclick: () => setStatus(it, it.status === 'bought' ? 'open' : 'bought') }, it.status === 'bought' ? '✓' : it.status === 'missing' ? '✕' : ''),
    h('button', { class: 'irow-main', onclick: () => itemSheet(it, list) },
      thumb(s, 's'),
      h('div', { class: 'irow-text' },
        h('div', { class: 'pname' }, s.name),
        h('div', { class: 'pmeta' }, sizePill(s.sizeText), s.brand ? h('span', { class: 'brand' }, s.brand) : null),
        it.note || Share.SUBST[it.subst] ? h('div', { class: 'inote' }, [it.note, Share.SUBST[it.subst]].filter(Boolean).join(' · ')) : null,
      ),
    ),
    done ? qtyEl(it, 'qty-badge') : stepper(it.qty, async (q) => { await setQty(it, q); render(); }),
  );
}

async function setStatus(it, status) {
  const prev = it.status;
  await S.updateItem(it.id, { status });
  await refreshActive();
  render();
  const label = { bought: 'סומן כנקנה', missing: 'סומן כלא נמצא', open: 'הוחזר לרשימה' }[status];
  toast(`${label}: ${it.snapshot.name}`, { action: 'בטל', onAction: async () => { await S.updateItem(it.id, { status: prev }); await refreshActive(); render(); } });
}

async function clearBought(list, bought) {
  for (const it of bought) await S.removeItem(it.id);
  await refreshActive();
  render();
  toast(`הוסרו ${bought.length} פריטים`, { action: 'בטל', onAction: async () => { for (const it of bought) await S.restoreItem(it); await refreshActive(); render(); } });
}

async function itemSheet(it, list) {
  const p = getProduct(it.productKey) || fromSnapshot(it.productKey, it.snapshot);
  if (!p.img && it.snapshot.imgKey) p.imgKey = it.snapshot.imgKey;
  await productSheet(p, { item: it });
  const panel = [...document.querySelectorAll('.sheet')].pop();
  panel?.querySelector('.sheet-body .psheet')?.append(
    h('div', { class: 'row gap' },
      h('button', { class: 'btn btn-secondary grow', onclick: async () => { closeAllSheets(); await setStatus(it, it.status === 'missing' ? 'open' : 'missing'); } }, it.status === 'missing' ? 'החזר לרשימה' : 'לא נמצא'),
      h('button', { class: 'btn btn-danger grow', onclick: async () => {
        closeAllSheets();
        const removed = await S.removeItem(it.id);
        await refreshActive(); render();
        toast(`הוסר: ${it.snapshot.name}`, { action: 'בטל', onAction: async () => { await S.restoreItem(removed); await refreshActive(); render(); } });
      } }, 'הסרה'),
    ),
  );
}

async function renameList(list) {
  const name = await promptDialog('שם הרשימה', list.name);
  if (name) { await S.updateList(list.id, { name }); render(); }
}

async function listMenu(list) {
  const act = (fn) => async () => { s.close(); await fn(); };
  const s = sheet(h('div', { class: 'stack' },
    h('button', { class: 'option-row', onclick: act(() => renameList(list)) }, 'שינוי שם'),
    list.kind === 'list' && list.id !== ui.activeId ? h('button', { class: 'option-row', onclick: act(async () => { await S.setActiveList(list.id); await refreshActive(); render(); toast('הרשימה הוגדרה כפעילה'); }) }, 'הגדרה כרשימה הפעילה') : null,
    h('button', { class: 'option-row', onclick: act(async () => { const l = await S.duplicateList(list.id, { kind: 'list', name: list.kind === 'template' ? list.name + ' — ' + new Date().toLocaleDateString('he-IL') : undefined }); go('#list/' + l.id); toast('נוצר עותק'); }) }, list.kind === 'template' ? 'יצירת רשימת קנייה מהתבנית' : 'שכפול (רשימה חדשה מהקנייה הזו)'),
    list.kind === 'list' ? h('button', { class: 'option-row', onclick: act(async () => { const name = await promptDialog('שם התבנית', list.name); if (!name) return; await S.duplicateList(list.id, { kind: 'template', name }); toast('נשמר כתבנית'); }) }, 'שמירה כתבנית') : null,
    h('button', { class: 'option-row', onclick: act(() => shareFlow(list.id)) }, 'שיתוף'),
    h('button', { class: 'option-row', onclick: act(async () => {
      await S.updateList(list.id, { archived: !list.archived });
      if (!list.archived && list.id === ui.activeId) { await S.ensureDefaults(); await refreshActive(); }
      toast(list.archived ? 'הוחזר מהארכיון' : 'הועבר לארכיון'); go('#lists');
    }) }, list.archived ? 'החזרה מהארכיון' : 'העברה לארכיון'),
    h('button', { class: 'option-row danger', onclick: act(async () => {
      if (!(await confirmDialog(`למחוק את "${list.name}"? אפשר יהיה לבטל מיד אחרי המחיקה.`, { ok: 'מחיקה', danger: true }))) return;
      const backup = await S.deleteList(list.id);
      if (list.id === ui.activeId) { await S.ensureDefaults(); }
      await refreshActive();
      go('#lists');
      toast('הרשימה נמחקה', { action: 'בטל', ms: 7000, onAction: async () => { await S.restoreList(backup); await refreshActive(); render(); } });
    }) }, 'מחיקה'),
  ), { title: list.name });
}

async function fromTemplate(t) {
  const l = await S.duplicateList(t.id, { kind: 'list', name: t.name + ' — ' + new Date().toLocaleDateString('he-IL') });
  await S.setActiveList(l.id);
  await refreshActive();
  go('#list/' + l.id);
  toast('נוצרה רשימה מהתבנית והוגדרה כפעילה');
}

// ================= מצב קניות =================
let wakeLock = null;
async function renderShop(v, id) {
  const list = await S.getList(id);
  if (!list) return go('#lists');
  const items = await S.listItems(id);
  const open = items.filter((i) => i.status === 'open');
  const done = items.filter((i) => i.status !== 'open').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  try { if (!wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch {}

  const shopCard = (it) => {
    const s = it.snapshot;
    const isDone = it.status !== 'open';
    return h('article', { class: 'scard' + (isDone ? ' done ' + it.status : '') },
      h('div', { class: 'scard-top', onclick: () => itemSheet(it, list) },
        thumb(s, 'l'),
        h('div', { class: 'scard-text' },
          h('div', { class: 'sname' }, s.name),
          h('div', { class: 'pmeta big' }, sizePill(s.sizeText), s.brand ? h('span', { class: 'brand' }, s.brand) : null),
          h('div', { class: 'sqty-row' }, h('span', { class: 'sqty-label' }, 'כמות'), qtyEl(it, 'sqty')),
          it.note || Share.SUBST[it.subst] ? h('div', { class: 'inote big' }, [it.note, Share.SUBST[it.subst]].filter(Boolean).join(' · ')) : null,
        ),
      ),
      isDone
        ? h('div', { class: 'row gap' }, h('span', { class: 'status-label grow' }, it.status === 'bought' ? '✅ נקנה' : '❌ לא נמצא'), h('button', { class: 'btn btn-ghost', onclick: () => setStatus(it, 'open') }, 'החזרה'))
        : h('div', { class: 'row gap' },
            h('button', { class: 'btn btn-bought grow', onclick: () => setStatus(it, 'bought') }, '✓ נקנה'),
            h('button', { class: 'btn btn-missing', onclick: () => setStatus(it, 'missing') }, 'לא נמצא')),
    );
  };

  fill(v, 
    h('header', { class: 'topbar shop-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'יציאה ממצב קניות', onclick: () => { wakeLock?.release?.(); wakeLock = null; go('#list/' + id); } }, '✕'),
      h('h1', { class: 'grow' }, list.name),
    ),
    progress(done.length, items.length),
    !open.length && items.length ? h('div', { class: 'banner ok' }, '🎉 סיימתם! כל הפריטים טופלו.') : null,
    ...S.groupByDept(open).map((g) => h('section', { class: 'dept' },
      h('h3', { class: 'dept-title', style: { '--dept': g.dept.color } }, h('span', { 'aria-hidden': 'true' }, g.dept.icon), g.dept.name), g.items.map(shopCard))),
    done.length ? h('section', { class: 'dept done-section' }, h('h3', { class: 'dept-title' }, 'טופלו', h('small', {}, done.length)), done.map(shopCard)) : null,
  );
}

// ================= רשימות =================
async function renderLists(v) {
  const lists = await S.allLists();
  const active = lists.filter((l) => l.kind === 'list' && !l.archived);
  const templates = lists.filter((l) => l.kind === 'template' && !l.archived);
  const archived = lists.filter((l) => l.archived);
  fill(v, 
    topbar('הרשימות שלי', h('button', { class: 'btn btn-small btn-primary', onclick: newListFlow }, '+ חדשה')),
    h('div', { class: 'list-cards' }, active.map(listRow)),
    h('h3', { class: 'section-title' }, 'תבניות'),
    templates.length ? h('div', { class: 'list-cards' }, templates.map(listRow)) : h('p', { class: 'muted' }, 'אין תבניות. אפשר לשמור כל רשימה כתבנית מתפריט ⋯.'),
    archived.length ? h('details', { class: 'archived' }, h('summary', { class: 'section-title' }, `ארכיון (${archived.length})`), h('div', { class: 'list-cards' }, archived.map(listRow))) : null,
  );
}

function listRow(l) {
  const isActive = l.id === ui.activeId;
  return h('button', { class: 'list-row' + (isActive ? ' active' : ''), onclick: () => go('#list/' + l.id) },
    h('div', { class: 'grow' },
      h('div', { class: 'lname' }, l.name, isActive ? h('span', { class: 'tag tag-active' }, 'פעילה') : null, l.kind === 'template' ? h('span', { class: 'tag' }, 'תבנית') : null),
      h('div', { class: 'muted small' }, `${l.stats.total} פריטים${l.stats.total ? ` · ${l.stats.done} הושלמו` : ''} · ${relTime(l.updatedAt)}`),
    ),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '‹'),
  );
}

async function newListFlow() {
  const lists = await S.allLists();
  const templates = lists.filter((l) => l.kind === 'template' && !l.archived);
  const prev = lists.filter((l) => l.kind === 'list' && l.stats.total > 0).slice(0, 6);
  const act = (fn) => async () => { s.close(); await fn(); };
  const s = sheet(h('div', { class: 'stack' },
    h('button', { class: 'option-row', onclick: act(async () => {
      const name = await promptDialog('שם הרשימה', '', { placeholder: 'למשל: קנייה לשבת' });
      if (!name) return;
      const l = await S.createList(name);
      await S.setActiveList(l.id); await refreshActive(); go('#list/' + l.id);
    }) }, h('b', {}, 'רשימה ריקה')),
    templates.length ? h('div', { class: 'field-label' }, 'מתבנית') : null,
    templates.map((t) => h('button', { class: 'option-row', onclick: act(() => fromTemplate(t)) }, t.name, h('small', { class: 'muted' }, `${t.stats.total} פריטים`))),
    prev.length ? h('div', { class: 'field-label' }, 'מקנייה קודמת') : null,
    prev.map((l) => h('button', { class: 'option-row', onclick: act(async () => {
      const n = await S.duplicateList(l.id, { name: 'קנייה — ' + new Date().toLocaleDateString('he-IL') });
      await S.setActiveList(n.id); await refreshActive(); go('#list/' + n.id);
    }) }, l.name, h('small', { class: 'muted' }, `${l.stats.total} פריטים`))),
  ), { title: 'רשימה חדשה' });
}

// ================= מועדפים =================
async function renderFavs(v) {
  const [favs, { recent, frequent }] = await Promise.all([S.favorites(), S.history()]);
  const tabs = [['fav', `מועדפים (${favs.length})`], ['freq', 'קונים הרבה'], ['recent', 'אחרונים']];
  const src = { fav: favs, freq: frequent, recent }[ui.favTab];
  fill(v, 
    topbar('מועדפים'),
    h('div', { class: 'seg' }, tabs.map(([k, label]) => h('button', { class: 'seg-btn' + (ui.favTab === k ? ' on' : ''), onclick: () => { ui.favTab = k; render(); } }, label))),
    src.length
      ? h('div', { class: 'results' }, src.map((x) => productCard(getProduct(x.productKey) || fromSnapshot(x.productKey, x.snapshot))))
      : emptyState(ui.favTab === 'fav' ? '♡' : '🕘', ui.favTab === 'fav' ? 'אין מועדפים עדיין' : 'אין היסטוריה עדיין',
          ui.favTab === 'fav' ? 'בדף מוצר לוחצים על ♡ כדי לשמור אותו כאן.' : 'מוצרים שתוסיפו לרשימות יופיעו כאן.'),
  );
}

// ================= שיתוף =================
async function shareFlow(listId) {
  const list = await S.getList(listId);
  const all = await S.listItems(listId);
  if (!all.length) { toast('הרשימה ריקה — אין מה לשתף'); return; }
  let includeDone = false;
  const preview = h('div', { class: 'share-preview' });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const items = () => Share.itemsForShare(all, includeDone);
  let prepared = { images: null, pdf: null };

  const toggle = h('label', { class: 'switch-row' },
    h('input', { type: 'checkbox', onchange: (e) => { includeDone = e.target.checked; prepared = { images: null, pdf: null }; fill(preview, ); status.textContent = ''; } }),
    h('span', {}, 'לכלול גם פריטים שכבר נקנו'));

  const textBlock = h('div', { class: 'share-block' },
    h('h3', {}, '💬 הודעת טקסט'),
    h('p', { class: 'muted small' }, 'שמות, גדלים, כמויות והערות. בלי תמונות.'),
    h('div', { class: 'row gap wrap' },
      Share.canShareText() ? h('button', { class: 'btn btn-primary', onclick: async () => { const r = await Share.shareText(Share.buildText(list, items()), list.name); if (r.startsWith('error')) toast('השיתוף נכשל'); } }, 'שיתוף טקסט') : null,
      h('button', { class: 'btn btn-secondary', onclick: async () => {
        try { await navigator.clipboard.writeText(Share.buildText(list, items())); toast('הטקסט הועתק — הדביקו בוואטסאפ'); }
        catch { showTextFallback(Share.buildText(list, items())); }
      } }, 'העתקה'),
      h('a', { class: 'btn btn-ghost', href: '#', onclick: (e) => { e.preventDefault(); window.open(Share.whatsappTextURL(Share.buildText(list, items())), '_blank'); } }, 'פתיחה בוואטסאפ (טקסט בלבד)'),
    ),
  );

  const imgBtn = h('button', { class: 'btn btn-primary', onclick: async () => {
    if (prepared.images) return doShareFiles(prepared.images, 'images');
    imgBtn.disabled = true; status.textContent = 'מכין תמונות…';
    try {
      prepared.images = await Share.buildImages(list, items());
      showPrepared(prepared.images, 'images');
      imgBtn.textContent = Share.canShareFiles(prepared.images) ? `שיתוף ${prepared.images.length} תמונות` : 'התמונות מוכנות למטה';
      // ניסיון לפתוח את גיליון השיתוף מיד; אם Safari דורש לחיצה חדשה — הכפתור מוכן לכך
      if (Share.canShareFiles(prepared.images)) await doShareFiles(prepared.images, 'images');
    } catch (e) { status.textContent = 'יצירת התמונות נכשלה: ' + e.message; }
    imgBtn.disabled = false;
  } }, 'הכנת תמונות');

  const pdfBtn = h('button', { class: 'btn btn-secondary', onclick: async () => {
    if (prepared.pdf) return doShareFiles([prepared.pdf], 'pdf');
    pdfBtn.disabled = true; status.textContent = 'מכין PDF…';
    try {
      prepared.pdf = await Share.buildPdf(list, items());
      showPrepared([prepared.pdf], 'pdf');
      pdfBtn.textContent = Share.canShareFiles([prepared.pdf]) ? 'שיתוף PDF' : 'ה-PDF מוכן למטה';
      if (Share.canShareFiles([prepared.pdf])) await doShareFiles([prepared.pdf], 'pdf');
    } catch (e) { status.textContent = 'יצירת ה-PDF נכשלה: ' + e.message; }
    pdfBtn.disabled = false;
  } }, 'הכנת PDF');

  function showPrepared(files, kind) {
    const can = Share.canShareFiles(files);
    status.textContent = kind === 'images'
      ? `${files.length} ${files.length === 1 ? 'תמונה מוכנה' : 'תמונות מוכנות'}. ${can ? 'לחצו "שיתוף" ובחרו וואטסאפ.' : 'הדפדפן לא תומך בשיתוף קבצים: שמרו (לחיצה ארוכה על תמונה ← "שמירה לתמונות" או הורדה) ושלחו ידנית מוואטסאפ.'}`
      : `PDF מוכן (${Math.round(files[0].size / 1024)} KB). ${can ? 'לחצו "שיתוף PDF".' : 'פתחו או הורידו ושלחו ידנית.'}`;
    fill(preview, ...files.map((f) => {
      const url = URL.createObjectURL(f);
      return h('div', { class: 'prep' },
        kind === 'images' ? h('img', { src: url, alt: f.name, class: 'prep-img' }) : h('div', { class: 'prep-pdf' }, '📄 ' + f.name),
        h('a', { class: 'btn btn-small btn-ghost', href: url, download: f.name, target: '_blank' }, kind === 'images' ? 'הורדה' : 'פתיחה / הורדה'));
    }));
  }

  async function doShareFiles(files, kind) {
    // כאן הקבצים כבר מוכנים — הקריאה ל-share מתבצעת מיד בלחיצה (דרישת Safari)
    const r = await Share.shareFiles(files, list.name);
    if (r === 'unsupported') status.textContent = 'שיתוף קבצים לא נתמך כאן. השתמשו בהורדה/שמירה מלמטה.';
    else if (r === 'blocked') status.textContent = 'הקבצים מוכנים — לחצו על כפתור השיתוף ובחרו וואטסאפ.';
    else if (r.startsWith('error')) status.textContent = 'השיתוף נכשל (' + r.slice(6) + '). אפשר לנסות שוב או לשמור ידנית.';
  }

  sheet(h('div', { class: 'share' },
    h('p', { class: 'banner' }, 'השיתוף שולח צילום מצב של הרשימה עכשיו. שינויים מאוחרים יותר לא יתעדכנו אצל הנמען.'),
    toggle,
    textBlock,
    h('div', { class: 'share-block' },
      h('h3', {}, '🖼️ תמונות או PDF'),
      h('p', { class: 'muted small' }, 'כל מוצר עם תמונה, שם, גודל, כמות והערות. רשימה ארוכה מתחלקת לכמה עמודים קריאים.'),
      h('div', { class: 'row gap wrap' }, imgBtn, pdfBtn),
      status,
      preview,
    ),
  ), { title: 'שיתוף: ' + list.name, full: true });
}

function showTextFallback(text) {
  const ta = h('textarea', { class: 'input', rows: 12, readonly: true }, text);
  sheet(h('div', {}, h('p', { class: 'muted' }, 'לא ניתן היה להעתיק אוטומטית. סמנו את הטקסט והעתיקו:'), ta), { title: 'טקסט לשיתוף' });
  setTimeout(() => { ta.focus(); ta.select(); }, 100);
}

// ================= מוצר ידני =================
async function customProductFlow(initial = {}) {
  const editing = !!initial.custom;
  const d = { name: initial.name || '', brand: initial.brand || '', sizeAmount: initial.sizeAmount || '', sizeUnit: initial.sizeUnit || 'g', cat: initial.cat || 'other', barcode: initial.barcode || '', imgKey: initial.imgKey || null };
  let newImg = null;
  const prev = h('div', { class: 'photo-prev' }, d.imgKey ? thumb({ imgKey: d.imgKey, cat: d.cat, name: d.name }, 'l') : h('span', { class: 'muted' }, 'אין תמונה'));
  const file = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'photo-in' });
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      newImg = await resizeImage(f, 900);
      prev.replaceChildren(h('img', { src: URL.createObjectURL(newImg), alt: 'תמונה שנבחרה' }));
    } catch { toast('לא ניתן לקרוא את התמונה'); }
  };
  const f = (label, el) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el);
  const name = h('input', { class: 'input', value: d.name, required: true, placeholder: 'למשל: חומוס אבו גוש' });
  const brand = h('input', { class: 'input', value: d.brand, placeholder: 'מותג (לא חובה)' });
  const amount = h('input', { class: 'input', value: d.sizeAmount, inputmode: 'decimal', placeholder: 'כמות' });
  const unit = h('select', { class: 'select' }, [['g', 'גרם'], ['kg', 'ק״ג'], ['ml', 'מ״ל'], ['l', 'ליטר'], ['unit', 'יח׳']].map(([k, l]) => h('option', { value: k, selected: k === d.sizeUnit }, l)));
  const cat = h('select', { class: 'select' }, DEPARTMENTS.map((x) => h('option', { value: x.id, selected: x.id === d.cat }, x.name)));
  const barcode = h('input', { class: 'input ltr', value: d.barcode, inputmode: 'numeric', placeholder: 'לא חובה' });

  const save = async (addAlso) => {
    if (!name.value.trim()) { name.focus(); toast('חסר שם מוצר'); return; }
    const { makeSize } = await import('./hebrew.js');
    const size = amount.value ? makeSize(amount.value, { g: 'גרם', kg: 'קג', ml: 'מל', l: 'ליטר', unit: 'יחידות' }[unit.value]) : null;
    let imgKey = d.imgKey;
    if (newImg) imgKey = await S.saveUserImage(newImg);
    const prod = await S.saveCustom({
      id: editing ? initial.id : undefined, name: name.value.trim(), brand: brand.value.trim(), size,
      sizeAmount: amount.value, sizeUnit: unit.value, cat: cat.value, barcode: barcode.value.replace(/\D/g, ''), imgKey, chains: ['custom'],
    });
    setCustomProducts(await S.customProducts());
    s.close();
    if (addAlso) await quickAdd({ ...prod, key: 'u:' + prod.id, custom: true });
    else toast('המוצר נשמר');
    render();
  };

  const s = sheet(h('div', { class: 'form' },
    h('div', { class: 'photo-field' }, prev, h('label', { for: 'photo-in', class: 'btn btn-secondary' }, '📷 צילום או בחירה מהגלריה'), file),
    f('שם המוצר *', name), f('מותג', brand),
    h('div', { class: 'row gap' }, f('גודל אריזה', amount), f('יחידה', unit)),
    f('מחלקה', cat), f('ברקוד', barcode),
    h('button', { class: 'btn btn-primary btn-block btn-lg', onclick: () => save(!editing) }, editing ? 'שמירה' : 'שמירה והוספה לרשימה'),
    !editing ? h('button', { class: 'btn btn-ghost btn-block', onclick: () => save(false) }, 'שמירה בלבד') : null,
    editing ? h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
      if (!(await confirmDialog('למחוק את המוצר האישי? פריטים שכבר ברשימות יישארו.', { ok: 'מחיקה', danger: true }))) return;
      await S.deleteCustom(initial.id); setCustomProducts(await S.customProducts()); s.close(); render();
    } }, 'מחיקת המוצר') : null,
  ), { title: editing ? 'עריכת מוצר אישי' : 'מוצר חדש', full: true });
}

async function resizeImage(file, max) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.85));
}

// ================= הגדרות =================
async function renderSettings(v) {
  const st = await storageStatus();
  const custom = await S.customProducts();
  const m = catalog.manifest;
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'restore-in' });
  fileIn.onchange = () => fileIn.files?.[0] && restoreFlow(fileIn.files[0]);

  fill(v, 
    topbar('הגדרות וגיבוי'),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'שמירה במכשיר'),
      h('p', {}, 'הרשימות, המועדפים והמוצרים האישיים נשמרים רק באייפון הזה (בדפדפן), בלי חשבון ובלי שרת.'),
      h('p', { class: 'banner warn' }, 'שמירה בדפדפן אינה גיבוי מובטח: מחיקת נתוני האתר (הגדרות ← Safari ← מתקדם ← נתוני אתרים), הסרת האפליקציה ממסך הבית או ניקוי של iOS עלולים למחוק את המידע. מומלץ לייצא גיבוי מדי פעם.'),
      h('dl', { class: 'facts' },
        h('dt', {}, 'אחסון קבוע'), h('dd', {}, st.persisted == null ? 'לא ידוע בדפדפן זה' : st.persisted ? '✅ אושר' : '— לא אושר (מגדילים סיכוי ע״י הוספה למסך הבית)'),
        st.usage != null ? [h('dt', {}, 'נפח בשימוש'), h('dd', {}, `${(st.usage / 1048576).toFixed(1)} MB`)] : null,
        h('dt', {}, 'מצב'), h('dd', {}, standalone ? 'פועל מהמסך הבית ✅' : 'פועל בתוך Safari'),
      ),
      !standalone ? h('p', { class: 'muted small' }, 'להתקנה: ב-Safari לוחצים על כפתור השיתוף ⬆︎ ← "הוספה למסך הבית". שימו לב: מידע ששמרתם ב-Safari לא עובר אוטומטית לאפליקציה שבמסך הבית — העבירו אותו בעזרת גיבוי ושחזור.') : null,
      st.persisted === false ? h('button', { class: 'btn btn-ghost', onclick: async () => { const ok = await requestPersist(); toast(ok ? 'אחסון קבוע אושר' : 'הדפדפן לא אישר אחסון קבוע'); render(); } }, 'בקשת אחסון קבוע') : null,
    ),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'גיבוי ושחזור'),
      h('p', { class: 'muted small' }, 'קובץ אחד עם כל הרשימות, ההערות, המועדפים, המוצרים האישיים והתמונות שלהם. שמרו אותו ב"קבצים" או ב-iCloud Drive.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn btn-primary', onclick: backupFlow }, 'ייצוא גיבוי'),
        h('label', { for: 'restore-in', class: 'btn btn-secondary' }, 'שחזור מקובץ'), fileIn,
      ),
    ),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, `מוצרים אישיים (${custom.length})`), h('button', { class: 'btn btn-small btn-secondary', onclick: () => customProductFlow() }, '+ הוספה')),
      custom.length ? h('div', { class: 'stack' }, custom.map((c) => h('button', { class: 'option-row', onclick: () => customProductFlow({ ...c, custom: true }) },
        h('span', { class: 'row gap' }, thumb(c, 'xs'), c.name), h('small', { class: 'muted' }, c.size?.text || '')))) : h('p', { class: 'muted small' }, 'מוצרים שחסרים בקטלוג — עם תמונה מהמצלמה או מהגלריה.'),
    ),
    catalogCard(m),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'תחזוקה'),
      h('button', { class: 'btn btn-ghost', onclick: async () => { const n = await S.pruneImages(); toast(`נוקו ${n} תמונות שאינן בשימוש`); } }, 'ניקוי תמונות שאינן בשימוש'),
    ),
  );
}

function catalogCard(m) {
  if (catalog.error && !m) return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'קטלוג'), errorState('הקטלוג לא נטען.', async () => { try { await loadCatalog({ force: true }); } catch {} render(); }));
  if (!m) return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'קטלוג'), loadingState());
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'קטלוג וכיסוי'),
    m.isSample ? h('p', { class: 'banner warn' }, 'כרגע נטען קטלוג דוגמה מסומן — לא מוצרים שיובאו מרשתות. הרצת תהליך הייבוא מחליפה אותו.') : null,
    h('dl', { class: 'facts' },
      h('dt', {}, 'מוצרים'), h('dd', {}, (m.total ?? catalog.products.length).toLocaleString('he-IL')),
      m.withImages != null ? [h('dt', {}, 'עם תמונה'), h('dd', {}, m.withImages.toLocaleString('he-IL'))] : null,
      m.withBarcode != null ? [h('dt', {}, 'עם ברקוד'), h('dd', {}, m.withBarcode.toLocaleString('he-IL'))] : null,
      h('dt', {}, 'נוצר'), h('dd', {}, new Date(m.generatedAt).toLocaleString('he-IL')),
    ),
    h('table', { class: 'sources' },
      h('thead', {}, h('tr', {}, h('th', {}, 'מקור'), h('th', {}, 'מצב'), h('th', {}, 'מוצרים'))),
      h('tbody', {}, (m.sources || []).map((s) => h('tr', {},
        h('td', {}, chainName(s.id)),
        h('td', { class: s.status === 'ok' ? 'ok' : 'bad' }, { ok: 'יובא', error: 'לא זמין', skipped: 'דולג', sample: 'דוגמה' }[s.status] || s.status, s.error ? h('div', { class: 'muted small' }, s.error) : null),
        h('td', {}, (s.count ?? 0).toLocaleString('he-IL'))))),
    ),
    h('p', { class: 'muted small' }, 'הקטלוג אינו כולל בהכרח את כל מוצרי הסופר — רק את מה שיובא מהמקורות שלמעלה.'),
  );
}

async function backupFlow() {
  toast('מכין גיבוי…', { ms: 1500 });
  const file = await exportBackup();
  const url = URL.createObjectURL(file);
  const can = Share.canShareFiles([file]);
  sheet(h('div', { class: 'stack' },
    h('p', {}, `הגיבוי מוכן (${(file.size / 1024).toFixed(0)} KB).`),
    can ? h('button', { class: 'btn btn-primary btn-block', onclick: async () => { const r = await Share.shareFiles([file], 'גיבוי קניות'); if (r === 'shared') toast('הגיבוי נשלח/נשמר'); } }, 'שמירה ב"קבצים" / שיתוף') : null,
    h('a', { class: 'btn btn-secondary btn-block', href: url, download: file.name }, 'הורדת הקובץ'),
    h('p', { class: 'muted small' }, 'מומלץ: "שמירה בקבצים" ← iCloud Drive.'),
  ), { title: 'ייצוא גיבוי' });
}

async function restoreFlow(file) {
  let info;
  try { info = await inspectBackup(file); }
  catch (e) { toast('הגיבוי לא תקין: ' + e.message, { ms: 7000 }); return; }
  const c = info.counts || {};
  const ok = await confirmDialog(
    `גיבוי מ־${new Date(info.exportedAt).toLocaleString('he-IL')}: ${c.lists} רשימות, ${c.items} פריטים, ${c.custom} מוצרים אישיים, ${c.images} תמונות. ${info.verified ? 'תקינות אומתה ✅.' : ''} השחזור יחליף את כל המידע הנוכחי במכשיר.`,
    { ok: 'שחזור', danger: true });
  if (!ok) return;
  await restoreBackup(info.backup, 'replace');
  setCustomProducts(await S.customProducts());
  await S.ensureDefaults();
  await refreshActive();
  toast('השחזור הושלם');
  go('#home');
}

// ---------- מקלדת באייפון ----------
function setupKeyboardAwareness() {
  // מסתירים את סרגל הלשוניות כשהמקלדת פתוחה כדי שלא "יקפוץ" מעליה
  document.addEventListener('focusin', (e) => { if (e.target.matches('input:not([type=checkbox]):not([type=file]), textarea')) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches?.('input, textarea')) document.body.classList.remove('kb'); }, 50));
}

window.__app = { db, S, catalog, go, render }; // לבדיקות אוטומטיות
boot();
