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
  sort: {}, charts: {}, tab: 'overview', files: [],
  weeks: [], week: '', weekCache: new Map(), viewPass: '', dirty: false
};

// ---------- shared storage (Supabase) ----------
const SUPA = { url: 'https://rudbxlurozmpcdnshbcg.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1ZGJ4bHVyb3ptcGNkbnNoYmNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MDgwNTcsImV4cCI6MjEwNjI4NDA1N30.jT8DlaCMArthWaTxuGMOKjI9ZFxFjx9Yex8DU45P2zg' };
const sapi = (path, opts = {}) => fetch(SUPA.url + '/rest/v1/' + path, { ...opts, headers: { apikey: SUPA.key, Authorization: 'Bearer ' + SUPA.key, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function gz(str) { const s = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip')); return new Response(s).arrayBuffer(); }
async function gunz(bytes) { const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')); return new Response(s).text(); }
async function packData() {
  const S = [], C = [], P = [], si = new Map(), ci = new Map(), pi = new Map();
  const idx = (m, arr, k, v) => { if (!m.has(k)) { m.set(k, arr.length); arr.push(v); } return m.get(k); };
  const rows = state.records.map(r => [idx(si, S, r.storage, r.storage), idx(ci, C, r.cat, r.cat), idx(pi, P, r.code + '|' + r.name + '|' + r.um, [r.code, r.name, r.um]), r.qty, r.value, r.day]);
  const json = JSON.stringify({ v: 1, S, C, P, rows, sales: state.sales.map(s => [s.code, s.label, s.storage, s.sales]), mapping: state.mapCustom ? state.mapping : null });
  return typeof CompressionStream === 'function' ? 'g1:' + b64(await gz(json)) : 'j1:' + json;
}
async function unpackData(text) {
  const json = text.startsWith('g1:') ? await gunz(unb64(text.slice(3))) : text.slice(3);
  const d = JSON.parse(json);
  return {
    records: d.rows.map(r => { const p = d.P[r[2]]; return { code: p[0], name: p[1], um: p[2], storage: d.S[r[0]], cat: d.C[r[1]], qty: r[3], value: r[4], day: r[5] }; }),
    sales: d.sales.map(s => ({ code: s[0], label: s[1], storage: s[2], sales: s[3] })),
    mapping: d.mapping || null
  };
}
function applyWeekData(w) {
  state.records = w.records; state.sales = w.sales;
  if (w.mapping) loadMapping(w.mapping, true, true); else loadMapping(window.DEFAULT_MAPPING || [], false);
}
async function rpc(name, body) {
  const res = await sapi('rpc/' + name, { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) return res.json();
  const t = await res.text(); const e = new Error(t); e.status = res.status;
  e.code = /invalid (password|passcode)/i.test(t) ? 'auth' : /week limit/i.test(t) ? 'limit' : /not found/i.test(t) ? 'missing' : 'other';
  throw e;
}

// ---------- weeks ----------
const MAX_WEEKS = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso, withYear) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`; };
const weekLabel = (key, meta) => { const from = (meta && meta.from) || key, to = (meta && meta.to) || from; return `${fmtDay(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmtDay(to, true)}`; };
function recordDays() { return state.records.map(r => r.day).filter(d => d != null); }
function weekKeyOf() { const d = recordDays(); return d.length ? dayISO(Math.min(...d)) : new Date().toISOString().slice(0, 10); }
function currentMeta() { const d = recordDays(); return { files: state.files, records: state.records.length, from: d.length ? dayISO(Math.min(...d)) : null, to: d.length ? dayISO(Math.max(...d)) : null }; }
function renderWeekSelect() {
  const sel = $('weekSelect'), items = state.weeks.map(w => ({ key: w.week_key, label: weekLabel(w.week_key, w.meta), saved: true }));
  if (state.dirty && state.week && !items.some(x => x.key === state.week)) items.push({ key: state.week, label: weekLabel(state.week, currentMeta()), saved: false });
  items.sort((x, y) => y.key.localeCompare(x.key));
  $('weekField').hidden = !items.length;
  sel.innerHTML = items.map((x, n) => `<option value="${x.key}">${esc(x.label)}${!x.saved ? ' · not saved' : n === 0 ? ' · latest' : ''}</option>`).join('');
  if (items.some(x => x.key === state.week)) sel.value = state.week;
  $('weekCount').textContent = `${state.weeks.length} of ${MAX_WEEKS} weeks stored`;
  const saved = state.weeks.some(w => w.week_key === state.week) && !state.dirty;
  $('btnDeleteWeek').hidden = !savedPass();
  $('btnDeleteWeek').disabled = !saved;
  $('btnDeleteWeek').textContent = saved ? `Delete week ${weekLabel(state.week, (state.weeks.find(w => w.week_key === state.week) || {}).meta)}…` : 'Delete this week…';
}
const setBusy = on => { document.querySelector('main').classList.toggle('busy', on); $('weekSelect').disabled = on; };
async function refreshWeeks() {
  const d = await rpc('get_weeks', { p_password: state.viewPass });
  state.weeks = d.weeks; renderWeekSelect();
}
async function getWeekData(key) {
  let w = state.weekCache.get(key);
  if (!w) {
    const r = await rpc('get_week', { p_password: state.viewPass, p_week: key });
    w = await unpackData(r.payload); w.meta = r.meta || {}; w.updated_at = r.updated_at; state.weekCache.set(key, w);
  }
  return w;
}
async function selectWeek(key) {
  if (key === state.week && state.dirty) return;
  if (state.dirty) { state.dirty = false; $('publishBar').hidden = true; toast('The unsaved upload was discarded.'); }
  setBusy(true);
  try {
    const w = await getWeekData(key);
    state.week = key; applyWeekData(w);
    state.published = { at: w.updated_at, meta: w.meta }; state.files = (w.meta && w.meta.files) || [];
    build(); render();
  } catch (e) { toast('Could not load that week. Check your connection and try again.'); }
  setBusy(false); renderWeekSelect();
}

function lock(msg) { document.body.classList.add('locked'); $('gate').hidden = false; $('gateMsg').textContent = msg || ''; $('gatePw').focus(); }
async function loadShared(pw, fromGate) {
  if (!pw) { lock(''); return; }
  $('gateBtn').disabled = true;
  let d;
  try { d = await rpc('get_weeks', { p_password: pw }); }
  catch (e) {
    $('gateBtn').disabled = false;
    if (e.code === 'auth') { try { localStorage.removeItem('hmView'); } catch (x) {} lock(fromGate ? 'Wrong password. Try again.' : 'Please enter the password.'); }
    else lock('Could not reach the server. Check your connection and try again.');
    return;
  }
  $('gateBtn').disabled = false;
  try { localStorage.setItem('hmView', pw); if (d.admin) localStorage.setItem('hmPass', pw); } catch (e) {}
  state.viewPass = pw; state.weeks = d.weeks;
  document.body.classList.remove('locked'); $('gate').hidden = true; $('gatePw').value = '';
  if (!d.weeks.length) { $('emptyTitle').textContent = 'No data published yet'; $('emptyText').textContent = 'Open “Update data” to upload the first waste report and publish it.'; renderWeekSelect(); return; }
  await selectWeek(d.weeks[0].week_key);
}
const savedPass = () => { try { return localStorage.getItem('hmPass') || ''; } catch (e) { return ''; } };
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 6000); }
function markDirty() {
  state.dirty = true; state.week = weekKeyOf(); $('pubMsg').textContent = ''; renderWeekSelect();
  if (savedPass()) publish(savedPass()); else $('publishBar').hidden = false;
}
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
async function publish(auto) {
  const pass = typeof auto === 'string' ? auto : $('passcode').value, msg = $('pubMsg'), btn = $('btnPublish');
  if (!pass) { msg.textContent = 'Enter the passcode.'; return; }
  const key = weekKeyOf(), existed = state.weeks.some(w => w.week_key === key), label = weekLabel(key, currentMeta());
  if (!existed && state.weeks.length >= MAX_WEEKS) {
    $('publishBar').hidden = false; msg.textContent = `All ${MAX_WEEKS} week slots are used. Delete a week first (Update data → Delete week), then publish again.`;
    toast(`Not saved: ${MAX_WEEKS} weeks are already stored. Delete one first.`); return;
  }
  btn.disabled = true; msg.textContent = 'Saving…'; if (typeof auto === 'string') toast('Saving to the shared dashboard…');
  try {
    const meta = currentMeta();
    const ts = await rpc('save_week', { p_passcode: pass, p_week: key, p_payload: await packData(), p_meta: meta });
    state.weekCache.set(key, { records: state.records, sales: state.sales, mapping: state.mapCustom ? state.mapping : null, meta, updated_at: ts });
    state.week = key; state.published = { at: ts, meta }; state.dirty = false; $('passcode').value = ''; $('publishBar').hidden = true;
    try { localStorage.setItem('hmPass', pass); } catch (e) {}
    await refreshWeeks(); notice(''); render();
    toast(existed ? `✓ Week ${label} was replaced with the new upload.` : `✓ Saved as week ${label}. Your other weeks are kept.`);
  } catch (e) {
    $('publishBar').hidden = false;
    if (e.code === 'auth') { try { localStorage.removeItem('hmPass'); } catch (x) {} msg.textContent = 'Wrong passcode.'; }
    else if (e.code === 'limit') msg.textContent = `All ${MAX_WEEKS} week slots are used. Delete a week first, then publish again.`;
    else msg.textContent = 'Not saved. Check your connection and try again.';
    toast('Not saved yet. ' + msg.textContent);
  }
  btn.disabled = false;
}

// ---------- mapping ----------
function loadMapping(rows, custom, fromShared) {
  state.mapping = rows; state.mapCustom = custom; state.mapShared = !!fromShared;
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
  const msgs = []; let changed = false;
  state.files = [];
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
      else { state.files.push(f.name); changed = true; }
    } catch (e) { msgs.push(`${f.name}: ${e.message}`); }
  }
  if (!state.records.length) msgs.push('No waste records loaded yet.');
  else if (!state.sales.length) msgs.push('No Net Sales sheet found – waste % cannot be calculated. Add a "Net Sales" sheet (see template).');
  notice(msgs.join(' '));
  build(); render();
  if (changed && state.records.length) markDirty();
}

// ---------- model ----------
function buildStoreMap(records, sales) {
  const byCode = new Map(state.mapping.filter(m => m.code).map(m => [m.code.toUpperCase(), m]));
  const stores = new Map(), storageIdx = new Map(), unmatched = new Set();
  const mk = (key, code, label) => {
    if (!stores.has(key)) {
      const m = code && byCode.get(code);
      stores.set(key, { key, code, label, name: m ? `${code} · ${titleCase(m.branch)}` : label, am: m ? m.am : 'Unassigned', rom: m ? m.rom : '',
        region: m ? m.region : '', city: m ? m.city : '', sales: 0, waste: 0, cat: {}, prod: new Map(), day: new Map(), mapped: !!m });
    }
    return stores.get(key);
  };
  for (const s of sales) {
    const st = mk(s.code || 'S:' + norm(s.storage), s.code, s.label);
    st.sales += s.sales; storageIdx.set(norm(s.storage), st);
  }
  for (const r of records) {
    let st = storageIdx.get(norm(r.storage));
    if (!st) {
      const m = r.storage.match(CODE_RE), code = m ? m[1].toUpperCase() : '';
      st = code ? mk(code, code, r.storage) : mk('S:' + norm(r.storage), '', r.storage);
      storageIdx.set(norm(r.storage), st);
    }
    if (!st.sales) unmatched.add(st.key);
    st.waste += r.value;
    st.cat[r.cat] = (st.cat[r.cat] || 0) + r.value;
    const pk = norm(r.name);
    let p = st.prod.get(pk);
    if (!p) st.prod.set(pk, p = { key: pk, code: r.code, name: r.name, cat: r.cat, um: r.um, qty: 0, value: 0, days: new Map() });
    p.qty += r.qty; p.value += r.value;
    if (r.day != null) {
      st.day.set(r.day, (st.day.get(r.day) || 0) + r.value);
      const dd = p.days.get(r.day) || { qty: 0, value: 0 }; dd.qty += r.qty; dd.value += r.value; p.days.set(r.day, dd);
    }
  }
  return { stores, unmatched };
}
function build() {
  const r = buildStoreMap(state.records, state.sales);
  state.stores = [...r.stores.values()]; state.unmatched = r.unmatched;
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
  el.innerHTML = `<thead><tr>${cols.map(c => `<th data-k="${c.k}" class="${c.k === s.col ? 'sorted' : ''}" aria-sort="${c.k === s.col ? (s.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort" data-k="${c.k}">${c.h}${c.k === s.col ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}</tr></thead>` +
    `<tbody>${data.map((r, i) => `<tr class="${onRow ? 'click' : ''}" data-i="${i}">${cols.map((c, ci) => `<td>${onRow && ci === 0 ? `<button type="button" class="rowlink">${c.f(r)}</button>` : c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  el.querySelectorAll('th button.sort').forEach(btn => btn.onclick = () => {
    const k = btn.dataset.k; state.sort[key] = { col: k, dir: s.col === k ? -s.dir : (typeof (rows[0]?.[k]) === 'string' ? 1 : -1) }; render();
    const again = el.querySelector(`th button.sort[data-k="${k}"]`); if (again) again.focus({ preventScroll: true });
  });
  if (onRow) el.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => onRow(data[+tr.dataset.i]));
}
const pbar = (f, max) => { const s = statusOf(f); return f == null ? '–' : `<div class="pb ${s}"><span class="${s === 'high' ? 't-high' : s === 'low' ? 't-low' : ''}">${pct(f)}</span><i><b style="width:${Math.min(100, f / (max || 1) * 100).toFixed(0)}%"></b></i></div>`; };
const pcell = f => { const s = statusOf(f); return `<span class="${s === 'high' ? 't-high' : s === 'low' ? 't-low' : ''}">${pct(f)}</span>`; };
const COLORS = { high: '#d9776c', ok: '#84c5b2', low: '#d4b38b', na: '#b9ae9c' };
const PAL = ['#84c5b2', '#a7ded4', '#d4b38b', '#2b8a74'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
try { Chart.defaults.color = cssv('--muted'); Chart.defaults.font.family = cssv('--font') || 'system-ui'; Chart.defaults.font.size = 12; Chart.defaults.animation = reduceMotion ? false : { duration: 450, easing: 'easeOutQuart' }; } catch (e) {}

function notice(msg) { const n = $('notice'); n.hidden = !msg; n.textContent = msg || ''; }

// ---------- views ----------
function render() {
  killCharts();
  const has = state.records.length > 0;
  $('empty').hidden = has;
  document.querySelectorAll('.tab').forEach(t => t.hidden = !has || t.id !== 'tab-' + state.tab);
  document.querySelectorAll('#tabs button').forEach(b => { const on = b.dataset.tab === state.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  try { if (location.hash !== '#' + state.tab) history.replaceState(null, '', '#' + state.tab); } catch (e) {}
  if (!has) { $('period').textContent = 'No data loaded'; $('scopeInfo').textContent = ''; return; }
  const days = state.records.map(r => r.day).filter(d => d != null);
  $('period').textContent = (days.length ? `${dayISO(Math.min(...days))} → ${dayISO(Math.max(...days))} · ` : '') + `${fmt(state.records.length)} write-off records` + (state.published && !state.dirty ? ` · updated ${new Date(state.published.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : '');
  const sc = scope();
  const unm = state.stores.filter(s => s.waste > 0 && !s.mapped).length;
  $('scopeInfo').textContent = `${sc.st.length} store${sc.st.length === 1 ? '' : 's'} in view` + (state.am ? ` · ${state.am}` : '') +
    (unm && !state.am ? ` · ${unm} store(s) not in mapping (Unassigned)` : '');
  if (state.tab !== state.prevTab) { if (state.tab === 'storewaste') state.wkError = false; state.prevTab = state.tab; }
  ({ overview, stores, storewaste, products, extremes, managers })[state.tab](sc);
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
  const alt = (id, text) => $(id).setAttribute('aria-label', text);
  alt('chCat', 'Waste percent of net sales by category: ' + sc.cats.map(c => `${c} ${sc.sales ? (sc.catTotals[c] / sc.sales * 100).toFixed(2) : 0}%`).join(', '));
  alt('chStatus', `Stores by status: ${cnt.high} high, ${cnt.ok} normal, ${cnt.low} unusually low.`);
  alt('chDay', 'Daily wastage value: ' + [...sc.days.keys()].sort((x, y) => x - y).map(d => `${dayISO(d)} ${fmt(Math.round(sc.days.get(d)))}`).join(', '));
  alt('chStores', 'Highest waste percent stores: ' + [...withSales].sort((x, y) => y.pct - x.pct).slice(0, 12).map(s => `${s.name} ${pct(s.pct)}`).join(', '));
  alt('chProd', 'Most wasted products by value: ' + [...sc.prods].sort((x, y) => y.value - x.value).slice(0, 10).map(p => `${p.name} ${fmt(p.value)}`).join(', '));
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

// ---------- waste by store: every stored week side by side, items and days on click ----------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortWeek = k => { const w = state.weeks.find(x => x.week_key === k); return fmtDay((w && w.meta && w.meta.from) || k, false); };
function weekStores(w) { if (!w._stores || w._map !== state.mapping) { w._stores = buildStoreMap(w.records, w.sales).stores; w._map = state.mapping; } return w._stores; }
async function loadAllWeeks() { await Promise.all(state.weeks.map(w => getWeekData(w.week_key))); }
const fcWeeks = () => state.weeks.map(w => w.week_key).sort().filter(k => state.weekCache.has(k));
const hc = (v, max, txt) => v > 0 ? `<span class="hc" style="--h:${Math.min(1, v / (max || 1)).toFixed(2)}">${txt}</span>` : '<span class="dim">–</span>';
function fcRows() {
  const wks = fcWeeks(), map = new Map();
  for (const wk of wks) for (const [key, s] of weekStores(state.weekCache.get(wk))) {
    if ((state.am && s.am !== state.am) || !(s.waste > 0)) continue;
    const r = map.get(key) || { key, name: s.name, am: s.am, w: {}, total: 0 };
    r.w[wk] = (r.w[wk] || 0) + s.waste; r.total += s.waste; map.set(key, r);
  }
  const rows = [...map.values()].sort((x, y) => y.total - x.total), n = wks.length;
  rows.forEach((r, i) => {
    r.rank = i + 1; r.avg = n ? r.total / n : 0;
    const last = r.w[wks[n - 1]] || 0, prev = r.w[wks[n - 2]] || 0;
    r.trend = n >= 2 && prev > 0 ? (last - prev) / prev : null;
  });
  return { rows, wks };
}
function storewaste() {
  document.querySelectorAll('#fcViewSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.fcv === fc.tabView));
  const red = fc.tabView === 'reduce';
  $('redCtl').hidden = !red; $('fcDownloadAll').hidden = !red;
  $('fcHint').textContent = red ? '' : 'Stores ranked by waste value, highest first, with every stored week side by side. Click a store to see which items create the waste, by week or by day.';
  const need = state.weeks.filter(w => !state.weekCache.has(w.week_key));
  if (need.length && !state.wkLoading && !state.wkError) {
    state.wkLoading = true; state.wkError = false;
    loadAllWeeks().then(() => { state.wkLoading = false; if (state.tab === 'storewaste') render(); })
      .catch(() => { state.wkLoading = false; state.wkError = true; if (state.tab === 'storewaste') render(); });
  }
  if (red) return renderReduceTab(need);
  const { rows: all, wks } = fcRows(), q = norm($('fcSearch').value), rows = all.filter(r => !q || norm(r.name + ' ' + r.am).includes(q));
  const total = all.reduce((s, r) => s + r.total, 0), top = all[0];
  const kp = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('fcKpis').innerHTML = kp('Waste value', fmt(total), `${wks.length} week${wks.length === 1 ? '' : 's'} stored`) + kp('Average per week', fmt(wks.length ? total / wks.length : 0), 'all stores in view') +
    kp('Stores with waste', all.length, state.am || 'all area managers') + kp('Highest store', top ? fmt(top.total) : '–', top ? esc(top.name) : '');
  $('fcStatus').textContent = state.wkError ? 'Some weeks could not be loaded.' : need.length ? `Loading ${need.length} more week${need.length === 1 ? '' : 's'}…` : wks.length < 2 ? 'Upload more weeks to compare weeks and see trends.' : '';
  const maxByWeek = Object.fromEntries(wks.map(k => [k, Math.max(0, ...rows.map(r => r.w[k] || 0))])), maxTotal = Math.max(0, ...rows.map(r => r.total));
  const cols = [
    { k: 'name', h: 'Store', f: r => `<span class="rk">${r.rank}</span>${esc(r.name)}`, sort: r => r.name },
    { k: 'am', h: 'Area manager', f: r => esc(r.am) },
    ...wks.map(k => ({ k: 'w_' + k, h: 'Wk ' + shortWeek(k), f: r => hc(r.w[k] || 0, maxByWeek[k], fmt(r.w[k] || 0)), sort: r => r.w[k] || 0 })),
    { k: 'total', h: 'Total', f: r => `<b>${hc(r.total, maxTotal, fmt(r.total))}</b>`, def: true },
    { k: 'avg', h: 'Avg / week', f: r => fmt(r.avg) },
    { k: 'trend', h: 'Last vs prev', f: r => r.trend == null ? '<span class="dim">–</span>' : `<span class="${r.trend > 0.005 ? 't-high' : r.trend < -0.005 ? 't-ok' : ''}">${r.trend > 0.005 ? '▲' : r.trend < -0.005 ? '▼' : '='} ${Math.abs(r.trend * 100).toFixed(0)}%</span>`, sort: r => r.trend }
  ];
  if (!rows.length) { $('tblFc').innerHTML = `<tbody><tr><td class="muted" style="text-align:center;padding:32px">${need.length ? 'Loading weeks…' : 'No waste found for this selection.'}</td></tr></tbody>`; }
  else table($('tblFc'), cols, rows, 'fc', r => openStoreForecast(r));
  state.fcExport = { rows, wks };
}
// ---------- reduce by: cut ordering/production by 80-90% of the average daily waste of the past 7 days ----------
function weekDaySet(w) { if (!w._daySet) { const s = new Set(); for (const r of w.records) if (r.day != null) s.add(r.day); w._daySet = s; } return w._daySet; }
const q1 = v => v >= 100 ? fmt(v, 0) : fmt(v, 1);
const rng = (x, y, f) => { const a = f(x), b = f(y); return a === b ? a : `${a} – ${b}`; };
function reduceCalc() {
  const wks = fcWeeks(); if (!wks.length) return null;
  const present = new Set(); wks.forEach(k => weekDaySet(state.weekCache.get(k)).forEach(d => present.add(d)));
  if (!present.size) return null;
  const latest = Math.max(...present), days = []; for (let d = latest - 6; d <= latest; d++) days.push(d);
  const div = Math.max(1, days.filter(d => present.has(d)).length);
  const lo = Math.min(fc.lo, fc.hi) / 100, hi = Math.max(fc.lo, fc.hi) / 100, map = new Map();
  for (const wk of [...wks].reverse()) for (const [sk, s] of weekStores(state.weekCache.get(wk))) {
    if (state.am && s.am !== state.am) continue;
    for (const [pk, p] of s.prod) for (const d of days) {
      const x = p.days.get(d); if (!x || !(x.qty > 0)) continue;
      const key = sk + '|' + pk; let r = map.get(key);
      if (!r) map.set(key, r = { sk, key: sk, store: s.name, am: s.am, item: p.name, um: p.um, cat: p.cat, qty: 0, val: 0, nd: 0, seen: new Set() });
      if (r.seen.has(d)) continue; r.seen.add(d); r.qty += x.qty; r.val += x.value; r.nd++;
    }
  }
  const rows = [...map.values()].filter(r => r.nd >= fc.minDays).map(r => {
    const unit = r.qty ? r.val / r.qty : 0; r.avg = r.qty / div; r.dLo = r.avg * lo; r.dHi = r.avg * hi;
    r.wLo = r.avg * 7 * lo; r.wHi = r.avg * 7 * hi; r.sLo = r.wLo * unit; r.sHi = r.wHi * unit; return r;
  });
  const st = new Map();
  for (const r of rows) { const s = st.get(r.sk) || { sk: r.sk, key: r.sk, name: r.store, am: r.am, n: 0, val: 0, sLo: 0, sHi: 0 }; s.n++; s.val += r.val; s.sLo += r.sLo; s.sHi += r.sHi; st.set(r.sk, s); }
  const stores = [...st.values()].sort((x, y) => y.sHi - x.sHi); stores.forEach((s, i) => { s.rank = i + 1; });
  const iso0 = dayISO(days[0]), iso1 = dayISO(days[6]);
  return { rows, stores, div, lo, hi, days, label: `${fmtDay(iso0, iso0.slice(0, 4) !== iso1.slice(0, 4))} – ${fmtDay(iso1, true)}`,
    totLo: stores.reduce((s, x) => s + x.sLo, 0), totHi: stores.reduce((s, x) => s + x.sHi, 0) };
}
const redNote = c => `for each item we take the waste quantity of the past 7 days (${c.label}), divide by ${c.div === 7 ? '7' : c.div + ' days of data'} for the average daily waste, and suggest cutting the daily order or production by ${Math.round(c.lo * 100)}–${Math.round(c.hi * 100)}% of it. Value saved uses the item's average cost per unit from your waste records.`;
function renderReduceTab(need) {
  const c = reduceCalc(), q = norm($('fcSearch').value);
  const kp = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v${String(v).length > 12 ? ' vl' : ''}">${v}</div><div class="s">${s}</div></div>`;
  $('fcStatus').textContent = state.wkError ? 'Some weeks could not be loaded.' : need.length ? `Loading ${need.length} more week${need.length === 1 ? '' : 's'}…` : '';
  if (!c || !c.stores.length) {
    $('fcKpis').innerHTML = ''; state.fcExport = { kind: 'reduce', stores: [], c: null };
    $('tblFc').innerHTML = `<tbody><tr><td class="muted" style="text-align:center;padding:32px">${need.length ? 'Loading weeks…' : 'No items match. Try a lower “at least” number of days.'}</td></tr></tbody>`; return;
  }
  $('fcHint').textContent = 'How it works: ' + redNote(c);
  $('fcKpis').innerHTML = kp('Saving per week', rng(c.totLo, c.totHi, fmt), `cut ${Math.round(c.lo * 100)}–${Math.round(c.hi * 100)}% of average daily waste`) +
    kp('Stores', c.stores.length, state.am || 'all area managers') + kp('Items to cut', fmt(c.rows.length), `wasted on ${fc.minDays}+ of the last 7 days`) + kp('Based on', c.label, `${c.div} day${c.div === 1 ? '' : 's'} of data`);
  const stores = c.stores.filter(s => !q || norm(s.name + ' ' + s.am).includes(q));
  const cols = [
    { k: 'name', h: 'Store', f: s => `<span class="rk">${s.rank}</span>${esc(s.name)}`, sort: s => s.name },
    { k: 'am', h: 'Area manager', f: s => esc(s.am) },
    { k: 'n', h: 'Items to cut', f: s => s.n },
    { k: 'val', h: 'Waste last 7 days', f: s => fmt(s.val) },
    { k: 'sHi', h: 'Saving per week', f: s => `<b>${rng(s.sLo, s.sHi, fmt)}</b>`, def: true }
  ];
  if (!stores.length) $('tblFc').innerHTML = '<tbody><tr><td class="muted" style="text-align:center;padding:32px">No store matches your search.</td></tr></tbody>';
  else table($('tblFc'), cols, stores, 'red', s => openStoreForecast(s, 'reduce'));
  state.fcExport = { kind: 'reduce', stores, c };
}
function reduceModalHtml(m) {
  const c = reduceCalc(), rows = c ? c.rows.filter(r => r.sk === fc.key).sort((x, y) => y.sHi - x.sHi) : [];
  const head = `<h2>${esc(m.info.name)}</h2><div class="muted">${esc(m.info.am)}${m.info.rom ? ' · ROM ' + esc(m.info.rom) : ''}${m.info.city ? ' · ' + esc(m.info.city) : ''}</div>`;
  const ctl = `<div class="fc-controls">${fcSeg('view', FC_VIEWS)}<button type="button" class="btn fc-dl" data-fc="download">↓ Excel</button></div>`;
  if (!c || !rows.length) return head + ctl + `<p class="muted">No items to reduce for this store${fc.minDays > 1 ? ` (showing only items wasted on ${fc.minDays}+ of the last 7 days)` : ''}.</p>`;
  const body = rows.map(r => `<tr><td class="it">${esc(r.item)} <small>${esc(r.um)}</small></td><td class="cat">${esc(r.cat)}</td><td>${r.nd} / 7</td><td>${q1(r.qty)}</td><td>${q1(r.avg)}</td><td class="tot">${rng(r.dLo, r.dHi, q1)}</td><td>${rng(r.wLo, r.wHi, q1)}</td><td class="tot">${rng(r.sLo, r.sHi, fmt)}</td></tr>`).join('');
  const tLo = rows.reduce((s, r) => s + r.sLo, 0), tHi = rows.reduce((s, r) => s + r.sHi, 0);
  return head + `<p class="fc-sum">Potential saving <b>${rng(tLo, tHi, fmt)}</b> per week across <b>${rows.length}</b> item${rows.length === 1 ? '' : 's'}.</p>` + ctl +
    `<div class="mx"><table><thead><tr><th>Item</th><th>Category</th><th>Days wasted</th><th>Waste, last 7 days</th><th>Avg daily waste</th><th>Cut per day</th><th>Cut per week</th><th>Saving per week</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td class="it">All items</td><td></td><td></td><td></td><td></td><td></td><td></td><td class="tot">${rng(tLo, tHi, fmt)}</td></tr></tfoot></table></div>
    <p class="muted small">How it works: ${redNote(c)} Change the percentage range on the Waste by store tab. Items wasted on only a few days are less predictable, so cut them more carefully.</p>`;
}
function downloadFcTable() {
  if (fc.tabView === 'reduce') {
    const { stores, c } = state.fcExport || {}; if (!c) return;
    const aoa = [['Rank', 'Store', 'Area manager', 'Items to cut', 'Waste last 7 days', 'Saving per week (low)', 'Saving per week (high)'],
      ...stores.map(s => [s.rank, s.name, s.am, s.n, Math.round(s.val * 100) / 100, Math.round(s.sLo * 100) / 100, Math.round(s.sHi * 100) / 100])];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Reduce by - stores'); saveWB(wb, 'Reduce_by_stores.xlsx'); return;
  }
  downloadRankTable();
}
function downloadReduceItems() {
  const c = reduceCalc(); if (!c) return;
  const r2 = v => Math.round(v * 100) / 100, q = norm($('fcSearch').value);
  const aoa = [['Store', 'Area manager', 'Item', 'Unit', 'Category', 'Days wasted (of 7)', 'Waste last 7 days', 'Avg daily waste', `Cut per day (${Math.round(c.lo * 100)}%)`, `Cut per day (${Math.round(c.hi * 100)}%)`, 'Cut per week (low)', 'Cut per week (high)', 'Saving per week (low)', 'Saving per week (high)'],
    ...c.rows.filter(r => !q || norm(r.store + ' ' + r.am).includes(q)).sort((x, y) => y.sHi - x.sHi).map(r => [r.store, r.am, r.item, r.um, r.cat, r.nd, r2(r.qty), r2(r.avg), r2(r.dLo), r2(r.dHi), r2(r.wLo), r2(r.wHi), r2(r.sLo), r2(r.sHi)])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Reduce by - items'); saveWB(wb, 'Reduce_by_items.xlsx');
}
function downloadRankTable() {
  const { rows, wks } = state.fcExport || { rows: [], wks: [] };
  const aoa = [['Rank', 'Store', 'Area manager', ...wks.map(k => 'Week ' + weekLabel(k, (state.weeks.find(w => w.week_key === k) || {}).meta)), 'Total', 'Average per week', 'Last vs previous week %'],
    ...rows.map(r => [r.rank, r.name, r.am, ...wks.map(k => Math.round((r.w[k] || 0) * 100) / 100), Math.round(r.total * 100) / 100, Math.round(r.avg * 100) / 100, r.trend == null ? '' : Math.round(r.trend * 1000) / 10])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Waste by store'); saveWB(wb, 'Waste_by_store.xlsx');
}

// store detail: items by week or by day (value or quantity)
const fc = { key: '', mode: 'week', metric: 'value', dayWeek: '', tabView: 'rank', lo: 80, hi: 90, minDays: 1 };
function openStoreForecast(row, mode) {
  fc.key = row.key; fc.mode = mode || 'week'; fc.metric = 'value'; const w = fcWeeks(); fc.dayWeek = w[w.length - 1] || '';
  openModal(fcModalHtml(), { wide: true });
}
function fcModel() {
  const wks = fcWeeks(), items = new Map(), storeW = {}; let info = null;
  for (const wk of wks) {
    const s = weekStores(state.weekCache.get(wk)).get(fc.key); if (!s) continue;
    info = info || s; storeW[wk] = s.waste;
    for (const [pk, p] of s.prod) {
      let it = items.get(pk); if (!it) items.set(pk, it = { name: p.name, um: p.um, cat: p.cat, weeks: {}, days: {} });
      it.weeks[wk] = { v: p.value, q: p.qty };
      if (wk === fc.dayWeek) for (const [d, x] of p.days) it.days[d] = { v: x.value, q: x.qty };
    }
  }
  const g = x => x ? (fc.metric === 'qty' ? x.q : x.v) : 0;
  let cols, avgLabel, cell;
  if (fc.mode === 'day') {
    const set = new Set(); items.forEach(it => Object.keys(it.days).forEach(d => set.add(+d)));
    cols = [...set].sort((x, y) => x - y).map(d => { const iso = dayISO(d), dow = DOW[new Date(iso + 'T00:00:00Z').getUTCDay()]; return { id: d, label: `${dow} ${+iso.slice(8)}` }; });
    avgLabel = 'Avg / day'; cell = (it, c) => g(it.days[c.id]);
  } else {
    cols = wks.map(k => ({ id: k, label: 'Wk ' + shortWeek(k) })); avgLabel = 'Avg / week'; cell = (it, c) => g(it.weeks[c.id]);
  }
  const nAvg = cols.length || 1;
  const rows = [...items.values()].map(it => {
    const vals = cols.map(c => cell(it, c)), total = vals.reduce((s, v) => s + v, 0);
    const tv = Object.values(it.weeks).reduce((s, x) => s + x.v, 0);
    return { name: it.name, um: it.um, cat: it.cat, vals, total, avg: total / nAvg, tv };
  }).filter(r => r.total > 0).sort((x, y) => y.total - x.total);
  const scopeTotal = fc.mode === 'day' ? (storeW[fc.dayWeek] || 0) : Object.values(storeW).reduce((s, v) => s + v, 0);
  rows.forEach(r => { r.share = fc.metric === 'value' && scopeTotal ? r.total / scopeTotal : null; });
  const foot = fc.metric === 'value' ? cols.map((c, i) => rows.reduce((s, r) => s + r.vals[i], 0)) : null;
  return { wks, cols, rows, foot, info, avgLabel, storeW, scopeTotal };
}
const fcSeg = (name, opts) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([v, l]) => `<button type="button" data-fc="${name}:${v}" aria-pressed="${fc[name === 'view' ? 'mode' : name] === v}">${l}</button>`).join('')}</div>`;
const FC_VIEWS = [['week', 'By week'], ['day', 'By day'], ['reduce', 'Reduce by']];
function fcModalHtml() {
  const m = fcModel();
  if (!m.info) return '<h2>No data</h2><p class="muted">This store has no waste in the stored weeks.</p>';
  if (fc.mode === 'reduce') return reduceModalHtml(m);
  const nf = v => v > 0 ? (fc.metric === 'qty' ? fmt(v, 1) : fmt(v)) : '<span class="dim">–</span>';
  const max = Math.max(0, ...m.rows.flatMap(r => r.vals));
  const seg = (name, opts) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([v, l]) => `<button type="button" data-fc="${name}:${v}" aria-pressed="${fc[name === 'view' ? 'mode' : name] === v}">${l}</button>`).join('')}</div>`;
  const allTotal = Object.values(m.storeW).reduce((s, v) => s + v, 0), nW = Object.keys(m.storeW).length || 1;
  const wkOpts = m.wks.map(k => `<option value="${k}"${k === fc.dayWeek ? ' selected' : ''}>${esc(weekLabel(k, (state.weeks.find(w => w.week_key === k) || {}).meta))}</option>`).join('');
  const heads = m.cols.map(c => `<th>${esc(c.label)}</th>`).join('');
  const body = m.rows.map(r => `<tr><td class="it">${esc(r.name)} <small>${esc(r.um)}</small></td><td class="cat">${esc(r.cat)}</td>${r.vals.map(v => `<td>${v > 0 ? `<span class="hc" style="--h:${Math.min(1, v / (max || 1)).toFixed(2)}">${nf(v)}</span>` : nf(v)}</td>`).join('')}<td class="tot">${nf(r.total)}</td><td>${nf(r.avg)}</td><td>${r.share == null ? '' : (r.share * 100).toFixed(1) + '%'}</td></tr>`).join('');
  const foot = m.foot ? `<tfoot><tr><td class="it">All items</td><td></td>${m.foot.map(v => `<td>${nf(v)}</td>`).join('')}<td class="tot">${nf(m.foot.reduce((s, v) => s + v, 0))}</td><td>${nf(m.foot.reduce((s, v) => s + v, 0) / (m.cols.length || 1))}</td><td></td></tr></tfoot>` : '';
  return `<h2>${esc(m.info.name)}</h2><div class="muted">${esc(m.info.am)}${m.info.rom ? ' · ROM ' + esc(m.info.rom) : ''}${m.info.city ? ' · ' + esc(m.info.city) : ''}</div>
    <p class="fc-sum">Waste value <b>${fmt(allTotal)}</b> over ${nW} week${nW === 1 ? '' : 's'} · average <b>${fmt(allTotal / nW)}</b> per week</p>
    <div class="fc-controls">${seg('view', FC_VIEWS)}${seg('metric', [['value', 'Waste value'], ['qty', 'Quantity']])}
      ${fc.mode === 'day' ? `<label class="fc-wk">Week <select data-fc-week aria-label="Week for the day view">${wkOpts}</select></label>` : ''}
      <button type="button" class="btn fc-dl" data-fc="download">↓ Excel</button></div>
    ${m.rows.length ? `<div class="mx"><table><thead><tr><th>Item</th><th>Category</th>${heads}<th>Total</th><th>${m.avgLabel}</th><th>${fc.metric === 'value' ? 'Share' : ''}</th></tr></thead><tbody>${body}</tbody>${foot}</table></div>` : '<p class="muted">Nothing to show for this selection.</p>'}
    <p class="muted small">${fc.mode === 'day' ? 'Each column is one day of the chosen week.' : 'Each column is one stored week (oldest to newest).'} Darker cells mean more ${fc.metric === 'qty' ? 'quantity' : 'waste'}.</p>`;
}
function refreshFcModal(focusSel) {
  $('modalBody').innerHTML = fcModalHtml();
  const h2 = $('modalBody').querySelector('h2'); if (h2) h2.id = 'modalTitle';
  const el = focusSel && $('modalBody').querySelector(focusSel); if (el) el.focus({ preventScroll: true });
}
function downloadFcModal() {
  const m = fcModel(); if (!m.info) return;
  if (fc.mode === 'reduce') {
    const c = reduceCalc(); if (!c) return; const r2 = v => Math.round(v * 100) / 100;
    const aoa = [['Item', 'Unit', 'Category', 'Days wasted (of 7)', 'Waste last 7 days', 'Avg daily waste', 'Cut per day (low)', 'Cut per day (high)', 'Cut per week (low)', 'Cut per week (high)', 'Saving per week (low)', 'Saving per week (high)'],
      ...c.rows.filter(r => r.sk === fc.key).sort((x, y) => y.sHi - x.sHi).map(r => [r.item, r.um, r.cat, r.nd, r2(r.qty), r2(r.avg), r2(r.dLo), r2(r.dHi), r2(r.wLo), r2(r.wHi), r2(r.sLo), r2(r.sHi)])];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Reduce by'); saveWB(wb, `${m.info.code || 'store'}_reduce_by.xlsx`); return;
  }
  const aoa = [['Item', 'Unit', 'Category', ...m.cols.map(c => c.label), 'Total', m.avgLabel, ...(fc.metric === 'value' ? ['Share %'] : [])],
    ...m.rows.map(r => [r.name, r.um, r.cat, ...r.vals.map(v => Math.round(v * 100) / 100), Math.round(r.total * 100) / 100, Math.round(r.avg * 100) / 100, ...(r.share == null ? [] : [Math.round(r.share * 1000) / 10])])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Items');
  saveWB(wb, `${m.info.code || 'store'}_${fc.mode === 'day' ? 'by_day' : 'by_week'}_${fc.metric}.xlsx`);
}
$('modalBody').addEventListener('click', e => {
  const b = e.target.closest('[data-fc]'); if (!b) return;
  const [k, v] = b.dataset.fc.split(':');
  if (k === 'download') return downloadFcModal();
  if (k === 'view') fc.mode = v; if (k === 'metric') fc.metric = v;
  refreshFcModal(`[data-fc="${b.dataset.fc}"]`);
});
$('modalBody').addEventListener('change', e => { if (e.target.matches('[data-fc-week]')) { fc.dayWeek = e.target.value; refreshFcModal('[data-fc-week]'); } });
$('fcDownload').onclick = downloadFcTable;
$('fcDownloadAll').onclick = downloadReduceItems;
$('fcViewSeg').onclick = e => { const b = e.target.closest('[data-fcv]'); if (b) { fc.tabView = b.dataset.fcv; render(); } };
const clampPct = v => Math.max(1, Math.min(100, Math.round(+v || 0)));
$('redLo').onchange = e => { fc.lo = clampPct(e.target.value); e.target.value = fc.lo; render(); };
$('redHi').onchange = e => { fc.hi = clampPct(e.target.value); e.target.value = fc.hi; render(); };
$('redDays').onchange = e => { fc.minDays = +e.target.value || 1; render(); };

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
let modalReturn = null;
function openModal(html, opts) {
  const m = $('modal'); clearTimeout(m._t);
  $('modalBox').classList.toggle('wide', !!(opts && opts.wide));
  $('modalBody').innerHTML = html;
  const h2 = $('modalBody').querySelector('h2'); if (h2) h2.id = 'modalTitle';
  if (m.hidden) modalReturn = document.activeElement;
  m.hidden = false; document.documentElement.style.overflow = 'hidden';
  requestAnimationFrame(() => { m.classList.add('open'); $('modalBox').focus({ preventScroll: true }); });
}
function closeModal() {
  const m = $('modal'); if (m.hidden) return;
  m.classList.remove('open'); document.documentElement.style.overflow = '';
  m._t = setTimeout(() => { m.hidden = true; }, reduceMotion ? 0 : 130);
  if (modalReturn && modalReturn.isConnected) modalReturn.focus({ preventScroll: true }); modalReturn = null;
}
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

// ---------- delete a week ----------
function deleteWeekDialog() {
  const key = state.week, w = state.weeks.find(x => x.week_key === key);
  if (!w || state.dirty) return;
  const label = weekLabel(key, w.meta), needPass = !savedPass();
  openModal(`<h2>Delete this week?</h2>
    <p>This permanently deletes <b>${esc(label)}</b> and all of its waste and sales data (${fmt((w.meta && w.meta.records) || 0)} records). Your other weeks are not affected. This cannot be undone.</p>
    ${needPass ? '<p><input type="password" id="delPass" class="delpass" placeholder="Upload passcode" autocomplete="off" aria-label="Upload passcode"></p>' : ''}
    <div class="delrow"><button type="button" class="btn" id="delCancel">Cancel</button><button type="button" class="btn danger" id="delConfirm">Delete week</button></div>
    <div id="delMsg" class="small gate-msg" aria-live="polite"></div>`);
  $('delCancel').onclick = closeModal;
  $('delConfirm').onclick = async () => {
    const pass = savedPass() || ($('delPass') && $('delPass').value) || '', msg = $('delMsg'), btn = $('delConfirm');
    if (!pass) { msg.textContent = 'Enter the passcode.'; return; }
    btn.disabled = true; msg.textContent = 'Deleting…';
    try {
      await rpc('delete_week', { p_passcode: pass, p_week: key });
      state.weekCache.delete(key); closeModal(); await refreshWeeks();
      if (state.weeks.length) await selectWeek(state.weeks[0].week_key);
      else { state.records = []; state.sales = []; state.week = ''; state.published = null; build(); render(); $('emptyTitle').textContent = 'No data published yet'; $('emptyText').textContent = 'Open “Update data” to upload a waste report and publish it.'; renderWeekSelect(); }
      toast(`✓ Week ${label} was deleted.`);
    } catch (e) {
      if (e.code === 'auth') { try { localStorage.removeItem('hmPass'); } catch (x) {} msg.textContent = 'Wrong passcode.'; } else msg.textContent = 'Not deleted. Check your connection and try again.';
      btn.disabled = false;
    }
  };
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
$('btnMapReset').onclick = () => { try { localStorage.removeItem('wasteMapping'); } catch (e) {} loadMapping(window.DEFAULT_MAPPING, false); build(); render(); if (state.records.length) markDirty(); };
$('btnPublish').onclick = () => publish();
$('passcode').onkeydown = e => { if (e.key === 'Enter') publish(); };
$('fileWaste').onchange = e => { handleWasteFiles([...e.target.files]); e.target.value = ''; };
$('fileMap').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const wb = await readWB(f); let rows = [];
    for (const n of wb.SheetNames) { try { rows = parseMappingRows(toAOA(wb.Sheets[n])); if (rows.length) break; } catch (err) {} }
    if (!rows.length) throw new Error('No area manager rows found. Download the mapping template for the expected columns.');
    loadMapping(rows, true);
    notice(''); build(); render(); if (state.records.length) markDirty();
  } catch (err) { notice('Mapping file: ' + err.message); }
};
$('amSelect').onchange = e => { state.am = e.target.value; render(); };
$('weekSelect').onchange = e => selectWeek(e.target.value);
$('btnDeleteWeek').onclick = deleteWeekDialog;
$('thHigh').onchange = e => { state.high = (+e.target.value || 0) / 100; render(); };
$('thLow').onchange = e => { state.low = (+e.target.value || 0) / 100; render(); };
['storeSearch', 'storeStatus', 'prodSearch', 'prodCat', 'fcSearch'].forEach(id => $(id).oninput = render);
$('tabs').onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) { state.tab = b.dataset.tab; render(); } };
$('tabs').onkeydown = e => {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(e.key)) return;
  const bs = [...document.querySelectorAll('#tabs button')]; let i = bs.findIndex(b => b.dataset.tab === state.tab);
  i = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length;
  e.preventDefault(); state.tab = bs[i].dataset.tab; render(); bs[i].focus();
};
{ const t0 = location.hash.slice(1); if (['overview', 'stores', 'storewaste', 'products', 'extremes', 'managers'].includes(t0)) state.tab = t0; }
$('modalClose').onclick = closeModal;
$('modal').onclick = e => { if (e.target === $('modal')) closeModal(); };
document.addEventListener('keydown', e => {
  const menu = document.querySelector('details.more');
  if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else if (menu.open) { menu.open = false; menu.querySelector('summary').focus(); } }
  if (e.key === 'Tab' && !$('modal').hidden) {
    const f = [...$('modalBox').querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $('modalBox'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
// menu: close on outside click and after an action
document.addEventListener('click', e => { const d = document.querySelector('details.more'); if (d.open && !d.contains(e.target)) d.open = false; });
document.querySelector('.menu').addEventListener('click', e => { if (e.target.closest('button')) document.querySelector('details.more').open = false; });
['fileWaste', 'fileMap'].forEach(id => $(id).addEventListener('change', () => { document.querySelector('details.more').open = false; }));

loadMapping(window.DEFAULT_MAPPING || [], false);
render();
let savedView = ''; try { savedView = localStorage.getItem('hmView') || localStorage.getItem('hmPass') || ''; } catch (e) {}
$('gateBtn').onclick = () => loadShared($('gatePw').value.trim(), true);
$('gatePw').onkeydown = e => { if (e.key === 'Enter') loadShared($('gatePw').value.trim(), true); };
// ---------- intro animation ----------
const splash = { el: $('splash'), video: $('splashVideo'), videoDone: false, dataDone: false, gone: false };
function hideSplash() { if (splash.gone) return; splash.gone = true; splash.el.classList.add('out'); setTimeout(() => splash.el.remove(), 600); }
function trySplash() { if (splash.videoDone && splash.dataDone) hideSplash(); }
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { splash.gone = true; splash.el.remove(); }
else {
  const vDone = () => { splash.videoDone = true; trySplash(); };
  splash.video.addEventListener('ended', vDone);
  splash.video.addEventListener('error', vDone);
  splash.video.querySelectorAll('source').forEach(s => s.addEventListener('error', () => { if (!splash.video.currentSrc) vDone(); }));
  const p = splash.video.play(); if (p && p.catch) p.catch(vDone);
  $('splashSkip').onclick = hideSplash;
  setTimeout(hideSplash, 8000);
}
loadShared(savedView).finally(() => { splash.dataDone = true; trySplash(); });
window.__wasteApp = { state, handleWasteFiles };
})();
