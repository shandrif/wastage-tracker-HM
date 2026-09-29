(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (n, d = 0) => (n ?? 0).toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const pct = (f, d = 2) => f == null ? '–' : (f * 100).toFixed(d) + '%';
const CODE_RE = /(?:^|\b)([A-Za-z]\d{1,3})(?=\b|[^0-9])/;

const state = {
  records: [], sales: [], mapping: [], mapCustom: false,
  stores: [], am: '', high: 0.014, low: 0.01,
  sort: {}, charts: {}, tab: 'overview', files: []
};

// ---------- mapping ----------
function loadMapping(rows, custom) {
  state.mapping = rows; state.mapCustom = custom;
  $('mapInfo').textContent = `${custom ? 'Custom' : 'Built-in'} mapping: ${rows.length} rows, ${new Set(rows.map(r => r.am)).size} area managers`;
  const sel = $('amSelect'), cur = sel.value;
  sel.innerHTML = '<option value="">All area managers</option>' +
    [...new Set(rows.map(r => r.am))].sort().map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur; else { sel.value = ''; state.am = ''; }
}
function parseMappingRows(aoa) {
  const hi = aoa.findIndex(r => r.some(c => /area manager/i.test(c)));
  if (hi < 0) throw new Error('Mapping file needs an "Area Manager" column');
  const h = aoa[hi].map(c => norm(c));
  const col = re => h.findIndex(x => re.test(x));
  const ci = { code: col(/^code$/), branch: col(/branch|store/), am: col(/area manager/), rom: col(/^rom/), region: col(/reigon|region/), city: col(/city/) };
  const out = [];
  for (const r of aoa.slice(hi + 1)) {
    const am = clean(r[ci.am]), branch = ci.branch >= 0 ? clean(r[ci.branch]) : '';
    if (!am || (!branch && !clean(r[ci.code]))) continue;
    out.push({ code: ci.code >= 0 ? clean(r[ci.code]).toUpperCase() : '', branch, am, rom: ci.rom >= 0 ? clean(r[ci.rom]) : '',
      region: ci.region >= 0 ? clean(r[ci.region]) : '', city: ci.city >= 0 ? clean(r[ci.city]) : '' });
  }
  return out;
}

// ---------- file parsing ----------
const readWB = async f => XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
const toAOA = ws => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
function toDay(v) {
  if (typeof v === 'number') return Math.floor(v);
  const t = Date.parse(v); return isFinite(t) ? Math.floor(t / 864e5) + 25569 : null;
}
const dayISO = d => new Date(Date.UTC(1899, 11, 30) + d * 864e5).toISOString().slice(0, 10);

function parseRecords(aoa) {
  const hi = aoa.findIndex(r => r.some(c => /wastage value/i.test(c)) && r.some(c => /storage/i.test(c)));
  if (hi < 0) return null;
  const h = aoa[hi].map(norm), col = re => h.findIndex(x => re.test(x));
  const c = { code: col(/^code/), name: col(/stock|product|item/), um: col(/^u\/m|unit of/), qty: col(/quantity/), price: col(/unit pr/),
    val: col(/wastage value/), date: col(/date/), storage: col(/storage/), cat: col(/category/) };
  const out = [];
  for (const r of aoa.slice(hi + 1)) {
    const storage = clean(r[c.storage]), name = clean(r[c.name]);
    if (!storage || !name) continue;
    const qty = num(r[c.qty]);
    const value = r[c.val] != null && r[c.val] !== '' ? num(r[c.val]) : qty * num(r[c.price]);
    out.push({ code: clean(r[c.code]), name, um: clean(r[c.um]), qty, value, day: c.date >= 0 ? toDay(r[c.date]) : null,
      storage, cat: clean(r[c.cat]) || 'Uncategorised' });
  }
  return out;
}
function parseSales(aoa) {
  const hi = aoa.findIndex(r => r.some(c => /^net sales$/i.test(clean(c))));
  if (hi < 0) return null;
  const h = aoa[hi].map(norm), n = h.indexOf('net sales');
  if (n < 1) return null;
  const out = [];
  for (const r of aoa.slice(hi + 1)) {
    const label = clean(r[0]), storage = n >= 2 ? clean(r[1]) : label;
    if (!label || /^grand total$/i.test(label)) continue;
    const m = label.match(/^\s*([A-Za-z]\d+)/);
    out.push({ code: m ? m[1].toUpperCase() : '', label, storage, sales: num(r[n]) });
  }
  return out;
}

async function handleWasteFiles(files) {
  const msgs = [];
  for (const f of files) {
    try {
      const wb = await readWB(f);
      let gotRec = false, gotSales = false;
      for (const name of wb.SheetNames) {
        const aoa = toAOA(wb.Sheets[name]);
        const rec = !gotRec && parseRecords(aoa);
        if (rec && rec.length) { state.records = rec; gotRec = true; continue; }
        const sal = !gotSales && parseSales(aoa);
        if (sal && sal.length) { state.sales = sal; gotSales = true; }
      }
      if (!gotRec && !gotSales) msgs.push(`${f.name}: no waste records or Net Sales sheet recognised (download the template to see the expected columns).`);
      else state.files.push(f.name);
    } catch (e) { msgs.push(`${f.name}: ${e.message}`); }
  }
  if (!state.records.length) msgs.push('No waste records loaded yet.');
  else if (!state.sales.length) msgs.push('No Net Sales sheet found – waste % cannot be calculated. Add a "Net Sales" sheet (see template).');
  notice(msgs.join(' '));
  build(); render();
}

// ---------- model ----------
function build() {
  const byCode = new Map(state.mapping.filter(m => m.code).map(m => [m.code.toUpperCase(), m]));
  const stores = new Map(), storageIdx = new Map();
  const mk = (key, code, label) => {
    if (!stores.has(key)) {
      const m = code && byCode.get(code);
      stores.set(key, { key, code, label, name: m ? `${code} · ${titleCase(m.branch)}` : label, am: m ? m.am : 'Unassigned', rom: m ? m.rom : '',
        region: m ? m.region : '', city: m ? m.city : '', sales: 0, waste: 0, cat: {}, prod: new Map(), day: new Map(), mapped: !!m });
    }
    return stores.get(key);
  };
  for (const s of state.sales) {
    const st = mk(s.code || 'S:' + norm(s.storage), s.code, s.label);
    st.sales += s.sales; storageIdx.set(norm(s.storage), st);
  }
  state.unmatched = new Set();
  for (const r of state.records) {
    let st = storageIdx.get(norm(r.storage));
    if (!st) {
      const m = r.storage.match(CODE_RE), code = m ? m[1].toUpperCase() : '';
      st = code ? mk(code, code, r.storage) : mk('S:' + norm(r.storage), '', r.storage);
      storageIdx.set(norm(r.storage), st);
    }
    if (!st.sales) state.unmatched.add(st.key);
    st.waste += r.value;
    st.cat[r.cat] = (st.cat[r.cat] || 0) + r.value;
    const pk = norm(r.name);
    let p = st.prod.get(pk);
    if (!p) st.prod.set(pk, p = { key: pk, code: r.code, name: r.name, cat: r.cat, um: r.um, qty: 0, value: 0 });
    p.qty += r.qty; p.value += r.value;
    if (r.day != null) st.day.set(r.day, (st.day.get(r.day) || 0) + r.value);
  }
  state.stores = [...stores.values()];
}
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const statusOf = f => f == null ? 'na' : f > state.high ? 'high' : f < state.low ? 'low' : 'ok';
const STATUS_LABEL = { high: 'High', ok: 'Normal', low: 'Unusually low', na: 'No sales' };
const chip = s => `<span class="chip ${s}">${STATUS_LABEL[s]}</span>`;

function scope() {
  const st = state.stores.filter(s => (s.waste > 0 || s.sales > 0) && (!state.am || s.am === state.am));
  const cats = [...new Set(state.records.map(r => r.cat))];
  const catTotals = Object.fromEntries(cats.map(c => [c, 0]));
  const prods = new Map(), days = new Map();
  let sales = 0, waste = 0;
  for (const s of st) {
    sales += s.sales; waste += s.waste;
    for (const c in s.cat) catTotals[c] += s.cat[c];
    for (const [k, p] of s.prod) {
      const a = prods.get(k) || { key: k, code: p.code, name: p.name, cat: p.cat, um: p.um, qty: 0, value: 0, stores: 0 };
      a.qty += p.qty; a.value += p.value; a.stores++; prods.set(k, a);
    }
    for (const [d, v] of s.day) days.set(d, (days.get(d) || 0) + v);
  }
  cats.sort((a, b) => catTotals[b] - catTotals[a]);
  for (const s of st) s.pct = s.sales > 0 ? s.waste / s.sales : null;
  return { st, cats, catTotals, sales, waste, pct: sales > 0 ? waste / sales : null, prods: [...prods.values()], days };
}

// ---------- rendering helpers ----------
function killCharts() { Object.values(state.charts).forEach(c => c.destroy()); state.charts = {}; }
function table(el, cols, rows, key, onRow) {
  const s = state.sort[key] || (state.sort[key] = { col: cols.find(c => c.def)?.k || cols[0].k, dir: -1 });
  const col = cols.find(c => c.k === s.col) || cols[0];
  const data = [...rows].sort((a, b) => {
    const x = col.sort ? col.sort(a) : a[col.k], y = col.sort ? col.sort(b) : b[col.k];
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s.dir;
  });
  el.innerHTML = `<thead><tr>${cols.map(c => `<th data-k="${c.k}" class="${c.k === s.col ? 'sorted' : ''}">${c.h}${c.k === s.col ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>` +
    `<tbody>${data.map((r, i) => `<tr class="${onRow ? 'click' : ''}" data-i="${i}">${cols.map(c => `<td>${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  el.querySelectorAll('th').forEach(th => th.onclick = () => {
    const k = th.dataset.k; state.sort[key] = { col: k, dir: s.col === k ? -s.dir : (typeof (rows[0]?.[k]) === 'string' ? 1 : -1) }; render();
  });
  if (onRow) el.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => onRow(data[+tr.dataset.i]));
}
const pbar = (f, max) => { const s = statusOf(f); return f == null ? '–' : `<div class="pb ${s}"><span class="${s === 'high' ? 't-high' : s === 'low' ? 't-low' : ''}">${pct(f)}</span><i><b style="width:${Math.min(100, f / (max || 1) * 100).toFixed(0)}%"></b></i></div>`; };
const pcell = f => { const s = statusOf(f); return `<span class="${s === 'high' ? 't-high' : s === 'low' ? 't-low' : ''}">${pct(f)}</span>`; };
const COLORS = { high: '#d9776c', ok: '#84c5b2', low: '#d4b38b', na: '#b9ae9c' };
const PAL = ['#84c5b2', '#a7ded4', '#d4b38b', '#2b8a74'];
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
try { Chart.defaults.color = cssv('--muted'); Chart.defaults.font.family = cssv('--font') || 'system-ui'; Chart.defaults.font.size = 12; } catch (e) {}

function notice(msg) { const n = $('notice'); n.hidden = !msg; n.textContent = msg || ''; }

// ---------- views ----------
function render() {
  killCharts();
  const has = state.records.length > 0;
  $('empty').hidden = has;
  document.querySelectorAll('.tab').forEach(t => t.hidden = !has || t.id !== 'tab-' + state.tab);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  if (!has) { $('period').textContent = 'No data loaded'; $('scopeInfo').textContent = ''; return; }
  const days = state.records.map(r => r.day).filter(d => d != null);
  $('period').textContent = (days.length ? `${dayISO(Math.min(...days))} → ${dayISO(Math.max(...days))} · ` : '') + `${fmt(state.records.length)} write-off records`;
  const sc = scope();
  const unm = state.stores.filter(s => s.waste > 0 && !s.mapped).length;
  $('scopeInfo').textContent = `${sc.st.length} store${sc.st.length === 1 ? '' : 's'} in view` + (state.am ? ` · ${state.am}` : '') +
    (unm && !state.am ? ` · ${unm} store(s) not in mapping (Unassigned)` : '');
  ({ overview, stores, products, extremes, managers })[state.tab](sc);
}

function overview(sc) {
  const withSales = sc.st.filter(s => s.pct != null);
  const cnt = { high: 0, ok: 0, low: 0 };
  withSales.forEach(s => cnt[statusOf(s.pct)]++);
  const kp = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('kpis').innerHTML = kp('Net sales', fmt(sc.sales)) + kp('Wastage value', fmt(sc.waste)) +
    kp('Overall waste %', `<span class="${statusOf(sc.pct) === 'high' ? 't-high' : statusOf(sc.pct) === 'low' ? 't-low' : ''}">${pct(sc.pct)}</span>`, `${STATUS_LABEL[statusOf(sc.pct)]} · limit ${pct(state.high, 1)}`) +
    kp('High stores', cnt.high, `of ${withSales.length} with sales`) + kp('Unusually low', cnt.low, `below ${pct(state.low, 1)}`) +
    kp('Products wasted', fmt(sc.prods.length), `${sc.cats.length} categories`);
  const grid = { color: cssv('--line') }, base = { maintainAspectRatio: false, plugins: { legend: { display: false } } };
  state.charts.cat = new Chart($('chCat'), { type: 'bar', data: { labels: sc.cats.map(c => c.split(' ')), datasets: [{ data: sc.cats.map(c => sc.sales ? +(sc.catTotals[c] / sc.sales * 100).toFixed(3) : 0), backgroundColor: [PAL[0], PAL[1], PAL[2], PAL[3]], borderRadius: 8, borderSkipped: false, maxBarThickness: 44 }] },
    options: { ...base, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y}% of net sales · ${fmt(sc.catTotals[sc.cats[c.dataIndex]])}` } } },
      scales: { x: { grid: { display: false }, border: { display: false } }, y: { grid, border: { display: false }, ticks: { callback: v => v + '%' } } } } });
  state.charts.status = new Chart($('chStatus'), { type: 'doughnut', data: { labels: ['High', 'Normal', 'Unusually low'], datasets: [{ data: [cnt.high, cnt.ok, cnt.low], backgroundColor: [COLORS.high, COLORS.ok, COLORS.low], borderWidth: 3, borderColor: cssv('--surface') }] },
    options: { ...base, cutout: '68%', plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } } } } });
  const dd = [...sc.days.keys()].sort((a, b) => a - b);
  state.charts.day = new Chart($('chDay'), { type: 'bar', data: { labels: dd.map(d => dayISO(d).slice(5)), datasets: [{ data: dd.map(d => Math.round(sc.days.get(d))), backgroundColor: PAL[1], borderRadius: 8, borderSkipped: false, maxBarThickness: 36 }] },
    options: { ...base, scales: { x: { grid: { display: false }, border: { display: false } }, y: { grid, border: { display: false }, ticks: { callback: v => v >= 1000 ? v / 1000 + 'k' : v } } } } });
  const ss = [...withSales].sort((a, b) => b.pct - a.pct).slice(0, 12);
  const thr = { id: 'thr', afterDatasetsDraw(ch) {
    const { ctx, chartArea: a, scales: { x } } = ch; ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    [[state.high, COLORS.high], [state.low, COLORS.low]].forEach(([v, col]) => { const px = x.getPixelForValue(v * 100); if (px >= a.left && px <= a.right) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); } }); ctx.restore(); } };
  state.charts.stores = new Chart($('chStores'), { type: 'bar', plugins: [thr], data: { labels: ss.map(s => s.name.replace(' · ', '  ')), datasets: [{ data: ss.map(s => +(s.pct * 100).toFixed(2)), backgroundColor: ss.map(s => COLORS[statusOf(s.pct)]), borderRadius: 6, borderSkipped: false, barPercentage: .7 }] },
    options: { ...base, indexAxis: 'y', scales: { x: { grid, border: { display: false }, ticks: { callback: v => v + '%' } }, y: { grid: { display: false }, border: { display: false } } } } });
  const tp = [...sc.prods].sort((a, b) => b.value - a.value).slice(0, 10);
  state.charts.prod = new Chart($('chProd'), { type: 'bar', data: { labels: tp.map(p => p.name.length > 30 ? p.name.slice(0, 29) + '…' : p.name), datasets: [{ data: tp.map(p => Math.round(p.value)), backgroundColor: PAL[0], borderRadius: 6, borderSkipped: false, barPercentage: .7 }] },
    options: { ...base, indexAxis: 'y', scales: { x: { grid, border: { display: false }, ticks: { callback: v => v >= 1000 ? v / 1000 + 'k' : v } }, y: { grid: { display: false }, border: { display: false } } } } });
}

function stores(sc) {
  const q = norm($('storeSearch').value), stf = $('storeStatus').value;
  const rows = sc.st.filter(s => (!q || norm(s.name + s.am).includes(q)) && (!stf || statusOf(s.pct) === stf));
  const cols = [
    { k: 'name', h: 'Store', f: s => esc(s.name), def: false },
    { k: 'am', h: 'Area manager', f: s => esc(s.am) },
    { k: 'sales', h: 'Net sales', f: s => fmt(s.sales) },
    { k: 'waste', h: 'Waste value', f: s => fmt(s.waste) },
    { k: 'pct', h: 'Waste %', f: s => pbar(s.pct, Math.max(...sc.st.map(x => x.pct || 0))), def: true, sort: s => s.pct ?? -1 },
    ...sc.cats.map(c => ({ k: 'c_' + c, h: c + ' %', f: s => s.sales > 0 ? pct((s.cat[c] || 0) / s.sales) : '–', sort: s => s.sales > 0 ? (s.cat[c] || 0) / s.sales : -1 })),
    { k: 'status', h: 'Status', f: s => chip(statusOf(s.pct)), sort: s => statusOf(s.pct) }
  ];
  table($('tblStores'), cols, rows, 'stores', storeModal);
}

function products(sc) {
  const sel = $('prodCat'), cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + sc.cats.map(c => `<option>${esc(c)}</option>`).join(''); sel.value = cur;
  const q = norm($('prodSearch').value);
  const rows = sc.prods.filter(p => (!sel.value || p.cat === sel.value) && (!q || norm(p.name + p.code).includes(q)))
    .map(p => ({ ...p, pctSales: sc.sales > 0 ? p.value / sc.sales : null, share: sc.waste ? p.value / sc.waste : 0 }));
  table($('tblProducts'), [
    { k: 'name', h: 'Product', f: p => esc(p.name) }, { k: 'code', h: 'Code', f: p => esc(p.code) }, { k: 'cat', h: 'Category', f: p => esc(p.cat) },
    { k: 'qty', h: 'Qty', f: p => `${fmt(p.qty, 1)} ${esc(p.um)}` }, { k: 'stores', h: 'Stores', f: p => p.stores },
    { k: 'value', h: 'Waste value', f: p => fmt(p.value), def: true },
    { k: 'pctSales', h: '% of net sales', f: p => pct(p.pctSales, 3), sort: p => p.pctSales ?? -1 },
    { k: 'share', h: '% of total waste', f: p => pct(p.share) }
  ], rows, 'products', p => productModal(p, sc));
}

function extremes(sc) {
  const ws = sc.st.filter(s => s.pct != null);
  const N = 5;
  const storeTbl = (list, valFn, label) => `<table><thead><tr><th>Store</th><th>${label}</th></tr></thead><tbody>${list.map(s => `<tr><td>${esc(s.name)}</td><td>${valFn(s)}</td></tr>`).join('') || '<tr><td colspan=2 class="muted">No data</td></tr>'}</tbody></table>`;
  const prodTbl = list => `<table><thead><tr><th>Product</th><th>Value</th><th>% sales</th></tr></thead><tbody>${list.map(p => `<tr><td>${esc(p.name)}</td><td>${fmt(p.value)}</td><td>${sc.sales ? pct(p.value / sc.sales, 3) : '–'}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">No data</td></tr>'}</tbody></table>`;
  const hi = arr => [...arr].slice(0, N), lo = arr => [...arr].filter(x => x.value == null || x.value > 0).reverse().slice(0, N);
  const byPct = [...ws].sort((a, b) => b.pct - a.pct);
  let html = `<div class="ext-cat"><h2>Overall</h2><div class="ext-grid">
    <div class="card"><h3>Highest waste % stores</h3>${storeTbl(hi(byPct), s => pcell(s.pct), 'Waste %')}</div>
    <div class="card"><h3>Lowest waste % stores</h3>${storeTbl(lo(byPct), s => pcell(s.pct), 'Waste %')}</div>
    <div class="card"><h3>Highest wasted products</h3>${prodTbl(hi([...sc.prods].sort((a, b) => b.value - a.value)))}</div>
    <div class="card"><h3>Lowest wasted products</h3>${prodTbl(lo([...sc.prods].sort((a, b) => b.value - a.value)))}</div></div></div>`;
  for (const c of sc.cats) {
    const cp = s => (s.cat[c] || 0) / s.sales;
    const bs = [...ws].sort((a, b) => cp(b) - cp(a));
    const bp = sc.prods.filter(p => p.cat === c).sort((a, b) => b.value - a.value);
    html += `<div class="ext-cat"><h2>${esc(c)} <span class="muted small">· ${pct(sc.sales ? sc.catTotals[c] / sc.sales : null)} of net sales</span></h2><div class="ext-grid">
      <div class="card"><h3>Highest stores</h3>${storeTbl(hi(bs), s => pct(cp(s)), '% of sales')}</div>
      <div class="card"><h3>Lowest stores</h3>${storeTbl(lo(bs), s => pct(cp(s)), '% of sales')}</div>
      <div class="card"><h3>Highest products</h3>${prodTbl(hi(bp))}</div>
      <div class="card"><h3>Lowest products</h3>${prodTbl(lo(bp))}</div></div></div>`;
  }
  $('extremes').innerHTML = html;
}

function managers() {
  const map = new Map();
  for (const s of state.stores.filter(s => s.waste > 0 || s.sales > 0)) {
    const m = map.get(s.am) || { am: s.am, rom: s.rom, stores: 0, sales: 0, waste: 0, high: 0, low: 0 };
    m.stores++; m.sales += s.sales; m.waste += s.waste;
    const st = statusOf(s.sales > 0 ? s.waste / s.sales : null); if (st === 'high') m.high++; if (st === 'low') m.low++;
    map.set(s.am, m);
  }
  const rows = [...map.values()].map(m => ({ ...m, pct: m.sales > 0 ? m.waste / m.sales : null }));
  table($('tblManagers'), [
    { k: 'am', h: 'Area manager', f: m => esc(m.am) }, { k: 'rom', h: 'ROM', f: m => esc(m.rom) }, { k: 'stores', h: 'Stores', f: m => m.stores },
    { k: 'sales', h: 'Net sales', f: m => fmt(m.sales) }, { k: 'waste', h: 'Waste value', f: m => fmt(m.waste) },
    { k: 'pct', h: 'Waste %', f: m => pcell(m.pct), def: true, sort: m => m.pct ?? -1 },
    { k: 'high', h: 'High stores', f: m => m.high }, { k: 'low', h: 'Low stores', f: m => m.low }
  ], rows, 'managers', m => { $('amSelect').value = m.am === 'Unassigned' ? '' : m.am; state.am = $('amSelect').value; state.tab = 'overview'; render(); });
}

// ---------- modals ----------
function openModal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; }
function storeModal(s) {
  const cats = Object.keys(s.cat).sort((a, b) => s.cat[b] - s.cat[a]);
  const prods = [...s.prod.values()].sort((a, b) => b.value - a.value).slice(0, 15);
  openModal(`<h2>${esc(s.name)}</h2><div class="muted">${esc(s.am)}${s.rom ? ' · ROM ' + esc(s.rom) : ''}${s.city ? ' · ' + esc(s.city) : ''}</div>
    <p>Net sales <b>${fmt(s.sales)}</b> · Waste <b>${fmt(s.waste)}</b> · Waste % <b>${pcell(s.pct)}</b> ${chip(statusOf(s.pct))}</p>
    <h3>By category</h3><table><thead><tr><th>Category</th><th>Value</th><th>% of sales</th></tr></thead><tbody>${cats.map(c => `<tr><td>${esc(c)}</td><td>${fmt(s.cat[c])}</td><td>${s.sales > 0 ? pct(s.cat[c] / s.sales) : '–'}</td></tr>`).join('')}</tbody></table>
    <h3>Top products</h3><table><thead><tr><th>Product</th><th>Category</th><th>Qty</th><th>Value</th><th>% of sales</th></tr></thead><tbody>${prods.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.cat)}</td><td>${fmt(p.qty, 1)} ${esc(p.um)}</td><td>${fmt(p.value)}</td><td>${s.sales > 0 ? pct(p.value / s.sales, 3) : '–'}</td></tr>`).join('')}</tbody></table>`);
}
function productModal(p, sc) {
  const rows = sc.st.filter(s => s.prod.has(p.key)).map(s => ({ s, p: s.prod.get(p.key) })).sort((a, b) => b.p.value - a.p.value);
  openModal(`<h2>${esc(p.name)}</h2><div class="muted">${esc(p.cat)} · ${esc(p.code)}</div>
    <p>Total waste <b>${fmt(p.value)}</b> · Qty <b>${fmt(p.qty, 1)} ${esc(p.um)}</b> · <b>${pct(sc.sales ? p.value / sc.sales : null, 3)}</b> of net sales · ${p.stores} store(s)</p>
    <table><thead><tr><th>Store</th><th>Qty</th><th>Value</th><th>% of store sales</th></tr></thead><tbody>${rows.map(({ s, p: q }) => `<tr><td>${esc(s.name)}</td><td>${fmt(q.qty, 1)}</td><td>${fmt(q.value)}</td><td>${s.sales > 0 ? pct(q.value / s.sales, 3) : '–'}</td></tr>`).join('')}</tbody></table>`);
}

// ---------- templates ----------
async function saveWB(wb, name) {
  const dl = window.claude ? await window.claude.use('downloads').catch(() => null) : null;
  if (!dl) return XLSX.writeFile(wb, name);
  try { await dl.save({ filename: name, data: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) }); }
  catch (e) { if (e && e.code !== 'declined') notice('Download unavailable here: ' + (e.message || e.code)); }
}
function dlTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Code', 'Stock list', 'U/M', 'Quantity in meas. units', 'Unit Pr', 'Wastage Value', 'Document date', 'Document type', 'Write-off storage', 'Category'],
    ['WP01030088', 'PUDDING DATES CAKE', 'pcs', 10, 4.88, 48.8, '2026-09-23', 'Write-off record', 'Saco Makkah Main Storage', 'Pastries & Sweets'],
    ['WP01020033', 'Candied Pecan Ice Cream', 'kg', 0.5, 41.9, 20.95, '2026-09-24', 'Write-off record', 'Mohammadia Main Storage', 'Mixes']
  ]), 'Waste Records');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Store', 'Write-off storage', 'Net Sales'],
    ['B33 MKK, Awali', 'Saco Makkah Main Storage', 150275.88],
    ['B08 RIY, Mohammadiyyah', 'Mohammadia Main Storage', 169610.56]
  ]), 'Net Sales');
  saveWB(wb, 'Waste_Report_Template.xlsx');
}
function dlMapTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Sq No.', 'Code', 'Branch', 'Area Manager', 'ROM', 'Reigon', 'City'],
    [1, 'B26', 'BURAYDAH', 'MESHAL ALSULMI', 'MOHAMMAD MEHREZ', 'North', 'Buraydah']]), 'Mapping');
  saveWB(wb, 'AM_ROM_Mapping_Template.xlsx');
}

// ---------- wiring ----------
$('btnTemplate').onclick = dlTemplate;
$('btnMapTemplate').onclick = dlMapTemplate;
$('btnMapReset').onclick = () => { try { localStorage.removeItem('wasteMapping'); } catch (e) {} loadMapping(window.DEFAULT_MAPPING, false); build(); render(); };
$('fileWaste').onchange = e => { handleWasteFiles([...e.target.files]); e.target.value = ''; };
$('fileMap').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const wb = await readWB(f); let rows = [];
    for (const n of wb.SheetNames) { try { rows = parseMappingRows(toAOA(wb.Sheets[n])); if (rows.length) break; } catch (err) {} }
    if (!rows.length) throw new Error('No area manager rows found. Download the mapping template for the expected columns.');
    loadMapping(rows, true); try { localStorage.setItem('wasteMapping', JSON.stringify(rows)); } catch (err) {}
    notice(''); build(); render();
  } catch (err) { notice('Mapping file: ' + err.message); }
};
$('amSelect').onchange = e => { state.am = e.target.value; render(); };
$('thHigh').onchange = e => { state.high = (+e.target.value || 0) / 100; render(); };
$('thLow').onchange = e => { state.low = (+e.target.value || 0) / 100; render(); };
['storeSearch', 'storeStatus', 'prodSearch', 'prodCat'].forEach(id => $(id).oninput = render);
$('tabs').onclick = e => { if (e.target.dataset.tab) { state.tab = e.target.dataset.tab; render(); } };
$('modalClose').onclick = () => $('modal').hidden = true;
$('modal').onclick = e => { if (e.target === $('modal')) $('modal').hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('modal').hidden = true; });

let saved = null; try { saved = JSON.parse(localStorage.getItem('wasteMapping')); } catch (e) {}
if (Array.isArray(saved) && saved.length) loadMapping(saved, true); else loadMapping(window.DEFAULT_MAPPING || [], false);
render();
window.__wasteApp = { state, handleWasteFiles };
})();
