/* Token Launch Radar — renders window.RADAR (written by main.ts beside this page) with no network.
   State lives in the location hash (#q=, #cat=, #wl=1, #sort=, #p=<slug>) so every view of the board —
   including the screenshots in this entry's dossier — is a link that reproduces itself. */
'use strict';

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const $ = (id) => document.getElementById(id);

const state = { q: '', cat: 'all', wl: false, sort: 'rank', open: null };

/* ---------- formatting ---------- */
function fmtUsd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function fmtPct(c) {
  if (c === null || c === undefined) return '<span class="flat">—</span>';
  const cls = c > 0.05 ? 'pos' : c < -0.05 ? 'neg' : 'flat';
  return `<span class="${cls}">${c > 0 ? '+' : ''}${c.toFixed(1)}%</span>`;
}
function fmtFactor(x) { return '×' + x.toFixed(2); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function fmtDate(iso) {
  if (!iso) return 'not in record';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtAge(years) {
  if (years === null || years === undefined) return 'unknown';
  if (years >= 1) return years.toFixed(1) + ' yrs';
  return Math.max(1, Math.round(years * 12)) + ' mo';
}

/* ---------- header, method, ratio chips ---------- */
function renderStats() {
  const cells = [
    [R.protocolCount, 'protocols scanned'],
    [R.tokenedCount, 'already tokened'],
    [R.watchlistCount, 'on the watchlist'],
    [rows.length, 'ranked on board'],
  ];
  $('stats').innerHTML = cells.map(([v, label]) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`).join('');
}

function renderMethod() {
  $('method-text').innerHTML =
    `Every protocol that records a token in this snapshot prices a dollar of TVL for its category: ` +
    `<b>implied value = TVL × the category's median market-cap/TVL ratio</b>, learned from the snapshot's own ` +
    `${R.tokenedCount} tokened protocols (snapshot-wide median <b>${R.globalRatio.toFixed(2)}×</b>; a category with few ` +
    `tokened peers is shrunk toward that median rather than trusted). The result is adjusted for ` +
    `<b>seven-day TVL momentum</b> (×0.75–1.45), a <b>tokenless track record</b> (up to +45% at five years tracked) and ` +
    `<b>chain breadth</b> (up to +25%). Protocols whose token already trades are set aside, and wrappers or versioned ` +
    `deployments of tokened parents are kept off the board by the watchlist's own rule. Snapshot: DefiLlama, ${esc(R.as_of)}; ` +
    `watchlist floor ${fmtUsd(R.floor_usd)} of TVL.`;
  const onBoard = new Set(rows.map((r) => r.category ?? 'Uncategorised'));
  $('ratios').innerHTML = R.categories
    .filter((c) => onBoard.has(c.category))
    .slice(0, 14)
    .map((c) => `<span class="ratio-chip">${esc(c.category)} <b>${c.ratio.toFixed(2)}×</b> · ${c.peers} tokened</span>`)
    .join('');
}

/* ---------- filtering and sorting ---------- */
const SORTERS = {
  rank: (a, b) => a.rank - b.rank,
  name: (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  tvl: (a, b) => b.tvl_usd - a.tvl_usd,
  chg: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
  age: (a, b) => (b.ageYears ?? -1) - (a.ageYears ?? -1),
  mult: (a, b) => b.implied_value_usd / b.tvl_usd - a.implied_value_usd / a.tvl_usd,
};

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (state.wl && !r.watchlist) return false;
    if (state.cat !== 'all' && (r.category ?? 'Uncategorised') !== state.cat) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q) || r.chains.some((c) => c.toLowerCase().includes(q)))) return false;
    return true;
  });
  return list.sort(SORTERS[state.sort] || SORTERS.rank);
}

function barWidth(mult) {
  const lo = Math.log(0.02), hi = Math.log(4);
  return Math.max(2, Math.min(100, ((Math.log(Math.max(mult, 0.02)) - lo) / (hi - lo)) * 100));
}

function rowHtml(r) {
  const mult = r.implied_value_usd / r.tvl_usd;
  return `<tr data-slug="${esc(r.slug)}" tabindex="0">
    <td class="rank num">${r.rank}</td>
    <td class="proto"><b>${esc(r.name)}</b>${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}<span class="slug">${esc(r.slug)}</span></td>
    <td class="cat">${esc(r.category ?? 'Uncategorised')}</td>
    <td class="num">${r.chains.length}</td>
    <td class="num">${fmtUsd(r.tvl_usd)}</td>
    <td class="num">${fmtPct(r.change_7d)}</td>
    <td class="val num">${fmtUsd(r.implied_value_usd)}</td>
    <td class="bar-cell"><div class="bar"><i style="width:${barWidth(mult).toFixed(1)}%"></i></div><div class="bar-note">${mult.toFixed(2)}× its TVL</div></td>
  </tr>`;
}

function renderBoard() {
  const list = visibleRows();
  $('rows').innerHTML = list.map(rowHtml).join('');
  $('empty').hidden = list.length > 0;
  $('count').textContent = `${list.length} of ${rows.length} protocols shown`;
}

