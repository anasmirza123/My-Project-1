'use strict';
/* =====================================================================
   Garment Management System - browser app (no libraries needed)
   ===================================================================== */

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => dstr(new Date());
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return dstr(new Date(y, m - 1, d + n)); };
const fmtDate = s => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const shortDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const money = n => 'PKR ' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const lastDigits = s => { const d = String(s || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');
const waNum = p => { const d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d.startsWith('0')) return '92' + d.slice(1); if (d.length === 10 && d.startsWith('3')) return '92' + d; return d; };
const waLink = (p, text) => 'https://wa.me/' + waNum(p) + (text ? '?text=' + encodeURIComponent(text) : '');
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : '')).replace(/[ \t]{2,}/g, ' ').trim();

const TYPES = { unclassified: 'Unclassified', wholesale: 'Wholesale', reseller: 'Reseller', retail: 'Retail', lead: 'Active lead', no_response: 'No response', other: 'Other' };
const PICK_TYPES = ['wholesale', 'reseller', 'retail', 'lead', 'no_response', 'other'];
const STATUS = { placed: 'Placed', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const OUTCOME = { open: 'Still chatting', ordered: 'Ordered', no_order: 'No order', no_response: 'No response' };
const MOVE = { opening: 'Opening stock', in: 'Received', out: 'Removed', count: 'Count correction', sale: 'Sold', return: 'Returned' };
const typeBadge = t => `<span class="badge t-${t}">${TYPES[t] || esc(t)}</span>`;
const statusBadge = s => `<span class="badge s-${s}">${STATUS[s] || esc(s)}</span>`;

/* ---------- state + api ---------- */
let S = { customers: [], categories: [], products: [], interactions: [], orders: [], lostReasons: [], settings: {} };
const cust = id => S.customers.find(c => c.id === id);
const prod = id => S.products.find(p => p.id === id);
const catName = id => (S.categories.find(c => c.id === id) || {}).name || '';

async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function load() { S = await api('/api/state'); $('#brandName').textContent = S.settings.businessName || 'Garment MS'; }
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'err' ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 2600);
}
async function safe(fn) { try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong', 'err'); } }
async function refreshAll() {
  await load();
  await render();
  if (custModal && document.body.contains(custModal.wrap)) refreshCustomerModal();
}

/* ---------- modals ---------- */
const modals = [];
let custModal = null;
function openModal(html, cls = '') {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  modals.push(wrap);
  document.body.classList.add('noscroll');
  return wrap;
}
function closeModal(w) {
  w = w || modals[modals.length - 1];
  if (!w) return;
  w.remove();
  const i = modals.indexOf(w); if (i >= 0) modals.splice(i, 1);
  if (custModal && custModal.wrap === w) custModal = null;
  if (!modals.length) document.body.classList.remove('noscroll');
}
const head = (title, sub) => `<div class="modal-head"><div><h2>${title}</h2>${sub || ''}</div><button class="x" type="button" data-action="closeModal" aria-label="Close">×</button></div>`;

/* ---------- event delegation ---------- */
const A = {}, C = {}, I = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !A[el.dataset.action]) return;
  e.preventDefault();
  safe(() => A[el.dataset.action](el, e));
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && C[el.dataset.change]) safe(() => C[el.dataset.change](el, e));
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el && I[el.dataset.input]) I[el.dataset.input](el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modals.length) { closeModal(); return; }
  const el = e.target.closest && e.target.closest('[data-enter]');
  if (e.key === 'Enter' && el && A[el.dataset.enter]) { e.preventDefault(); safe(() => A[el.dataset.enter](el, e)); return; }
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !modals.length) { e.preventDefault(); $('#intakePhone').focus(); }
});
A.closeModal = el => closeModal(el.closest('.modal-wrap'));
A.copy = async el => {
  try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); }
  catch (_) { const t = document.createElement('textarea'); t.value = el.dataset.text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Copied'); }
};

/* ---------- ui state + router ---------- */
const ui = { view: 'dashboard', dashDate: today(), custFilter: 'all', custCat: '', custQ: '', ordFilter: 'all', ordFrom: '', ordTo: '', ordQ: '', prodCat: '', stockFrom: today(), stockTo: today() };
const VIEWS = {
  dashboard: ['Dashboard', () => viewDashboard()],
  customers: ['Customers', () => viewCustomers()],
  orders: ['Orders', () => viewOrders()],
  products: ['Products and stock', () => viewProducts()],
  followups: ['Follow-ups', () => viewFollowups()],
  stock: ['Stock report', () => viewStock()],
  settings: ['Settings and backup', () => viewSettings()]
};
let renderToken = 0;
const dueFollowUps = () => S.interactions.filter(i => i.followUpDate && !i.followUpDone && i.followUpDate <= today());
async function render() {
  const tok = ++renderToken;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === ui.view));
  $('#pageTitle').textContent = VIEWS[ui.view][0];
  $('#navCustomers').textContent = S.customers.length || '';
  $('#navOrders').textContent = S.orders.filter(o => ['placed', 'packed', 'dispatched'].includes(o.status)).length || '';
  $('#navFollow').textContent = dueFollowUps().length || '';
  try {
    const html = await VIEWS[ui.view][1]();
    if (tok === renderToken) $('#view').innerHTML = html;
  } catch (e) {
    if (tok === renderToken) $('#view').innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`;
  }
}
function route() {
  const v = location.hash.replace('#/', '') || 'dashboard';
  ui.view = VIEWS[v] ? v : 'dashboard';
  render();
}
function go(view) { if (location.hash === '#/' + view) render(); else location.hash = '#/' + view; }

/* ---------- CSV export ---------- */
function downloadCSV(name, rows) {
  const csv = rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* =====================================================================
   QUICK PHONE INTAKE
   ===================================================================== */
$('#intakeForm').addEventListener('submit', e => {
  e.preventDefault();
  safe(async () => {
    const input = $('#intakePhone');
    const r = await api('/api/intake', 'POST', { phone: input.value, date: today() });
    input.value = '';
    await load(); await render();
    let banner, warn = false;
    if (!r.existed) banner = 'Number saved and today’s chat is logged. Choose the customer type below.';
    else if (r.chatCreated) { banner = 'This number is already in your records. A chat for today has been logged.'; warn = true; }
    else { banner = 'This number is already in your records, and today’s chat is already logged.'; warn = true; }
    openCustomer(r.customer.id, { banner, warn });
  });
});

/* =====================================================================
   DASHBOARD
   ===================================================================== */
function followCustomerIds() { return new Set(dueFollowUps().map(i => i.customerId)); }
async function viewDashboard() {
  const d = await api('/api/dashboard?date=' + ui.dashDate);
  const seg = d.segments, a = seg.active;
  const isToday = ui.dashDate === today();
  const prevLabel = isToday ? 'yesterday' : 'the day before';
  const delta = (n, y) => {
    const diff = n - y;
    if (!diff) return `<small>Same as ${prevLabel} (${y})</small>`;
    return `<span class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}</span> <small>vs ${y} ${prevLabel}</small>`;
  };
  const pct = (n, t) => (t ? Math.round(n / t * 100) : 0);
  const bar = (label, n, total, cls) => `<div class="br"><span>${label}</span><div class="track"><div class="fill ${cls}" style="width:${pct(n, total)}%"></div></div><span class="right">${n} <small class="muted">${pct(n, total)}%</small></span></div>`;
  const prevCust = new Set(S.orders.filter(o => o.status !== 'cancelled').map(o => o.customerId)).size;
  const inProgress = S.orders.filter(o => ['placed', 'packed', 'dispatched'].includes(o.status)).length;
  const delivered = S.orders.filter(o => o.status === 'delivered').length;
  const cnt = t => S.customers.filter(c => c.type === t).length;
  const tile = (label, n, action, arg) => `<button class="tile" data-action="${action}" data-arg="${arg}"><span>${label}</span><b>${n}</b></button>`;
  const maxTrend = Math.max(1, ...d.trend.map(t => t.chats));
  const lostMax = Math.max(1, ...d.lostReasons.map(r => r.count));
  const due = dueFollowUps().sort((x, y) => x.followUpDate.localeCompare(y.followUpDate));
  const low = S.products.filter(p => p.stock <= 0 || (p.lowStockAt > 0 && p.stock <= p.lowStockAt));

  return `
  <div class="page-head">
    <h2>${isToday ? 'Today' : fmtDate(ui.dashDate)}</h2>
    <div class="row">
      <button class="btn" data-action="dashPrev" aria-label="Previous day">‹</button>
      <input type="date" value="${ui.dashDate}" data-change="dashDate">
      <button class="btn" data-action="dashNext" aria-label="Next day">›</button>
      ${isToday ? '' : '<button class="btn" data-action="dashToday">Back to today</button>'}
    </div>
  </div>

  <div class="tiles">
    ${tile('All customers', S.customers.length, 'goCust', 'all')}
    ${tile('Wholesale', cnt('wholesale'), 'goCust', 'wholesale')}
    ${tile('Resellers', cnt('reseller'), 'goCust', 'reseller')}
    ${tile('Retail', cnt('retail'), 'goCust', 'retail')}
    ${tile('Active leads', cnt('lead'), 'goCust', 'lead')}
    ${tile('No response', cnt('no_response'), 'goCust', 'no_response')}
    ${tile('Unclassified', cnt('unclassified'), 'goCust', 'unclassified')}
    ${tile('Previous customers', prevCust, 'goCust', 'previous')}
    ${tile('Orders in progress', inProgress, 'goOrders', 'progress')}
    ${tile('Delivered orders', delivered, 'goOrders', 'delivered')}
  </div>

  <div class="kpis">
    <div class="kpi main"><span>Chats received</span><b>${d.chats}</b>${delta(d.chats, d.yesterday.chats)}</div>
    <div class="kpi"><span>Orders</span><b>${d.orders}</b>${delta(d.orders, d.yesterday.orders)}</div>
    <div class="kpi"><span>Order value</span><b style="font-size:24px;margin:8px 0 6px">${money(d.revenue)}</b><small class="muted">${prevLabel}: ${money(d.yesterday.revenue)}</small></div>
    <div class="kpi"><span>Active lead conversion</span><b>${d.activeConversion}%</b><small class="muted">${a.ordered} of ${a.chats} active leads ordered</small></div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Where the ${d.chats} chats came from</h2>
      <p class="sub">Wholesalers and resellers are counted on their own. The rest are no-response or active leads.</p>
      <div class="bars">
        ${bar('Wholesalers', seg.wholesale.chats, d.chats, 'blue')}
        ${bar('Resellers', seg.reseller.chats, d.chats, 'purple')}
        ${bar('Active leads', a.chats, d.chats, '')}
        ${bar('No response', seg.no_response.chats, d.chats, 'red')}
        ${bar('Not sorted yet', seg.unclassified.chats, d.chats, 'grey')}
      </div>
      <p class="small muted" style="margin-bottom:0">Wholesale orders: ${seg.wholesale.ordered} of ${seg.wholesale.chats} chats. Reseller orders: ${seg.reseller.ordered} of ${seg.reseller.chats} chats.</p>
    </div>
    <div class="card">
      <h2>What happened with the ${a.chats} active leads</h2>
      <p class="sub">Orders placed, and chats that ended without an order.</p>
      <div class="funnel">
        <div><span class="muted small">Active leads</span><b>${a.chats}</b></div>
        <div class="ok"><span class="muted small">Ordered</span><b>${a.ordered}</b></div>
        <div class="no"><span class="muted small">No order</span><b>${a.no_order}</b></div>
        <div class="op"><span class="muted small">Still open</span><b>${a.open}</b></div>
      </div>
      <h3 style="font-size:14px;margin:16px 0 4px">Why they did not order</h3>
      <div class="bars">
        ${d.lostReasons.length ? d.lostReasons.map(r => `<div class="br"><span>${esc(r.reason)}</span><div class="track"><div class="fill red" style="width:${pct(r.count, lostMax)}%"></div></div><span class="right">${r.count}</span></div>`).join('')
          : '<div class="empty" style="padding:10px">No lost-order reasons recorded for this day. Open a customer and set the chat outcome to “No order”.</div>'}
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Last 7 days</h2>
    <div class="trend">${d.trend.map(t => `<div class="day"><div class="pair">
      <div class="bar" style="height:${Math.max(2, t.chats / maxTrend * 100)}%"><i>${t.chats}</i></div>
      <div class="bar o" style="height:${Math.max(2, t.orders / maxTrend * 100)}%"><i>${t.orders}</i></div></div>
      <div class="lbl">${shortDate(t.date)}</div></div>`).join('')}</div>
    <div class="legend"><span><i></i>Chats</span><span><i class="o"></i>Orders</span></div>
  </div>

  <div class="grid2">
    <div class="card">
      <div class="row"><h2 class="grow">Follow-ups due</h2><a class="btn link" href="#/followups">See all</a></div>
      ${due.length ? due.slice(0, 6).map(i => { const c = cust(i.customerId); return c ? `<div class="item"><div class="row"><b class="grow">${esc(c.name || c.phone)}</b>${typeBadge(c.type)}<button class="btn sm" data-action="openCust" data-id="${c.id}">Open</button></div><div class="meta"><span class="${i.followUpDate < today() ? 'overdue' : 'duetoday'}">${i.followUpDate < today() ? 'Overdue since ' : 'Due '}${fmtDate(i.followUpDate)}</span>${i.followUpNote ? ' · ' + esc(i.followUpNote) : ''}</div></div>` : ''; }).join('') : '<div class="empty">Nothing is waiting for a reminder.</div>'}
    </div>
    <div class="card">
      <div class="row"><h2 class="grow">Stock needing attention</h2><a class="btn link" href="#/products">Manage stock</a></div>
      ${low.length ? low.slice(0, 8).map(p => `<div class="item"><div class="row"><b class="grow">${esc(p.name)}</b><span class="low">${p.stock <= 0 ? 'Out of stock' : p.stock + ' left'}</span></div><div class="meta">${esc(catName(p.categoryId)) || 'No category'}</div></div>`).join('') : '<div class="empty">All products are above their low-stock level.</div>'}
    </div>
  </div>`;
}
A.dashPrev = () => { ui.dashDate = addDays(ui.dashDate, -1); render(); };
A.dashNext = () => { ui.dashDate = addDays(ui.dashDate, 1); render(); };
A.dashToday = () => { ui.dashDate = today(); render(); };
C.dashDate = el => { if (el.value) { ui.dashDate = el.value; render(); } };
A.goCust = el => { ui.custFilter = el.dataset.arg; ui.custCat = ''; ui.custQ = ''; go('customers'); };
A.goOrders = el => { ui.ordFilter = el.dataset.arg; ui.ordFrom = ui.ordTo = ui.ordQ = ''; go('orders'); };
A.openCust = el => openCustomer(el.dataset.id);

/* =====================================================================
   CUSTOMERS LIST
   ===================================================================== */
function filteredCustomers() {
  const f = ui.custFilter, q = ui.custQ.toLowerCase().trim(), qd = q.replace(/\D/g, '');
  const hasOrder = new Set(S.orders.filter(o => o.status !== 'cancelled').map(o => o.customerId));
  const fu = followCustomerIds();
  return S.customers.filter(c => {
    if (f === 'previous' ? !hasOrder.has(c.id) : f === 'followup' ? !fu.has(c.id) : (f !== 'all' && c.type !== f)) return false;
    if (ui.custCat && c.categoryId !== ui.custCat) return false;
    if (q && !((c.name || '').toLowerCase().includes(q) || (c.notes || '').toLowerCase().includes(q) || (qd && c.phone.replace(/\D/g, '').includes(qd)))) return false;
    return true;
  }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
function viewCustomers() {
  const hasOrder = new Set(S.orders.filter(o => o.status !== 'cancelled').map(o => o.customerId));
  const fu = followCustomerIds();
  const filters = [['all', 'All'], ['unclassified', 'Unclassified'], ['wholesale', 'Wholesale'], ['reseller', 'Resellers'], ['retail', 'Retail'], ['lead', 'Active leads'], ['no_response', 'No response'], ['other', 'Other'], ['previous', 'Previous customers'], ['followup', 'Follow-up due']];
  const count = f => f === 'all' ? S.customers.length : f === 'previous' ? hasOrder.size : f === 'followup' ? fu.size : S.customers.filter(c => c.type === f).length;
  const list = filteredCustomers();
  const lastChat = id => S.interactions.filter(i => i.customerId === id).map(i => i.date).sort().pop();
  return `
  <div class="page-head"><h2>Customers</h2>
    <div class="row"><button class="btn" data-action="exportCustomers">Export list (CSV)</button></div></div>
  <div class="card">
    <div class="chips" style="margin-bottom:12px">${filters.map(([k, l]) => `<button class="chip ${ui.custFilter === k ? 'on' : ''}" data-action="custFilter" data-arg="${k}">${l}<small>${count(k)}</small></button>`).join('')}</div>
    <div class="row" style="margin-bottom:12px">
      <input class="grow" id="custSearch" placeholder="Search by phone, name or notes" value="${esc(ui.custQ)}" data-input="custSearch">
      <select data-change="custCat"><option value="">All sub-categories</option>${S.categories.map(c => `<option value="${c.id}" ${ui.custCat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    </div>
    <div class="tablewrap" id="custTable">${customerTable(list, lastChat)}</div>
  </div>`;
}
function customerTable(list, lastChat) {
  if (!list.length) return `<div class="empty">${S.customers.length ? 'No customers match this filter.' : 'No customers yet. Type a phone number in the box at the top and press Enter.'}</div>`;
  return `<table><thead><tr><th>Phone</th><th>Name</th><th>Type</th><th>Sub-category and products</th><th class="num">Orders</th><th>Last chat</th></tr></thead><tbody>
    ${list.map(c => {
      const prods = (c.productIds || []).map(id => (prod(id) || {}).name).filter(Boolean);
      const sub = [catName(c.categoryId), prods.join(', ')].filter(Boolean).map(esc).join(' · ') || '<span class="muted">—</span>';
      const n = S.orders.filter(o => o.customerId === c.id && o.status !== 'cancelled').length;
      return `<tr class="click" data-action="openCust" data-id="${c.id}"><td><b>${esc(c.phone)}</b></td><td>${esc(c.name) || '<span class="muted">—</span>'}</td><td>${typeBadge(c.type)}</td><td>${sub}</td><td class="num">${n}</td><td>${fmtDate(lastChat(c.id))}</td></tr>`;
    }).join('')}</tbody></table><p class="small muted" style="margin:10px 0 0">${list.length} customer${list.length === 1 ? '' : 's'}</p>`;
}
A.custFilter = el => { ui.custFilter = el.dataset.arg; render(); };
C.custCat = el => { ui.custCat = el.value; render(); };
I.custSearch = el => {
  ui.custQ = el.value;
  const lastChat = id => S.interactions.filter(i => i.customerId === id).map(i => i.date).sort().pop();
  $('#custTable').innerHTML = customerTable(filteredCustomers(), lastChat);
};
A.exportCustomers = () => {
  const rows = [['Phone', 'Name', 'Type', 'Sub-category', 'Products of interest', 'Address', 'Other contact', 'Business / requirements', 'Orders', 'Added']];
  filteredCustomers().forEach(c => rows.push([c.phone, c.name, TYPES[c.type], catName(c.categoryId), (c.productIds || []).map(id => (prod(id) || {}).name).filter(Boolean).join('; '), c.address, c.altContact, c.notes, S.orders.filter(o => o.customerId === c.id && o.status !== 'cancelled').length, fmtDate(c.createdAt)]));
  downloadCSV('customers-' + today() + '.csv', rows);
};

/* =====================================================================
   CUSTOMER RECORD (modal)
   ===================================================================== */
function openCustomer(id, opts = {}) {
  if (custModal) closeModal(custModal.wrap);
  const wrap = openModal('', '');
  custModal = { wrap, id, chatDate: today(), banner: opts.banner || '', warn: !!opts.warn };
  refreshCustomerModal();
}
function refreshCustomerModal() {
  if (!custModal) return;
  const c = cust(custModal.id);
  if (!c) { closeModal(custModal.wrap); return; }
  $('.modal', custModal.wrap).innerHTML = customerHTML(c);
  applyProductFilter();
}
function customerHTML(c) {
  const date = custModal.chatDate;
  const chat = S.interactions.find(i => i.customerId === c.id && i.date === date) || { outcome: 'open', lostReason: '', notes: '', followUpDate: '', followUpNote: '' };
  const orders = S.orders.filter(o => o.customerId === c.id).sort(byDateDesc);
  const chats = S.interactions.filter(i => i.customerId === c.id).sort(byDateDesc);
  const spent = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
  const reminder = fill(S.settings.reminderTemplate, { name: c.name || 'Sir/Madam', business: S.settings.businessName, note: chat.followUpNote ? chat.followUpNote + ' ' : '' });
  return `
  ${head(esc(c.phone) + ' ' + typeBadge(c.type), `<div class="muted small" style="margin-top:4px">${orders.length} order${orders.length === 1 ? '' : 's'} · ${money(spent)} total · ${chats.length} chat${chats.length === 1 ? '' : 's'}</div>`)}
  <div class="modal-body">
    ${custModal.banner ? `<div class="banner ${custModal.warn ? 'warn' : ''}">${esc(custModal.banner)}</div>` : ''}
    <div class="sec">
      <h3>${c.type === 'unclassified' ? 'What kind of customer is this?' : 'Customer type'}</h3>
      <div class="type-grid">${PICK_TYPES.map(t => `<button type="button" class="type-btn ${c.type === t ? 'on' : ''}" data-action="setType" data-type="${t}">${TYPES[t]}</button>`).join('')}</div>
    </div>

    <div class="sec">
      <h3>Details <span class="muted small" style="font-weight:400">· everything here is optional</span></h3>
      <div class="form-grid">
        <div class="field"><label class="f" for="cPhone">Phone number</label><input id="cPhone" value="${esc(c.phone)}"></div>
        <div class="field"><label class="f" for="cName">Name</label><input id="cName" value="${esc(c.name)}"></div>
        <div class="field"><label class="f" for="cAlt">Other contact</label><input id="cAlt" value="${esc(c.altContact)}"></div>
        <div class="field"><label class="f" for="cCat">Sub-category (for example Jackton or Shilwar)</label>
          <select id="cCat" data-change="filterProducts"><option value="">None</option>${S.categories.map(x => `<option value="${x.id}" ${x.id === c.categoryId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field full"><label class="f">Products they are interested in</label>
          ${S.products.length ? `<div class="checks">${S.products.map(p => `<label class="prodchk" data-cat="${p.categoryId || ''}"><input type="checkbox" name="cprod" value="${p.id}" ${(c.productIds || []).includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}</div>` : '<div class="muted small">No products yet. Add them under Products and stock.</div>'}</div>
        <div class="field full"><label class="f" for="cAddr">Address</label><input id="cAddr" value="${esc(c.address)}"></div>
        <div class="field full"><label class="f" for="cNotes">Business and requirements</label><textarea id="cNotes" rows="2" placeholder="For example: runs a shop in Faisalabad, needs 200 pieces a month">${esc(c.notes)}</textarea></div>
      </div>
      <div class="row"><button class="btn primary" data-action="saveDetails">Save details</button>
        <a class="btn wa" target="_blank" rel="noopener" href="${waLink(c.phone)}">Open WhatsApp chat</a>
        <button class="btn" data-action="copy" data-text="${esc(c.phone)}">Copy number</button>
        <span class="grow"></span><button class="btn danger" data-action="deleteCustomer">Delete customer</button></div>
    </div>

    <div class="sec">
      <h3>Chat on ${date === today() ? 'today' : fmtDate(date)}</h3>
      <div class="form-grid">
        <div class="field"><label class="f" for="chDate">Date</label><input type="date" id="chDate" value="${date}" data-change="chatDate"></div>
        <div class="field"><label class="f">How did it go?</label>
          <div class="seg">${Object.entries(OUTCOME).map(([k, l]) => `<label><input type="radio" name="chOutcome" value="${k}" ${chat.outcome === k ? 'checked' : ''} data-change="outcome">${l}</label>`).join('')}</div></div>
        <div class="field full" id="lostWrap" ${chat.outcome === 'no_order' ? '' : 'hidden'}><label class="f" for="chLost">Why no order?</label>
          <select id="chLost"><option value="">Select a reason</option>${S.lostReasons.map(r => `<option ${chat.lostReason === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        <div class="field full"><label class="f" for="chNotes">What was discussed</label><input id="chNotes" value="${esc(chat.notes)}" placeholder="For example: asked for 50 Jackton in black, size L"></div>
        <div class="field"><label class="f" for="chFollowDate">Follow up on</label><input type="date" id="chFollowDate" value="${chat.followUpDate || ''}"></div>
        <div class="field"><label class="f" for="chFollowNote">Reminder note</label><input id="chFollowNote" value="${esc(chat.followUpNote || '')}" placeholder="For example: new stock arrives Friday"></div>
      </div>
      <div class="row"><button class="btn primary" data-action="saveChat">Save chat</button>
        <a class="btn wa" target="_blank" rel="noopener" href="${waLink(c.phone, reminder)}">Send reminder on WhatsApp</a></div>
    </div>

    <div class="sec">
      <div class="row"><h3 class="grow" style="margin:0">Orders (${orders.length})</h3><button class="btn primary" data-action="newOrder" data-id="${c.id}">Add order</button></div>
      <div style="margin-top:10px">${orders.length ? orders.map(o => `<div class="item"><div class="row"><b class="grow">${esc(o.orderNo)} · ${money(o.total)}</b>${statusBadge(o.status)}</div>
        <div class="meta">${fmtDate(o.date)} · ${o.items.map(i => esc(i.name) + (i.size ? ' (' + esc(i.size) + ')' : '') + ' × ' + i.qty).join(', ')}${o.trackingId ? ' · Tracking ' + esc(o.trackingId) : ''}</div>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-action="editOrder" data-id="${o.id}">Edit</button></div></div>`).join('') : '<div class="empty" style="padding:12px">No orders yet.</div>'}</div>
    </div>

    <div class="sec">
      <h3>Chat history (${chats.length})</h3>
      ${chats.length ? chats.map(i => `<div class="item"><div class="row"><b class="grow">${fmtDate(i.date)}</b><span class="badge ${i.outcome === 'ordered' ? 's-delivered' : i.outcome === 'no_order' || i.outcome === 'no_response' ? 's-cancelled' : 's-placed'}">${OUTCOME[i.outcome]}</span><button class="btn sm danger" data-action="deleteChat" data-id="${i.id}">Delete</button></div>
        <div class="meta">${i.lostReason ? 'Reason: ' + esc(i.lostReason) + (i.notes ? ' · ' : '') : ''}${esc(i.notes)}${i.followUpDate ? '<br>Follow up ' + fmtDate(i.followUpDate) + (i.followUpDone ? ' (done)' : '') + (i.followUpNote ? ': ' + esc(i.followUpNote) : '') : ''}</div></div>`).join('') : '<div class="empty" style="padding:12px">No chats logged.</div>'}
    </div>
  </div>`;
}
function applyProductFilter() {
  if (!custModal) return;
  const w = custModal.wrap, sel = $('#cCat', w);
  if (!sel) return;
  $$('.prodchk', w).forEach(l => { l.hidden = !!sel.value && l.dataset.cat !== sel.value && !l.querySelector('input').checked; });
}
C.filterProducts = () => applyProductFilter();
C.outcome = el => { const w = custModal.wrap; $('#lostWrap', w).hidden = el.value !== 'no_order'; };
C.chatDate = el => { if (el.value) { custModal.chatDate = el.value; refreshCustomerModal(); } };
function collectDetails() {
  const w = custModal.wrap;
  return {
    phone: $('#cPhone', w).value, name: $('#cName', w).value, altContact: $('#cAlt', w).value, address: $('#cAddr', w).value,
    categoryId: $('#cCat', w).value || null, productIds: $$('input[name=cprod]:checked', w).map(i => i.value), notes: $('#cNotes', w).value
  };
}
A.setType = async el => {
  await api('/api/customers/' + custModal.id, 'PUT', Object.assign(collectDetails(), { type: el.dataset.type }));
  custModal.banner = '';
  await refreshAll();
  toast('Saved as ' + TYPES[el.dataset.type].toLowerCase());
};
A.saveDetails = async () => {
  await api('/api/customers/' + custModal.id, 'PUT', collectDetails());
  custModal.banner = '';
  await refreshAll();
  toast('Details saved');
};
A.saveChat = async () => {
  const w = custModal.wrap;
  const outcome = ($('input[name=chOutcome]:checked', w) || {}).value || 'open';
  await api('/api/interactions', 'POST', {
    customerId: custModal.id, date: $('#chDate', w).value || today(), outcome,
    lostReason: $('#chLost', w).value, notes: $('#chNotes', w).value,
    followUpDate: $('#chFollowDate', w).value, followUpNote: $('#chFollowNote', w).value
  });
  await refreshAll();
  toast('Chat saved');
};
A.deleteChat = async el => {
  if (!confirm('Delete this chat record?')) return;
  await api('/api/interactions/' + el.dataset.id, 'DELETE');
  await refreshAll();
};
A.deleteCustomer = async () => {
  const c = cust(custModal.id);
  if (!confirm('Delete ' + c.phone + ' with all of their chats and orders? Stock from their orders will be returned. This cannot be undone.')) return;
  await api('/api/customers/' + c.id, 'DELETE');
  closeModal(custModal.wrap);
  await refreshAll();
  toast('Customer deleted');
};

/* =====================================================================
   ORDERS
   ===================================================================== */
const IN_PROGRESS = ['placed', 'packed', 'dispatched'];
function filteredOrders() {
  const q = ui.ordQ.toLowerCase().trim(), qd = q.replace(/\D/g, '');
  return S.orders.filter(o => {
    if (ui.ordFilter === 'progress' && !IN_PROGRESS.includes(o.status)) return false;
    if (ui.ordFilter === 'delivered' && o.status !== 'delivered') return false;
    if (ui.ordFilter === 'cancelled' && o.status !== 'cancelled') return false;
    if (ui.ordFrom && o.date < ui.ordFrom) return false;
    if (ui.ordTo && o.date > ui.ordTo) return false;
    if (q) {
      const hay = [o.orderNo, o.customerName, o.trackingId, o.address, o.items.map(i => i.name).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q) && !(qd && o.phone.replace(/\D/g, '').includes(qd))) return false;
    }
    return true;
  }).sort(byDateDesc);
}
function viewOrders() {
  const list = filteredOrders();
  const active = list.filter(o => o.status !== 'cancelled');
  const filters = [['all', 'All'], ['progress', 'In progress'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
  return `
  <div class="page-head"><h2>Orders</h2>
    <div class="row"><button class="btn" data-action="exportOrders">Export (CSV)</button><button class="btn primary" data-action="newOrder">New order</button></div></div>
  <div class="card">
    <div class="chips" style="margin-bottom:12px">${filters.map(([k, l]) => `<button class="chip ${ui.ordFilter === k ? 'on' : ''}" data-action="ordFilter" data-arg="${k}">${l}</button>`).join('')}</div>
    <div class="row" style="margin-bottom:12px">
      <input class="grow" id="ordSearch" placeholder="Search order no, name, phone, tracking ID, product" value="${esc(ui.ordQ)}" data-enter="ordSearch">
      <label class="small muted">From <input type="date" value="${ui.ordFrom}" data-change="ordFrom"></label>
      <label class="small muted">To <input type="date" value="${ui.ordTo}" data-change="ordTo"></label>
      <button class="btn" data-action="ordSearch">Search</button>
    </div>
    <p class="small muted" style="margin:0 0 8px">${list.length} order${list.length === 1 ? '' : 's'} · ${money(active.reduce((s, o) => s + o.total, 0))} value (cancelled orders not counted) · ${money(active.reduce((s, o) => s + Math.max(0, o.total - o.paid), 0))} still to collect</p>
    <div class="tablewrap">${list.length ? `<table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th class="num">Amount</th><th>Tracking</th><th>Status</th><th>Delivery address</th><th></th></tr></thead><tbody>
    ${list.map(o => {
      const track = fill(S.settings.trackingTemplate, { name: o.customerName || 'Sir/Madam', business: S.settings.businessName, orderNo: o.orderNo, tracking: o.trackingId, courier: o.courier ? 'via ' + o.courier : '' });
      return `<tr><td><b>${esc(o.orderNo)}</b><div class="small muted">${fmtDate(o.date)}</div></td>
        <td><a href="#" data-action="openCust" data-id="${o.customerId}"><b>${esc(o.customerName) || esc(o.phone)}</b></a><div class="small muted">${esc(o.phone)}</div></td>
        <td>${o.items.map(i => esc(i.name) + (i.size ? ' <span class="muted">(' + esc(i.size) + ')</span>' : '') + ' × ' + i.qty).join('<br>')}</td>
        <td class="num">${money(o.total)}<div class="small ${o.paid >= o.total ? 'muted' : 'overdue'}">${o.paid >= o.total ? 'Paid' : 'Balance ' + money(o.total - o.paid)}</div></td>
        <td>${o.trackingId ? `${esc(o.trackingId)} <button class="btn link" data-action="copy" data-text="${esc(o.trackingId)}">Copy</button>` : '<span class="muted">—</span>'}${o.courier ? `<div class="small muted">${esc(o.courier)}</div>` : ''}</td>
        <td><select data-change="orderStatus" data-id="${o.id}">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${esc(o.address) || '<span class="muted">—</span>'}</td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-action="editOrder" data-id="${o.id}">Edit</button>
          <a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(o.phone, o.trackingId ? track : '')}">WhatsApp</a>
          <button class="btn sm danger" data-action="deleteOrder" data-id="${o.id}">Delete</button></div></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No orders match. Use “New order” to add one.</div>'}</div>
  </div>`;
}
A.ordFilter = el => { ui.ordFilter = el.dataset.arg; render(); };
A.ordSearch = () => { ui.ordQ = $('#ordSearch').value; render(); };
C.ordFrom = el => { ui.ordFrom = el.value; render(); };
C.ordTo = el => { ui.ordTo = el.value; render(); };
C.orderStatus = async el => {
  await api('/api/orders/' + el.dataset.id, 'PUT', { status: el.value });
  await refreshAll();
  toast('Order marked ' + STATUS[el.value].toLowerCase());
};
A.deleteOrder = async el => {
  if (!confirm('Delete this order? Its stock will be returned.')) return;
  await api('/api/orders/' + el.dataset.id, 'DELETE');
  await refreshAll();
  toast('Order deleted');
};
A.exportOrders = () => {
  const rows = [['Order no', 'Date', 'Name', 'Phone', 'Address', 'Items', 'Total', 'Paid', 'Status', 'Tracking ID', 'Courier']];
  filteredOrders().forEach(o => rows.push([o.orderNo, o.date, o.customerName, o.phone, o.address, o.items.map(i => i.name + (i.size ? ' (' + i.size + ')' : '') + ' x' + i.qty).join('; '), o.total, o.paid, STATUS[o.status], o.trackingId, o.courier]));
  downloadCSV('orders-' + today() + '.csv', rows);
};

/* ---------- order form (modal) ---------- */
let orderCtx = null;
const COURIERS = ['TCS', 'Leopards', 'M&P', 'PostEx', 'Trax', 'BlueEx', 'Call Courier', 'Pakistan Post', 'Own rider'];
A.newOrder = el => openOrderModal({ customerId: el.dataset.id || null });
A.editOrder = el => openOrderModal({ orderId: el.dataset.id });
function itemRow(it) {
  return `<div class="oi" data-row>
    <div><select class="it-prod" data-change="itemProd"><option value="">Other item…</option>${S.products.map(p => `<option value="${p.id}" ${it.productId === p.id ? 'selected' : ''}>${esc(p.name)} (${p.stock} in stock)</option>`).join('')}</select>
      <input class="it-name" placeholder="Item name" value="${esc(it.name)}" style="margin-top:4px;${it.productId ? 'display:none' : ''}"></div>
    <input class="it-size" placeholder="Size or colour" value="${esc(it.size)}">
    <input class="it-qty" type="number" min="1" value="${it.qty || 1}" data-input="calcOrder" aria-label="Quantity">
    <input class="it-price" type="number" min="0" step="any" value="${it.price || ''}" data-input="calcOrder" aria-label="Price each">
    <div class="lt">0</div>
    <button type="button" class="x" data-action="rmRow" aria-label="Remove item">×</button>
    <div class="hint" hidden></div></div>`;
}
function openOrderModal({ customerId, orderId }) {
  const order = orderId ? S.orders.find(o => o.id === orderId) : null;
  const c = cust(customerId || (order && order.customerId));
  const o = order || { items: [{ qty: 1 }], status: 'placed', date: today(), paid: 0, trackingId: '', courier: '', notes: '', customerName: c ? c.name : '', address: c ? c.address : '', total: 0 };
  const wrap = openModal(`
    ${head(order ? 'Edit order ' + esc(order.orderNo) : 'New order', c ? `<div class="muted small" style="margin-top:4px">${esc(c.phone)}</div>` : '')}
    <div class="modal-body">
      ${c ? '' : `<div class="field"><label class="f" for="oCust">Customer phone number</label><input id="oCust" list="custList" placeholder="Type or pick a number. New numbers are saved automatically." autocomplete="off">
        <datalist id="custList">${S.customers.map(x => `<option value="${esc(x.phone)}">${esc(x.name)}</option>`).join('')}</datalist></div>`}
      <h3 style="font-size:15px;margin-bottom:8px">Items</h3>
      <div class="oi small muted"><span>Product</span><span>Size or colour</span><span>Qty</span><span>Price each</span><span class="right">Amount</span><span></span></div>
      <div id="oItems">${o.items.map(itemRow).join('')}</div>
      <button class="btn sm" data-action="addRow">Add another item</button>
      <div class="total-line">Items subtotal: <b id="oSub">0</b></div>
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label class="f" for="oTotal">Order total (change it for discounts or delivery charges)</label><input id="oTotal" type="number" min="0" step="any" value="${order ? o.total : ''}" data-input="totalManual" ${order ? 'data-manual="1"' : ''}></div>
        <div class="field"><label class="f" for="oPaid">Amount received so far</label><input id="oPaid" type="number" min="0" step="any" value="${o.paid || ''}"></div>
        <div class="field"><label class="f" for="oName">Name for delivery</label><input id="oName" value="${esc(o.customerName)}"></div>
        <div class="field"><label class="f" for="oDate">Order date</label><input id="oDate" type="date" value="${o.date}"></div>
        <div class="field full"><label class="f" for="oAddr">Delivery address</label><input id="oAddr" value="${esc(o.address)}"></div>
        <div class="field"><label class="f" for="oStatus">Status</label><select id="oStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label class="f" for="oTrack">Tracking ID</label><input id="oTrack" value="${esc(o.trackingId)}"></div>
        <div class="field"><label class="f" for="oCourier">Courier</label><input id="oCourier" list="courierList" value="${esc(o.courier)}"><datalist id="courierList">${COURIERS.map(x => `<option value="${x}">`).join('')}</datalist></div>
        <div class="field"><label class="f" for="oNotes">Notes</label><input id="oNotes" value="${esc(o.notes)}"></div>
      </div>
      <div class="row end"><button class="btn" data-action="closeModal">Cancel</button><button class="btn primary" data-action="saveOrder">${order ? 'Save changes' : 'Save order'}</button></div>
    </div>`, 'wide');
  orderCtx = { wrap, orderId, customerId: c ? c.id : null, order };
  calcOrder();
}
A.addRow = () => { $('#oItems', orderCtx.wrap).insertAdjacentHTML('beforeend', itemRow({ qty: 1 })); calcOrder(); };
A.rmRow = el => { const rows = $$('[data-row]', orderCtx.wrap); if (rows.length > 1) el.closest('[data-row]').remove(); calcOrder(); };
C.itemProd = el => {
  const row = el.closest('[data-row]'), p = prod(el.value);
  $('.it-name', row).style.display = p ? 'none' : '';
  if (p) { $('.it-name', row).value = p.name; if (!Number($('.it-price', row).value)) $('.it-price', row).value = p.price || ''; }
  calcOrder();
};
I.calcOrder = () => calcOrder();
I.totalManual = el => { el.dataset.manual = el.value === '' ? '' : '1'; if (!el.dataset.manual) calcOrder(); };
function calcOrder() {
  if (!orderCtx) return;
  const w = orderCtx.wrap;
  let sum = 0;
  const used = {};
  $$('[data-row]', w).forEach(row => {
    const qty = Math.max(0, Number($('.it-qty', row).value) || 0), price = Math.max(0, Number($('.it-price', row).value) || 0);
    $('.lt', row).textContent = (qty * price).toLocaleString('en-US');
    sum += qty * price;
    const p = prod($('.it-prod', row).value), hint = $('.hint', row);
    if (p) {
      used[p.id] = (used[p.id] || 0) + qty;
      const back = orderCtx.order && orderCtx.order.stockApplied ? orderCtx.order.items.filter(i => i.productId === p.id).reduce((s, i) => s + i.qty, 0) : 0;
      const avail = p.stock + back;
      hint.hidden = used[p.id] <= avail;
      hint.textContent = 'Only ' + avail + ' in stock. The order can still be saved and stock will go below zero.';
    } else hint.hidden = true;
  });
  $('#oSub', w).textContent = money(sum);
  const t = $('#oTotal', w);
  if (!t.dataset.manual) t.value = sum || '';
}
A.saveOrder = async () => {
  const w = orderCtx.wrap;
  const date = $('#oDate', w).value || today();
  let customerId = orderCtx.customerId;
  if (!customerId) {
    const t = $('#oCust', w).value.trim();
    if (!t) throw new Error('Enter the customer’s phone number.');
    const found = S.customers.find(c => c.phoneKey === lastDigits(t));
    customerId = found ? found.id : (await api('/api/intake', 'POST', { phone: t, date })).customer.id;
  }
  const items = $$('[data-row]', w).map(row => ({
    productId: $('.it-prod', row).value || null, name: $('.it-name', row).value, size: $('.it-size', row).value,
    qty: Number($('.it-qty', row).value) || 1, price: Number($('.it-price', row).value) || 0
  }));
  const body = {
    customerId, items, date, total: $('#oTotal', w).value, paid: $('#oPaid', w).value,
    customerName: $('#oName', w).value, address: $('#oAddr', w).value, status: $('#oStatus', w).value,
    trackingId: $('#oTrack', w).value, courier: $('#oCourier', w).value, notes: $('#oNotes', w).value
  };
  if (orderCtx.orderId) await api('/api/orders/' + orderCtx.orderId, 'PUT', body);
  else await api('/api/orders', 'POST', body);
  closeModal(w);
  orderCtx = null;
  await refreshAll();
  toast('Order saved');
};

/* =====================================================================
   PRODUCTS, CATEGORIES AND STOCK
   ===================================================================== */
function viewProducts() {
  const cats = S.categories;
  const list = S.products.filter(p => !ui.prodCat || (ui.prodCat === 'none' ? !p.categoryId : p.categoryId === ui.prodCat));
  const groups = [...cats.map(c => [c.id, c.name]), ['', 'No category']];
  return `
  <div class="page-head"><h2>Products and stock</h2></div>
  <div class="split">
    <div>
      <div class="card"><h2>Sub-categories</h2><p class="sub">Group products such as Jackton or Shilwar. Wholesale customers can be sorted under them.</p>
        <div class="row" style="margin-bottom:10px"><input class="grow" id="catName" placeholder="New sub-category name" data-enter="addCategory"><button class="btn primary" data-action="addCategory">Add</button></div>
        ${cats.length ? cats.map(c => `<div class="item"><div class="row"><b class="grow">${esc(c.name)}</b><span class="muted small">${S.products.filter(p => p.categoryId === c.id).length} products · ${S.customers.filter(x => x.categoryId === c.id).length} customers</span></div>
          <div class="row" style="margin-top:6px"><button class="btn sm" data-action="renameCategory" data-id="${c.id}">Rename</button><button class="btn sm danger" data-action="deleteCategory" data-id="${c.id}">Delete</button></div></div>`).join('') : '<div class="empty" style="padding:12px">No sub-categories yet.</div>'}
      </div>
      <div class="card"><h2>Add a product</h2>
        <div class="field"><label class="f" for="pName">Product name</label><input id="pName" placeholder="For example: Jackton black"></div>
        <div class="field"><label class="f" for="pCat">Sub-category</label><select id="pCat"><option value="">None</option>${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="form-grid"><div class="field"><label class="f" for="pPrice">Price each</label><input id="pPrice" type="number" min="0" step="any"></div>
          <div class="field"><label class="f" for="pStock">Stock you have now</label><input id="pStock" type="number" min="0"></div>
          <div class="field full"><label class="f" for="pLow">Warn me when stock is this low</label><input id="pLow" type="number" min="0" placeholder="Optional"></div></div>
        <button class="btn primary" data-action="addProduct">Add product</button>
      </div>
    </div>
    <div class="card"><div class="row" style="margin-bottom:12px"><h2 class="grow">Products (${S.products.length})</h2>
      <select data-change="prodCat"><option value="">All sub-categories</option>${cats.map(c => `<option value="${c.id}" ${ui.prodCat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="none" ${ui.prodCat === 'none' ? 'selected' : ''}>No category</option></select></div>
      <div class="tablewrap">${list.length ? `<table><thead><tr><th>Product</th><th class="num">Price</th><th class="num">In stock</th><th></th></tr></thead><tbody>
      ${groups.map(([id, name]) => { const ps = list.filter(p => (p.categoryId || '') === id); if (!ps.length) return '';
        return `<tr class="group"><td colspan="4">${esc(name)}</td></tr>` + ps.map(p => `<tr><td><b>${esc(p.name)}</b></td><td class="num">${p.price ? money(p.price) : '—'}</td>
          <td class="num ${p.stock <= 0 || (p.lowStockAt && p.stock <= p.lowStockAt) ? 'low' : ''}">${p.stock}${p.stock <= 0 ? '<div class="small">Out of stock</div>' : p.lowStockAt && p.stock <= p.lowStockAt ? '<div class="small">Running low</div>' : ''}</td>
          <td><div class="row end" style="flex-wrap:nowrap"><button class="btn sm primary" data-action="stockModal" data-id="${p.id}">Stock</button><button class="btn sm" data-action="editProduct" data-id="${p.id}">Edit</button><button class="btn sm danger" data-action="deleteProduct" data-id="${p.id}">Delete</button></div></td></tr>`).join(''); }).join('')}
      </tbody></table>` : '<div class="empty">No products yet. Add your first product on the left.</div>'}</div>
    </div>
  </div>`;
}
C.prodCat = el => { ui.prodCat = el.value; render(); };
A.addCategory = async () => {
  const el = $('#catName'); if (!el.value.trim()) return;
  await api('/api/categories', 'POST', { name: el.value });
  await refreshAll(); toast('Sub-category added'); const n = $('#catName'); if (n) n.focus();
};
A.renameCategory = async el => {
  const c = S.categories.find(x => x.id === el.dataset.id);
  const name = prompt('New name for this sub-category', c.name);
  if (!name || !name.trim()) return;
  await api('/api/categories/' + c.id, 'PUT', { name });
  await refreshAll();
};
A.deleteCategory = async el => {
  if (!confirm('Delete this sub-category? Customers and products in it will stay but lose the sub-category.')) return;
  await api('/api/categories/' + el.dataset.id, 'DELETE');
  await refreshAll();
};
A.addProduct = async () => {
  await api('/api/products', 'POST', { name: $('#pName').value, categoryId: $('#pCat').value || null, price: $('#pPrice').value, stock: $('#pStock').value, lowStockAt: $('#pLow').value });
  await refreshAll(); toast('Product added');
};
A.deleteProduct = async el => {
  if (!confirm('Delete this product and its stock history? Past orders keep the item name.')) return;
  await api('/api/products/' + el.dataset.id, 'DELETE');
  await refreshAll();
};
A.editProduct = el => {
  const p = prod(el.dataset.id);
  openModal(`${head('Edit product')}<div class="modal-body">
    <div class="field"><label class="f" for="epName">Product name</label><input id="epName" value="${esc(p.name)}"></div>
    <div class="field"><label class="f" for="epCat">Sub-category</label><select id="epCat"><option value="">None</option>${S.categories.map(c => `<option value="${c.id}" ${p.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="form-grid"><div class="field"><label class="f" for="epPrice">Price each</label><input id="epPrice" type="number" min="0" step="any" value="${p.price || ''}"></div>
    <div class="field"><label class="f" for="epLow">Warn me when stock is this low</label><input id="epLow" type="number" min="0" value="${p.lowStockAt || ''}"></div></div>
    <div class="row end"><button class="btn" data-action="closeModal">Cancel</button><button class="btn primary" data-action="saveProduct" data-id="${p.id}">Save changes</button></div></div>`, 'narrow');
};
A.saveProduct = async el => {
  await api('/api/products/' + el.dataset.id, 'PUT', { name: $('#epName').value, categoryId: $('#epCat').value || null, price: $('#epPrice').value, lowStockAt: $('#epLow').value });
  closeModal(el.closest('.modal-wrap'));
  await refreshAll(); toast('Product saved');
};
async function openStockModal(id) {
  const p = prod(id);
  const { movements } = await api('/api/products/' + id + '/movements');
  const w = openModal(`${head(esc(p.name), `<div class="muted small" style="margin-top:4px">${p.stock} in stock now</div>`)}<div class="modal-body">
    <div class="sec"><h3>Change stock</h3>
      <div class="field"><div class="seg">
        <label><input type="radio" name="smode" value="in" checked>New stock received</label>
        <label><input type="radio" name="smode" value="out">Remove (damaged or lost)</label>
        <label><input type="radio" name="smode" value="count">Set to counted number</label></div></div>
      <div class="form-grid"><div class="field"><label class="f" for="sQty">Quantity</label><input id="sQty" type="number" min="0"></div>
        <div class="field"><label class="f" for="sDate">Date</label><input id="sDate" type="date" value="${today()}"></div>
        <div class="field full"><label class="f" for="sNote">Note (optional)</label><input id="sNote" placeholder="For example: new batch from the factory"></div></div>
      <div class="row"><button class="btn primary" data-action="saveStock" data-id="${id}">Save stock change</button></div></div>
    <div class="sec"><h3>Recent movements</h3>
      ${movements.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>What</th><th class="num">Change</th><th class="num">Balance</th><th>Note</th></tr></thead><tbody>${movements.map(m => `<tr><td>${fmtDate(m.date)}</td><td>${MOVE[m.type] || m.type}</td><td class="num ${m.delta < 0 ? 'overdue' : 'up'}">${m.delta > 0 ? '+' : ''}${m.delta}</td><td class="num">${m.balanceAfter}</td><td>${esc(m.note)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:12px">No stock movements yet.</div>'}
    </div></div>`, '');
  return w;
}
A.stockModal = el => openStockModal(el.dataset.id);
A.saveStock = async el => {
  const w = el.closest('.modal-wrap');
  await api('/api/products/' + el.dataset.id + '/stock', 'POST', { mode: $('input[name=smode]:checked', w).value, qty: $('#sQty', w).value, date: $('#sDate', w).value, note: $('#sNote', w).value });
  closeModal(w);
  await refreshAll();
  toast('Stock updated');
  openStockModal(el.dataset.id);
};

/* =====================================================================
   FOLLOW-UPS
   ===================================================================== */
function viewFollowups() {
  const list = S.interactions.filter(i => i.followUpDate && !i.followUpDone).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
  return `
  <div class="page-head"><h2>Follow-ups</h2></div>
  <div class="card"><p class="sub">Customers you planned to message again. Press the green button to open WhatsApp with the reminder message ready.</p>
  <div class="tablewrap">${list.length ? `<table><thead><tr><th>Due</th><th>Customer</th><th>Note</th><th>Last result</th><th></th></tr></thead><tbody>
    ${list.map(i => { const c = cust(i.customerId); if (!c) return '';
      const late = i.followUpDate < today(), now = i.followUpDate === today();
      const msg = fill(S.settings.reminderTemplate, { name: c.name || 'Sir/Madam', business: S.settings.businessName, note: i.followUpNote ? i.followUpNote + ' ' : '' });
      return `<tr><td><span class="${late ? 'overdue' : now ? 'duetoday' : ''}">${fmtDate(i.followUpDate)}</span><div class="small ${late ? 'overdue' : 'muted'}">${late ? 'Overdue' : now ? 'Today' : 'Upcoming'}</div></td>
      <td><b>${esc(c.name || c.phone)}</b> ${typeBadge(c.type)}<div class="small muted">${esc(c.phone)}</div></td><td>${esc(i.followUpNote) || '<span class="muted">—</span>'}</td>
      <td>${OUTCOME[i.outcome]}${i.lostReason ? '<div class="small muted">' + esc(i.lostReason) + '</div>' : ''}</td>
      <td><div class="row" style="flex-wrap:nowrap"><a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(c.phone, msg)}">WhatsApp reminder</a><button class="btn sm" data-action="followDone" data-id="${i.id}">Mark done</button><button class="btn sm" data-action="openCust" data-id="${c.id}">Open</button></div></td></tr>`; }).join('')}
  </tbody></table>` : '<div class="empty">No follow-ups planned. When you save a chat, pick a “Follow up on” date to see it here.</div>'}</div></div>`;
}
A.followDone = async el => { await api('/api/interactions/' + el.dataset.id, 'PUT', { followUpDone: true }); await refreshAll(); toast('Follow-up done'); };

/* =====================================================================
   STOCK REPORT
   ===================================================================== */
async function viewStock() {
  const r = await api('/api/stock-report?from=' + ui.stockFrom + '&to=' + ui.stockTo);
  const tot = r.rows.reduce((t, x) => { for (const k of ['opening', 'received', 'sold', 'adjust', 'closing']) t[k] += x[k]; return t; }, { opening: 0, received: 0, sold: 0, adjust: 0, closing: 0 });
  const rows = r.rows.slice().sort((a, b) => catName(a.categoryId).localeCompare(catName(b.categoryId)) || a.name.localeCompare(b.name));
  const single = r.from === r.to;
  return `
  <div class="page-head"><h2>Stock report</h2><button class="btn" data-action="exportStock">Export (CSV)</button></div>
  <div class="card">
    <div class="row" style="margin-bottom:6px">
      <label class="small muted">From <input type="date" value="${ui.stockFrom}" data-change="stockFrom"></label>
      <label class="small muted">To <input type="date" value="${ui.stockTo}" data-change="stockTo"></label>
      <button class="chip" data-action="stockRange" data-arg="0">Today</button><button class="chip" data-action="stockRange" data-arg="1">Yesterday</button><button class="chip" data-action="stockRange" data-arg="7">Last 7 days</button><button class="chip" data-action="stockRange" data-arg="30">Last 30 days</button>
    </div>
    <p class="sub">${single ? 'On ' + fmtDate(r.from) : fmtDate(r.from) + ' to ' + fmtDate(r.to)}: stock you started with, what came in, what was sold or dispatched, and what is left.</p>
    <div class="tablewrap">${rows.length ? `<table><thead><tr><th>Product</th><th>Sub-category</th><th class="num">Started with</th><th class="num">Received</th><th class="num">Sold or dispatched</th><th class="num">Other changes</th><th class="num">Left</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(catName(x.categoryId)) || '<span class="muted">—</span>'}</td><td class="num">${x.opening}</td><td class="num">${x.received || '—'}</td><td class="num">${x.sold || '—'}</td><td class="num">${x.adjust || '—'}</td><td class="num"><b>${x.closing}</b></td></tr>`).join('')}
    <tr class="group"><td colspan="2">Total</td><td class="num">${tot.opening}</td><td class="num">${tot.received}</td><td class="num">${tot.sold}</td><td class="num">${tot.adjust}</td><td class="num">${tot.closing}</td></tr></tbody></table>` : '<div class="empty">No products yet.</div>'}</div>
  </div>`;
}
C.stockFrom = el => { ui.stockFrom = el.value || today(); if (ui.stockTo < ui.stockFrom) ui.stockTo = ui.stockFrom; render(); };
C.stockTo = el => { ui.stockTo = el.value || ui.stockFrom; if (ui.stockTo < ui.stockFrom) ui.stockFrom = ui.stockTo; render(); };
A.stockRange = el => {
  const n = Number(el.dataset.arg);
  if (n === 0) { ui.stockFrom = ui.stockTo = today(); }
  else if (n === 1) { ui.stockFrom = ui.stockTo = addDays(today(), -1); }
  else { ui.stockFrom = addDays(today(), -(n - 1)); ui.stockTo = today(); }
  render();
};
A.exportStock = async () => {
  const r = await api('/api/stock-report?from=' + ui.stockFrom + '&to=' + ui.stockTo);
  const rows = [['Product', 'Sub-category', 'Started with', 'Received', 'Sold or dispatched', 'Other changes', 'Left']];
  r.rows.forEach(x => rows.push([x.name, catName(x.categoryId), x.opening, x.received, x.sold, x.adjust, x.closing]));
  downloadCSV('stock-report-' + r.from + (r.from === r.to ? '' : '-to-' + r.to) + '.csv', rows);
};

/* =====================================================================
   SETTINGS + BACKUP
   ===================================================================== */
function viewSettings() {
  const s = S.settings;
  return `
  <div class="page-head"><h2>Settings and backup</h2></div>
  <div class="grid2">
    <div class="card"><h2>Your business</h2>
      <div class="field"><label class="f" for="sName">Business name</label><input id="sName" value="${esc(s.businessName)}"></div>
      <div class="field"><label class="f" for="sRem">Reminder message (WhatsApp)</label><textarea id="sRem" rows="4">${esc(s.reminderTemplate)}</textarea></div>
      <div class="field"><label class="f" for="sTrack">Tracking message (WhatsApp)</label><textarea id="sTrack" rows="4">${esc(s.trackingTemplate)}</textarea></div>
      <p class="small muted">You can use {name}, {business} and {note} in the reminder, and {name}, {business}, {orderNo}, {tracking} and {courier} in the tracking message.</p>
      <button class="btn primary" data-action="saveSettings">Save settings</button></div>
    <div class="card"><h2>Reasons an order was not placed</h2><p class="sub">These appear when you mark a chat as “No order”. The dashboard counts them for you.</p>
      <div class="row" style="margin-bottom:10px"><input class="grow" id="newReason" placeholder="Add a reason" data-enter="addReason"><button class="btn primary" data-action="addReason">Add</button></div>
      ${S.lostReasons.map(r => `<div class="item"><div class="row"><span class="grow">${esc(r)}</span><button class="btn sm danger" data-action="delReason" data-reason="${esc(r)}">Remove</button></div></div>`).join('')}</div>
  </div>
  <div class="card"><h2>Backup and restore</h2>
    <p class="sub">Your records live in <code>data/db.json</code> inside the app folder. A copy is also saved automatically once a day in <code>data/backups</code>. Download a backup before moving to another computer.</p>
    <div class="row"><a class="btn primary" href="/api/backup">Download backup</a>
      <label class="btn" style="cursor:pointer">Restore from a backup file<input type="file" accept=".json,application/json" data-change="restoreFile" hidden></label></div></div>`;
}
A.saveSettings = async () => {
  await api('/api/settings', 'PUT', { businessName: $('#sName').value, reminderTemplate: $('#sRem').value, trackingTemplate: $('#sTrack').value });
  await refreshAll(); toast('Settings saved');
};
A.addReason = async () => {
  const el = $('#newReason'); if (!el.value.trim()) return;
  await api('/api/lostReasons', 'POST', { reason: el.value });
  await refreshAll();
  const n = $('#newReason'); if (n) n.focus();
};
A.delReason = async el => { await api('/api/lostReasons?reason=' + encodeURIComponent(el.dataset.reason), 'DELETE'); await refreshAll(); };
C.restoreFile = async el => {
  const f = el.files[0]; if (!f) return;
  if (!confirm('Replace ALL current records with the contents of this backup? A copy of the current data is kept in data/backups first.')) { el.value = ''; return; }
  let data;
  try { data = JSON.parse(await f.text()); } catch (_) { el.value = ''; throw new Error('That file could not be read as a backup.'); }
  await api('/api/restore', 'POST', data);
  el.value = '';
  await refreshAll();
  toast('Backup restored');
};

/* =====================================================================
   START
   ===================================================================== */
window.addEventListener('hashchange', route);
(async function init() {
  try {
    await load();
    route();
  } catch (e) {
    $('#view').innerHTML = '<div class="card"><div class="empty">Could not connect to the server. Make sure <code>node server.js</code> is still running in your terminal, then refresh this page.</div></div>';
  }
})();