/* ---------- detail view ---------- */
function buildTable(r) {
  const peers = r.ratioPeers === 0
    ? 'no tokened peers in this category, so the snapshot-wide median applies'
    : `median of ${r.ratioPeers} tokened peer${r.ratioPeers === 1 ? '' : 's'}, shrunk toward the snapshot median`;
  const lines = [
    ['TVL (snapshot)', fmtUsd(r.tvl_usd)],
    [`× category ratio — ${esc(r.category ?? 'Uncategorised')}, ${peers}`, fmtFactor(r.ratio)],
    ['= base value at category pricing', fmtUsd(r.base)],
    [`× momentum — TVL ${r.change_7d === null ? 'change unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '% in 7 days'}`, fmtFactor(r.momentumFactor)],
    [`× track record — ${fmtAge(r.ageYears)} with no token recorded`, fmtFactor(r.ageFactor)],
    [`× chain breadth — live on ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}`, fmtFactor(r.breadthFactor)],
  ];
  return `<table class="build">${lines.map(([k, v]) => `<tr><td>${k}</td><td class="v">${v}</td></tr>`).join('')}
    <tr class="total"><td>Implied launch value</td><td class="v">${fmtUsd(r.implied_value_usd)}</td></tr></table>`;
}

function detailHtml(r) {
  return `
  <p class="d-rank">BOARD RANK #${r.rank}${r.watchlist ? ' · ON THE HOUSE WATCHLIST' : ' · EARLY FIND BELOW THE $50M FLOOR'}</p>
  <h2 class="d-name">${esc(r.name)}</h2>
  <p class="d-sub">${esc(r.category ?? 'Uncategorised')} · records no token in the snapshot of ${esc(R.as_of)}</p>
  <div class="d-value"><small>Implied launch value</small>${fmtUsd(r.implied_value_usd)}</div>
  <div class="facts">
    <div class="fact"><span>TVL</span><b>${fmtUsd(r.tvl_usd)}</b></div>
    <div class="fact"><span>7-day TVL change</span><b>${r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</b></div>
    <div class="fact"><span>Tracked since</span><b>${fmtDate(r.listed_at)}</b></div>
    <div class="fact"><span>Value multiple</span><b>${(r.implied_value_usd / r.tvl_usd).toFixed(2)}× TVL</b></div>
  </div>
  <p class="chains"><b>Chains (${r.chains.length}):</b> ${r.chains.map(esc).join(', ')}</p>
  <h3>How this number is built</h3>
  ${buildTable(r)}
  <h3>Farm plan — before any launch</h3>
  <ol class="plan">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
  <p class="note">Implied value is the model's claim, derived only from this snapshot's figures — not a
  prediction that ${esc(r.name)} will issue a token, or when. “Records no token” follows DefiLlama's record,
  which can lag a launch; check the protocol's own channels before acting.</p>`;
}

function openDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) return;
  state.open = slug;
  $('detail').innerHTML = detailHtml(r);
  $('drawer').hidden = false;
  $('scrim').hidden = false;
  $('drawer').scrollTop = 0;
  syncHash();
}
function closeDetail() {
  state.open = null;
  $('drawer').hidden = true;
  $('scrim').hidden = true;
  syncHash();
}

/* ---------- hash state ---------- */
function syncHash() {
  const parts = [];
  if (state.q) parts.push('q=' + encodeURIComponent(state.q));
  if (state.cat !== 'all') parts.push('cat=' + encodeURIComponent(state.cat));
  if (state.wl) parts.push('wl=1');
  if (state.sort !== 'rank') parts.push('sort=' + state.sort);
  if (state.open) parts.push('p=' + encodeURIComponent(state.open));
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
}
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  state.q = h.get('q') ?? '';
  $('q').value = state.q;
  state.cat = h.get('cat') ?? 'all';
  if ([...$('cat').options].some((o) => o.value === state.cat)) $('cat').value = state.cat;
  state.wl = h.get('wl') === '1';
  $('wl').checked = state.wl;
  state.sort = h.get('sort') && SORTERS[h.get('sort')] ? h.get('sort') : 'rank';
  $('sort').value = state.sort;
  return h.get('p');
}

/** Re-apply the hash to the whole view: used at load and whenever the hash changes under us. */
function applyHash() {
  const open = readHash();
  renderBoard();
  if (open && bySlug.has(open)) openDetail(open);
  else if (state.open) closeDetail();
}

/* ---------- wiring ---------- */
function init() {
  renderStats();
  renderMethod();
  const cats = [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  $('cat').innerHTML = '<option value="all">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  applyHash();
  window.addEventListener('hashchange', applyHash);

  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); syncHash(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); syncHash(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); syncHash(); });
  $('wl').addEventListener('change', (e) => { state.wl = e.target.checked; renderBoard(); syncHash(); });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      state.sort = th.dataset.sort === 'name' ? 'name' : th.dataset.sort;
      $('sort').value = SORTERS[state.sort] && ['rank', 'tvl', 'chg', 'age', 'mult'].includes(state.sort) ? state.sort : 'rank';
      renderBoard(); syncHash();
    });
  });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  $('rows').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  $('close').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
}

init();
