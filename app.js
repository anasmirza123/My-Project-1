'use strict';
/* =========================================================================
   Garment Management System - browser app (no libraries, no build step)
   ========================================================================= */

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmtDate = s => s ? parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const longDay = s => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const weekday = s => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short' });
const money = n => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const digitsOf = s => String(s || '').replace(/\D/g, '');
const waNum = p => { let d = digitsOf(p); if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '92' + d.slice(1); else if (d.length === 10 && d.startsWith('3')) d = '92' + d; return d; };
const waLink = (p, text) => 'https://wa.me/' + waNum(p) + (text ? '?text=' + encodeURIComponent(text) : '');
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : '')).replace(/[ \t]{2,}/g, ' ').trim();
const empty = msg => `<div class="empty">${msg}</div>`;

const TYPES = { unclassified: 'New', wholesale: 'Wholesale', reseller: 'Reseller', retail: 'Retail', lead: 'Lead', no_response: 'No response', other: 'Other' };
const PICK = ['wholesale', 'reseller', 'retail', 'lead', 'no_response', 'other'];
const WANTS = ['wholesale', 'reseller', 'retail', 'lead', 'other'];
const STATUS = { placed: 'Placed', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const OUTCOME = { open: 'Still talking', ordered: 'Ordered', no_order: 'Did not order', no_response: 'No response' };
const MOVE = { opening: 'Opening stock', in: 'Stock received', out: 'Stock removed', count: 'Count correction', sale: 'Sold (order)', return: 'Returned (order change)' };
const PAY = { paid: 'Paid', part: 'Part paid', unpaid: 'Unpaid', free: 'No amount', void: 'Cancelled' };
const typeBadge = t => `<span class="badge t-${t}">${TYPES[t] || esc(t)}</span>`;
const statusBadge = s => `<span class="badge s-${s}">${STATUS[s] || esc(s)}</span>`;

/* ---------- state + api ---------- */
let S = { customers: [], categories: [], products: [], interactions: [], orders: [], lostReasons: [], settings: {} };
const ui = { view: 'dashboard', date: today(), chatSeg: 'all', custType: 'all', custCat: '', custQ: '', ordStatus: '', ordPay: '', ordFrom: '', ordTo: '', ordQ: '', prodCat: '', prodTab: 'items', stockFrom: today(), stockTo: today() };
const cust = id => S.customers.find(c => c.id === id);
const prod = id => S.products.find(p => p.id === id);
const catName = id => (S.categories.find(c => c.id === id) || {}).name || '';
const live = o => o.status !== 'cancelled';
const dueOf = o => live(o) ? Math.max(0, (o.total || 0) - (o.paid || 0)) : 0;
const payState = o => !live(o) ? 'void' : !(o.total > 0) ? 'free' : o.paid >= o.total ? 'paid' : o.paid > 0 ? 'part' : 'unpaid';
const payBadge = o => `<span class="badge p-${payState(o)}">${PAY[payState(o)]}</span>`;
const byNewest = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');
const ordersOf = id => S.orders.filter(o => o.customerId === id).sort(byNewest);
const chatsOf = id => S.interactions.filter(i => i.customerId === id).sort(byNewest);
const spentBy = id => ordersOf(id).filter(live).reduce((s, o) => s + o.total, 0);
const itemsText = o => o.items.map(i => i.name + (i.size ? ' (' + i.size + ')' : '') + ' x' + i.qty).join(', ');
const dueFollowUps = () => S.interactions.filter(i => i.followUpDate && !i.followUpDone && i.followUpDate <= today());
const lowStock = () => S.products.filter(p => p.stock <= 0 || (p.lowStockAt > 0 && p.stock <= p.lowStockAt));
const hasOrderOn = (cid, date) => S.orders.some(o => o.customerId === cid && o.date === date && live(o));
const outcomeOf = i => hasOrderOn(i.customerId, i.date) ? 'ordered' : i.outcome;
function segOf(i) {
  const c = cust(i.customerId), t = c ? c.type : 'unclassified', oc = outcomeOf(i);
  if (t === 'wholesale') return 'wholesale';
  if (t === 'reseller') return 'reseller';
  if (oc === 'ordered' || oc === 'no_order') return 'active';
  if (t === 'no_response' || oc === 'no_response') return 'no_response';
  if (t === 'unclassified') return 'unclassified';
  return 'active';
}
function wantsText(c) {
  const parts = [];
  if (c.categoryId && catName(c.categoryId)) parts.push(esc(catName(c.categoryId)));
  const names = (c.productIds || []).map(id => prod(id)).filter(Boolean).map(p => esc(p.name));
  if (names.length) parts.push(names.join(', '));
  return parts.length ? parts.join(' · ') : '<span class="muted">—</span>';
}

async function api(path, method = 'GET', body) {
  let res;
  try { res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (_) { throw new Error('Cannot reach the server. Is "node server.js" still running?'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function load() { S = await api('/api/state'); }
async function safe(fn) { try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong', 'err'); } }

/* ---------- dialogs, toasts ---------- */
const drawer = $('#drawer'), dlg = $('#dlg');
function toast(msg, kind) {
  const host = dlg.open ? dlg : drawer.open ? drawer : document.body;
  let box = $(':scope > .toasts', host);
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; host.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'err' ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.remove(); if (!box.children.length) box.remove(); }, kind === 'err' ? 5000 : 2400);
}
const dHead = t => `<div class="dlg-head"><h2>${t}</h2><button class="x" type="button" data-act="closeDlg" aria-label="Close">×</button></div>`;
function openDlg(html, cls = '') { dlg.className = 'dlg ' + cls; dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); const f = $('input:not([type=hidden]), select, textarea', dlg); if (f) f.focus(); }
const closeDlg = () => { if (dlg.open) dlg.close(); };
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); });
drawer.addEventListener('click', e => { if (e.target === drawer) closeDrawer(); });
dlg.addEventListener('close', () => { document.body.classList.toggle('lock', drawer.open); });
drawer.addEventListener('close', () => { D = null; document.body.classList.remove('lock'); safe(sync); });

/* ---------- events ---------- */
const A = {}, C = {}, I = {}, F = {};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && A[el.dataset.act]) { e.preventDefault(); safe(() => A[el.dataset.act](el, e)); } });
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && C[el.dataset.change]) safe(() => C[el.dataset.change](el, e)); });
document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (el && I[el.dataset.input]) I[el.dataset.input](el, e); });
document.addEventListener('submit', e => { const f = e.target.closest('[data-submit]'); if (f && F[f.dataset.submit]) { e.preventDefault(); safe(() => F[f.dataset.submit](f, e)); } });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !dlg.open && !drawer.open) { e.preventDefault(); $('#quickPhone').focus(); }
});
A.closeDlg = closeDlg;
A.closeDrawer = () => closeDrawer();
A.copy = async el => {
  try { await navigator.clipboard.writeText(el.dataset.text); }
  catch (_) { const t = document.createElement('textarea'); t.value = el.dataset.text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Copied');
};
function downloadCSV(name, rows) {
  const csv = rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- views + routing ---------- */
const VIEWS = {
  dashboard: ['Dashboard', () => viewDashboard()],
  chats: ['Chats', () => viewChats()],
  customers: ['Customers', () => viewCustomers()],
  orders: ['Orders', () => viewOrders()],
  products: ['Products and stock', () => viewProducts()],
  followups: ['Follow-ups', () => viewFollowups()],
  settings: ['Settings and backup', () => viewSettings()]
};
let rtok = 0;
function updateNav() {
  const t = today();
  $('#nChats').textContent = S.interactions.filter(i => i.date === t).length || '';
  $('#nOrders').textContent = S.orders.filter(o => ['placed', 'packed', 'dispatched'].includes(o.status)).length || '';
  $('#nLow').textContent = lowStock().length || '';
  $('#nFollow').textContent = dueFollowUps().length || '';
  $('#brandName').textContent = S.settings.businessName || 'Garment MS';
}
async function renderView() {
  const my = ++rtok, [title, fn] = VIEWS[ui.view];
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === ui.view));
  $('#title').textContent = title;
  updateNav();
  let html;
  try { html = await fn(); } catch (e) { html = `<div class="panel">${empty(esc(e.message))}</div>`; }
  if (my === rtok) $('#view').innerHTML = html;
}
async function sync() { await load(); await renderView(); }
function route() { const v = location.hash.replace('#/', ''); ui.view = VIEWS[v] ? v : 'dashboard'; safe(renderView); }
function go(view) { if (location.hash === '#/' + view) safe(renderView); else location.hash = '#/' + view; }
window.addEventListener('hashchange', route);

/* date navigation shared by dashboard + chats */
const dateBar = () => `<div class="row"><button class="btn" data-act="datePrev" aria-label="Previous day">‹</button>
  <input type="date" value="${ui.date}" data-change="dateSet"><button class="btn" data-act="dateNext" aria-label="Next day">›</button>
  ${ui.date === today() ? '' : '<button class="btn" data-act="dateToday">Back to today</button>'}</div>`;
A.datePrev = () => { ui.date = addDays(ui.date, -1); safe(renderView); };
A.dateNext = () => { ui.date = addDays(ui.date, 1); safe(renderView); };
A.dateToday = () => { ui.date = today(); safe(renderView); };
C.dateSet = el => { if (el.value) { ui.date = el.value; safe(renderView); } };

/* =========================================================================
   QUICK CAPTURE  (type a number, press Enter)
   ========================================================================= */
$('#quick').addEventListener('submit', e => {
  e.preventDefault();
  safe(async () => {
    const inp = $('#quickPhone'), type = $('#quickType').value;
    if (!inp.value.trim()) return;
    const r = await api('/api/intake', 'POST', { phone: inp.value, date: today() });
    inp.value = '';
    let c = r.customer;
    if (type && c.type === 'unclassified') c = (await api('/api/customers/' + c.id, 'PUT', { type })).customer;
    await sync();
    if (type) { toast((r.existed ? 'Already saved: ' : 'Saved: ') + c.phone + ' as ' + TYPES[c.type].toLowerCase()); inp.focus(); return; }
    const note = !r.existed ? 'New number saved and added to today’s chats. Choose the customer type below.'
      : r.chatCreated ? 'Already in your records. A new chat for today has been logged.' : 'Already in your records, and today’s chat is already logged.';
    openCustomer(c.id, { note, warn: r.existed });
  });
});
A.bulk = () => openDlg(`${dHead('Paste many numbers')}<div class="dlg-body"><form data-submit="bulk">
  <p class="muted small" style="margin-top:0">One number per line (or separated by commas). Each number is saved and logged as a chat for today. Numbers already in your records are not duplicated.</p>
  <div class="field"><span>Numbers</span><textarea id="bulkText" rows="9" placeholder="0300 1234567&#10;0345 7654321&#10;+92 321 1112223"></textarea></div>
  <div class="field"><span>File all of them as</span><select id="bulkType"><option value="">Not sorted yet</option>${PICK.map(t => `<option value="${t}">${TYPES[t]}</option>`).join('')}</select></div>
  <div class="row"><button class="btn primary">Save numbers</button><button type="button" class="btn" data-act="closeDlg">Cancel</button></div></form></div>`);
F.bulk = async () => {
  const type = $('#bulkType').value;
  const list = $('#bulkText').value.split(/[\n,;]+/).map(s => s.trim()).filter(s => digitsOf(s).length >= 7);
  if (!list.length) throw new Error('Paste at least one valid phone number.');
  let added = 0, existed = 0;
  for (const raw of list) {
    const r = await api('/api/intake', 'POST', { phone: raw, date: today() });
    if (r.existed) existed++; else added++;
    if (type && r.customer.type === 'unclassified') await api('/api/customers/' + r.customer.id, 'PUT', { type });
  }
  closeDlg(); await sync();
  toast(added + ' new number' + (added === 1 ? '' : 's') + ' saved' + (existed ? ', ' + existed + ' already existed' : ''));
};

/* =========================================================================
   CUSTOMER SHEET (side drawer)
   ========================================================================= */
let D = null; // { id, tab, note, warn, order: null | { id } }
function openCustomer(id, o = {}) {
  D = Object.assign({ id, tab: 'profile', note: '', warn: false, order: null }, o);
  paintDrawer();
  if (!drawer.open) { drawer.showModal(); document.body.classList.add('lock'); }
}
function closeDrawer() { if (drawer.open) drawer.close(); }
function paintDrawer() {
  if (!D) return;
  const c = cust(D.id);
  if (!c) { closeDrawer(); return; }
  drawer.innerHTML = D.order ? orderFormHTML(c) : drawerHTML(c);
  if (D.order) calcOrder();
}
async function commit() { await sync(); paintDrawer(); }
A.openCust = el => openCustomer(el.dataset.id);

function drawerHTML(c) {
  const ords = ordersOf(c.id), chats = chatsOf(c.id);
  const tabs = [['profile', 'Profile'], ['chat', 'Today’s chat'], ['orders', 'Orders (' + ords.length + ')'], ['history', 'History (' + chats.length + ')']];
  const body = { profile: profileTab, chat: chatTab, orders: ordersTab, history: historyTab }[D.tab](c);
  return `<div class="dr-head"><div><div class="dr-title"><span class="mono">${esc(c.phone)}</span>${typeBadge(c.type)}</div>
      <div class="muted small" style="margin-top:3px">${esc(c.name || 'No name saved')} · ${ords.length} order${ords.length === 1 ? '' : 's'} · ${money(spentBy(c.id))} spent</div></div>
    <div class="row"><a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(c.phone)}">WhatsApp</a>
      <button class="btn sm" data-act="copy" data-text="${esc(c.phone)}">Copy</button><button class="x" data-act="closeDrawer" aria-label="Close">×</button></div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${D.tab === k ? 'on' : ''}" data-act="dTab" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="dr-body">${D.note ? `<div class="note ${D.warn ? 'warn' : ''}">${esc(D.note)}</div>` : ''}${body}</div>`;
}
A.dTab = el => { D.tab = el.dataset.v; paintDrawer(); };

function profileTab(c) {
  const wants = WANTS.includes(c.type);
  const prods = S.products.filter(p => !c.categoryId || p.categoryId === c.categoryId || c.productIds.includes(p.id));
  const f = (key, label, val, full, ph) => `<label class="field ${full ? 'full' : ''}"><span>${label}</span><input value="${esc(val)}" data-change="field" data-f="${key}" ${ph ? `placeholder="${ph}"` : ''}></label>`;
  return `<section class="blk"><h3>${c.type === 'unclassified' ? 'Who is this customer?' : 'Customer type'}</h3>
      <div class="typegrid">${PICK.map(t => `<button class="tbtn ${c.type === t ? 'on' : ''}" data-act="setType" data-v="${t}">${TYPES[t]}</button>`).join('')}</div></section>
    ${wants ? `<section class="blk"><h3>Category <span>for example Jackton or Shilwar</span></h3>
      <div class="chips">${S.categories.map(x => `<button class="chip ${c.categoryId === x.id ? 'on' : ''}" data-act="setCat" data-v="${x.id}">${esc(x.name)}</button>`).join('')}${c.categoryId ? '<button class="chip ghost" data-act="setCat" data-v="">Clear</button>' : ''}${S.categories.length ? '' : '<span class="muted small">No categories yet.</span>'}</div>
      <form data-submit="addCatInline"><input id="newCat" placeholder="New category name"><button class="btn sm">Add category</button></form></section>
    <section class="blk"><h3>Product they want <span>${c.categoryId ? 'showing ' + esc(catName(c.categoryId)) : 'all products'}</span></h3>
      ${prods.length ? `<div class="chips">${prods.map(p => `<button class="chip ${c.productIds.includes(p.id) ? 'on' : ''}" data-act="toggleProd" data-v="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : `<p class="muted small" style="margin:0">${c.categoryId ? 'No products in this category yet.' : 'No products yet.'} Add one below.</p>`}
      <form data-submit="addProdInline"><input id="newProd" placeholder="New product name${c.categoryId ? ' (goes into ' + esc(catName(c.categoryId)) + ')' : ''}"><button class="btn sm">Add product</button></form></section>` : ''}
    <section class="blk"><h3>Details <span>all optional, saved as you type</span></h3>
      <div class="grid2f">${f('name', 'Name', c.name)}${f('phone', 'Phone number', c.phone)}${f('altContact', 'Other contact', c.altContact)}${f('address', 'Address', c.address)}
      <label class="field full"><span>Business and requirements</span><textarea rows="3" data-change="field" data-f="notes" placeholder="For example: runs a shop in Faisalabad, wants 200 pieces a month">${esc(c.notes)}</textarea></label></div></section>
    <section class="blk"><button class="btn danger sm" data-act="delCust">Delete this customer</button></section>`;
}
async function patchCust(patch) { const r = await api('/api/customers/' + D.id, 'PUT', patch); await commit(); return r; }
A.setType = el => patchCust({ type: el.dataset.v }).then(() => toast('Filed as ' + TYPES[el.dataset.v].toLowerCase()));
A.setCat = el => patchCust({ categoryId: el.dataset.v || null });
A.toggleProd = el => { const c = cust(D.id), s = new Set(c.productIds); s.has(el.dataset.v) ? s.delete(el.dataset.v) : s.add(el.dataset.v); return patchCust({ productIds: [...s] }); };
F.addCatInline = async () => {
  const name = $('#newCat').value.trim(); if (!name) return;
  const r = await api('/api/categories', 'POST', { name });
  await patchCust({ categoryId: r.category.id });
};
F.addProdInline = async () => {
  const name = $('#newProd').value.trim(); if (!name) return;
  const c = cust(D.id);
  const r = await api('/api/products', 'POST', { name, categoryId: c.categoryId || '' });
  await patchCust({ productIds: [...c.productIds, r.product.id] });
};
C.field = async el => {
  const r = await api('/api/customers/' + D.id, 'PUT', { [el.dataset.f]: el.value });
  const i = S.customers.findIndex(x => x.id === D.id); if (i >= 0) S.customers[i] = r.customer;
  el.value = r.customer[el.dataset.f] || '';
  const tmp = document.createElement('div'); tmp.innerHTML = drawerHTML(r.customer);
  const nh = $('.dr-head', tmp), oh = $('.dr-head', drawer); if (nh && oh) oh.replaceWith(nh);
  toast('Saved');
};
A.delCust = async () => {
  const c = cust(D.id);
  if (!confirm('Delete ' + c.phone + ' with all their chats and orders? Stock from their orders goes back. This cannot be undone.')) return;
  await api('/api/customers/' + c.id, 'DELETE');
  closeDrawer(); toast('Customer deleted');
};

/* today's chat editor */
function chatTab(c) {
  const t = today(), it = S.interactions.find(i => i.customerId === c.id && i.date === t);
  const ordered = hasOrderOn(c.id, t), oc = ordered ? 'ordered' : (it ? it.outcome : 'open');
  const reminder = fill(S.settings.reminderTemplate, { name: c.name || 'Sir/Madam', business: S.settings.businessName, note: it && it.followUpNote ? it.followUpNote + ' ' : '' });
  return `<div id="chatForm" data-outcome="${oc}" data-reason="${esc(it ? it.lostReason : '')}">
    ${ordered ? '<div class="note">An order was placed today, so today’s chat counts as ordered.</div>' : `<section class="blk"><h3>How did today’s chat go?</h3>
      <div class="chips big" id="outChips">${['open', 'no_order', 'no_response'].map(k => `<button class="chip ${oc === k ? 'on' : ''}" data-act="setOutcome" data-v="${k}">${OUTCOME[k]}</button>`).join('')}</div>
      <div id="reasonBox" style="margin-top:12px" ${oc === 'no_order' ? '' : 'hidden'}><h3 style="font-size:13.5px;margin-bottom:6px">Why no order?</h3>
        <div class="chips" id="reasonChips">${S.lostReasons.map(r => `<button class="chip ${it && it.lostReason === r ? 'on' : ''}" data-act="setReason" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div></div></section>`}
    <section class="blk"><h3>What did they ask for?</h3><textarea id="chNotes" rows="3" data-change="chatSave" placeholder="For example: 50 Jackton in black, size L">${esc(it ? it.notes : '')}</textarea></section>
    <section class="blk"><h3>Follow up later</h3>
      <div class="grid2f"><label class="field"><span>Follow-up date</span><input type="date" id="fuDate" value="${it ? it.followUpDate : ''}" data-change="chatSave"></label>
      <label class="field"><span>Reminder note</span><input id="fuNote" value="${esc(it ? it.followUpNote : '')}" data-change="chatSave" placeholder="For example: new stock arrives Friday"></label></div>
      <div class="chips"><button class="chip" data-act="fuQuick" data-v="1">Tomorrow</button><button class="chip" data-act="fuQuick" data-v="3">In 3 days</button><button class="chip" data-act="fuQuick" data-v="7">In a week</button><button class="chip ghost" data-act="fuQuick" data-v="0">No follow-up</button></div>
      <div style="margin-top:12px"><a class="btn wa" target="_blank" rel="noopener" href="${waLink(c.phone, reminder)}">Send reminder on WhatsApp</a></div></section></div>`;
}
async function saveChat(over = {}) {
  const f = $('#chatForm'), c = cust(D.id), t = today();
  const body = { customerId: c.id, date: t, notes: $('#chNotes').value, followUpDate: $('#fuDate').value, followUpNote: $('#fuNote').value, lostReason: over.lostReason !== undefined ? over.lostReason : f.dataset.reason };
  if (!hasOrderOn(c.id, t)) body.outcome = over.outcome || f.dataset.outcome;
  const r = await api('/api/interactions', 'POST', body);
  const i = S.interactions.findIndex(x => x.id === r.interaction.id);
  if (i >= 0) S.interactions[i] = r.interaction; else S.interactions.push(r.interaction);
  toast('Saved');
}
C.chatSave = () => saveChat();
const markOn = (box, el) => $$('.chip', box).forEach(b => b.classList.toggle('on', b === el));
A.setOutcome = async el => {
  const f = $('#chatForm'); f.dataset.outcome = el.dataset.v;
  if (el.dataset.v !== 'no_order') f.dataset.reason = '';
  markOn($('#outChips'), el); $('#reasonBox').hidden = el.dataset.v !== 'no_order';
  if (el.dataset.v !== 'no_order') markOn($('#reasonChips'), null);
  await saveChat({ outcome: el.dataset.v, lostReason: el.dataset.v === 'no_order' ? f.dataset.reason : '' });
};
A.setReason = async el => { $('#chatForm').dataset.reason = el.dataset.v; markOn($('#reasonChips'), el); await saveChat({ outcome: 'no_order', lostReason: el.dataset.v }); };
A.fuQuick = async el => { const n = Number(el.dataset.v); $('#fuDate').value = n ? addDays(today(), n) : ''; if (!n) $('#fuNote').value = ''; await saveChat(); };

function ordersTab(c) {
  const ords = ordersOf(c.id);
  return `<div class="row" style="margin-bottom:12px"><div class="grow muted">${ords.length} order${ords.length === 1 ? '' : 's'} · ${money(spentBy(c.id))} total</div><button class="btn tape" data-act="newOrder" data-id="${c.id}">+ New order</button></div>
    ${ords.length ? ords.map(o => `<div class="card click" data-act="editOrder" data-id="${o.id}"><div class="row"><b class="mono grow">${esc(o.orderNo)}</b>${payBadge(o)}${statusBadge(o.status)}</div>
      <div class="meta">${fmtDate(o.date)} · ${money(o.total)}${dueOf(o) ? ' · due ' + money(dueOf(o)) : ''}</div><div class="meta">${esc(itemsText(o))}</div>
      ${o.trackingId ? `<div class="meta">Tracking <span class="mono">${esc(o.trackingId)}</span> ${esc(o.courier)}</div>` : ''}</div>`).join('') : empty('No orders yet for this customer.')}`;
}
function historyTab(c) {
  const chats = chatsOf(c.id);
  return chats.length ? chats.map(i => `<div class="card"><div class="row"><b class="grow">${fmtDate(i.date)}</b><span class="badge ${outcomeOf(i) === 'ordered' ? 's-delivered' : outcomeOf(i) === 'open' ? 's-placed' : 's-cancelled'}">${OUTCOME[outcomeOf(i)]}</span>
      <button class="btn sm danger" data-act="delChat" data-id="${i.id}">Delete</button></div>
    <div class="meta">${i.lostReason ? 'Reason: ' + esc(i.lostReason) : ''}${i.lostReason && i.notes ? ' · ' : ''}${esc(i.notes)}</div>
    ${i.followUpDate ? `<div class="meta">Follow-up ${fmtDate(i.followUpDate)}${i.followUpDone ? ' (done)' : ''}${i.followUpNote ? ': ' + esc(i.followUpNote) : ''}</div>` : ''}</div>`).join('') : empty('No chats logged yet.');
}
A.delChat = async el => { if (!confirm('Delete this chat record?')) return; await api('/api/interactions/' + el.dataset.id, 'DELETE'); await commit(); };

/* =========================================================================
   DASHBOARD
   ========================================================================= */
async function viewDashboard() {
  const d = await api('/api/dashboard?date=' + ui.date);
  const sg = d.segments, a = sg.active, isToday = ui.date === today(), prev = isToday ? 'yesterday' : 'the day before', total = d.chats;
  const delta = (n, y, f = x => x) => { const k = n - y; return k === 0 ? `<span class="vs">same as ${prev}</span>` : `<span class="vs ${k > 0 ? 'up' : 'down'}">${k > 0 ? '▲' : '▼'} ${f(Math.abs(k))} vs ${prev}</span>`; };
  const pct = (n, t) => t ? Math.round(n / t * 100) : 0;
  const parts = [['wholesale', 'Wholesale', sg.wholesale.chats, `${sg.wholesale.ordered} ordered`], ['reseller', 'Resellers', sg.reseller.chats, `${sg.reseller.ordered} ordered`],
    ['active', 'Active leads', a.chats, `${a.ordered} ordered`], ['no_response', 'No response', sg.no_response.chats, 'never replied'], ['unclassified', 'Not sorted yet', sg.unclassified.chats, 'need a type']];
  const step = total <= 20 ? 1 : total <= 60 ? 5 : total <= 200 ? 10 : 50;
  const lostMax = Math.max(1, ...d.lostReasons.map(r => r.count)), maxT = Math.max(1, ...d.trend.map(t => t.chats));
  const buyers = new Set(S.orders.filter(live).map(o => o.customerId)).size, cnt = t => S.customers.filter(c => c.type === t).length;
  const unsorted = cnt('unclassified'), openChats = S.interactions.filter(i => i.date === ui.date && outcomeOf(i) === 'open').length;
  const due = dueFollowUps().length, toShip = S.orders.filter(o => ['placed', 'packed'].includes(o.status)).length;
  const owing = S.orders.filter(o => dueOf(o) > 0), owed = owing.reduce((s, o) => s + dueOf(o), 0), low = lowStock().length;
  const attn = (label, n, sub, act, arg) => `<button class="attn ${n ? '' : 'clear'}" data-act="${act}" data-arg="${arg || ''}"><span class="lbl">${label}<small>${sub}</small></span><span class="num">${n}</span></button>`;
  return `<div class="head"><div><h2>${isToday ? 'Today' : longDay(ui.date)}</h2><div class="sub">${isToday ? longDay(ui.date) : 'Past day'}</div></div>${dateBar()}</div>
  <div class="strip">
    <button data-act="goCust" data-arg="all"><b>${S.customers.length}</b><span>customers</span></button><button data-act="goCust" data-arg="wholesale"><b>${cnt('wholesale')}</b><span>wholesale</span></button>
    <button data-act="goCust" data-arg="reseller"><b>${cnt('reseller')}</b><span>resellers</span></button><button data-act="goCust" data-arg="retail"><b>${cnt('retail')}</b><span>retail</span></button>
    <button data-act="goCust" data-arg="lead"><b>${cnt('lead')}</b><span>leads</span></button><button data-act="goCust" data-arg="no_response"><b>${cnt('no_response')}</b><span>no response</span></button>
    <button data-act="goCust" data-arg="buyers"><b>${buyers}</b><span>bought before</span></button></div>
  <div class="kpis">
    <div class="kpi hero"><span>Chats received</span><b>${d.chats}</b>${delta(d.chats, d.yesterday.chats)}</div>
    <div class="kpi"><span>Orders</span><b>${d.orders}</b>${delta(d.orders, d.yesterday.orders)}</div>
    <div class="kpi"><span>Order value</span><b>${money(d.revenue)}</b>${delta(d.revenue, d.yesterday.revenue, money)}</div>
    <div class="kpi"><span>Active lead conversion</span><b>${d.activeConversion}%</b><span class="vs">${a.ordered} of ${a.chats} active leads ordered</span></div></div>
  <div class="cols"><div>
    <div class="panel"><h3>Where today’s ${total} chats came from</h3><div class="sub">Wholesalers and resellers are counted on their own. The rest are no-response or active leads.</div>
      ${total ? `<div class="measure">${parts.filter(p => p[2]).map(p => `<span class="sg sg-${p[0]}" style="flex:${p[2]}" title="${p[1]}: ${p[2]}">${p[2]}</span>`).join('')}</div>
      <div class="ruler" style="background-size:${step / total * 100}% 100%"></div><div class="ends"><span>0</span><span>${total} chats</span></div>
      <div class="legend">${parts.map(p => `<div class="lg ${p[0]}"><b>${p[2]}</b><span>${p[1]} · ${p[3]}</span></div>`).join('')}</div>` : empty('No chats logged for this day. Type a number in the box at the top to log the first one.')}</div>
    <div class="panel"><h3>What happened with the ${a.chats} active leads</h3><div class="sub">Orders placed, and chats that ended without an order.</div>
      ${a.chats ? `<div class="flow">${a.ordered ? `<i class="a" style="flex:${a.ordered}">${a.ordered}</i>` : ''}${a.no_order ? `<i class="b" style="flex:${a.no_order}">${a.no_order}</i>` : ''}${a.open ? `<i class="c" style="flex:${a.open}">${a.open}</i>` : ''}</div>
      <div class="key"><span><i style="background:var(--ok)"></i>Ordered ${a.ordered}</span><span><i style="background:var(--bad)"></i>No order ${a.no_order}</span><span><i style="background:#c68a1d"></i>Still open ${a.open}</span></div>` : ''}
      <h4 style="margin:18px 0 4px;font-size:14px">Why they did not order</h4>
      <div class="reasons">${d.lostReasons.length ? d.lostReasons.map(r => `<div class="br"><span>${esc(r.reason)}</span><div class="track"><i style="width:${pct(r.count, lostMax)}%"></i></div><b class="r">${r.count}</b></div>`).join('') : empty('No reasons recorded for this day. Mark a chat as “Did not order” and pick a reason.')}</div></div>
  </div><div>
    <div class="panel"><h3>Needs your attention</h3><div style="margin-top:8px">
      ${attn('Numbers not sorted yet', unsorted, 'Pick wholesale, reseller or lead', 'goCust', 'unclassified')}
      ${attn('Chats with no result yet', openChats, ui.date === today() ? 'Today’s chats still open' : 'Open on this day', 'goChats', 'open')}
      ${attn('Follow-ups due', due, 'Send the reminder or mark done', 'goView', 'followups')}
      ${attn('Orders waiting to ship', toShip, 'Placed or packed', 'goOrders', 'toship')}
      ${attn('Money to collect', owing.length, owing.length ? money(owed) + ' still unpaid' : 'Nothing unpaid', 'goOrders', 'due')}
      ${attn('Low or empty stock', low, 'Products to restock', 'goView', 'products')}</div></div>
    <div class="panel"><h3>Last 7 days</h3><div class="trend">${d.trend.map(t => `<div class="d ${t.date === ui.date ? 'sel' : ''}"><div class="pair"><span class="b" style="height:${Math.round(t.chats / maxT * 100)}%"><i>${t.chats}</i></span><span class="b o" style="height:${Math.round(t.orders / maxT * 100)}%"><i>${t.orders}</i></span></div><div class="l">${weekday(t.date)}</div></div>`).join('')}</div>
      <div class="key"><span><i></i>Chats</span><span><i class="o"></i>Orders</span></div></div>
  </div></div>`;
}
A.goView = el => go(el.dataset.arg);
A.goCust = el => { ui.custType = el.dataset.arg; ui.custCat = ''; ui.custQ = ''; go('customers'); };
A.goChats = el => { ui.chatSeg = el.dataset.arg; go('chats'); };
A.goOrders = el => { ui.ordStatus = ''; ui.ordPay = ''; ui.ordFrom = ui.ordTo = ui.ordQ = ''; if (el.dataset.arg === 'due') ui.ordPay = 'due'; else ui.ordStatus = el.dataset.arg; go('orders'); };

/* =========================================================================
   CHATS  (the daily worklist: sort 150 chats quickly)
   ========================================================================= */
function chatsOn(date) { return S.interactions.filter(i => i.date === date).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
function chatBodyHTML() {
  const rows = chatsOn(ui.date);
  const segs = [['all', 'All'], ['unclassified', 'Not sorted'], ['wholesale', 'Wholesale'], ['reseller', 'Resellers'], ['active', 'Active leads'], ['no_response', 'No response'], ['open', 'No result yet']];
  const match = (i, k) => k === 'all' || (k === 'open' ? outcomeOf(i) === 'open' : segOf(i) === k);
  const list = rows.filter(i => match(i, ui.chatSeg));
  const row = i => {
    const c = cust(i.customerId); if (!c) return '';
    const oc = outcomeOf(i);
    return `<tr><td><button class="lnk" data-act="openCust" data-id="${c.id}"><b class="mono">${esc(c.phone)}</b></button><div class="muted small">${esc(c.name)}</div></td>
      <td><select class="mini" data-change="rowType" data-id="${c.id}">${c.type === 'unclassified' ? '<option value="unclassified" selected>Choose type…</option>' : ''}${PICK.map(t => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${TYPES[t]}</option>`).join('')}</select></td>
      <td>${wantsText(c)}</td>
      <td>${oc === 'ordered' ? '<span class="badge s-delivered">Ordered</span>' : `<select class="mini" data-change="rowOutcome" data-id="${i.id}">${['open', 'no_order', 'no_response'].map(k => `<option value="${k}" ${oc === k ? 'selected' : ''}>${OUTCOME[k]}</option>`).join('')}</select>`}
        ${oc === 'no_order' ? `<select class="mini" data-change="rowReason" data-id="${i.id}"><option value="">Reason…</option>${S.lostReasons.map(r => `<option ${i.lostReason === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>` : ''}</td>
      <td class="r"><button class="btn sm" data-act="newOrder" data-id="${c.id}" data-open="1">+ Order</button> <a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(c.phone)}">WhatsApp</a></td></tr>`;
  };
  return `<div class="chips" style="margin-bottom:14px">${segs.map(([k, l]) => `<button class="chip ${ui.chatSeg === k ? 'on' : ''}" data-act="chatSeg" data-v="${k}">${l}<small>${rows.filter(i => match(i, k)).length}</small></button>`).join('')}</div>
    ${list.length ? `<div class="tw"><table><thead><tr><th>Customer</th><th>Type</th><th>Category and products</th><th>Result of the chat</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`
      : empty(rows.length ? 'No chats in this group.' : 'No chats logged for this day yet. Type a number in the box at the top, or use “Paste many”.')}`;
}
function viewChats() {
  return `<div class="head"><div><h2>${ui.date === today() ? 'Today’s chats' : 'Chats on ' + fmtDate(ui.date)}</h2><div class="sub">Sort each chat into a type and a result. Everything saves as you pick.</div></div>
    ${dateBar()}</div>
    <div class="panel" id="chatBody">${chatBodyHTML()}</div>`;
}
const paintChats = () => { const b = $('#chatBody'); if (b) b.innerHTML = chatBodyHTML(); updateNav(); };
async function quick(fn) { await fn(); await load(); paintChats(); }
A.chatSeg = el => { ui.chatSeg = el.dataset.v; paintChats(); };
C.rowType = el => quick(() => api('/api/customers/' + el.dataset.id, 'PUT', { type: el.value }));
C.rowOutcome = el => { const i = S.interactions.find(x => x.id === el.dataset.id); return quick(() => api('/api/interactions', 'POST', { customerId: i.customerId, date: i.date, outcome: el.value, lostReason: '' })); };
C.rowReason = el => { const i = S.interactions.find(x => x.id === el.dataset.id); return quick(() => api('/api/interactions', 'POST', { customerId: i.customerId, date: i.date, outcome: 'no_order', lostReason: el.value })); };

/* =========================================================================
   CUSTOMERS
   ========================================================================= */
function filteredCustomers() {
  const q = ui.custQ.trim().toLowerCase(), qd = digitsOf(q);
  return S.customers.filter(c => {
    if (ui.custType === 'buyers') { if (!ordersOf(c.id).some(live)) return false; }
    else if (ui.custType !== 'all' && c.type !== ui.custType) return false;
    if (ui.custCat === '_none' ? c.categoryId : (ui.custCat && c.categoryId !== ui.custCat)) return false;
    if (q) {
      const hay = [c.name, c.phone, c.address, c.notes, c.altContact].join(' ').toLowerCase();
      if (!hay.includes(q) && !(qd && digitsOf(c.phone).includes(qd))) return false;
    }
    return true;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function custBodyHTML() {
  const types = [['all', 'All'], ['wholesale', 'Wholesale'], ['reseller', 'Resellers'], ['retail', 'Retail'], ['lead', 'Leads'], ['no_response', 'No response'], ['other', 'Other'], ['unclassified', 'Not sorted'], ['buyers', 'Bought before']];
  const count = k => k === 'buyers' ? S.customers.filter(c => ordersOf(c.id).some(live)).length : k === 'all' ? S.customers.length : S.customers.filter(c => c.type === k).length;
  const showCats = WANTS.includes(ui.custType) && S.categories.length;
  const inType = c => c.type === ui.custType;
  const list = filteredCustomers();
  const lastChat = id => (chatsOf(id)[0] || {}).date;
  return `<div class="chips">${types.map(([k, l]) => `<button class="chip ${ui.custType === k ? 'on' : ''}" data-act="custType" data-v="${k}">${l}<small>${count(k)}</small></button>`).join('')}</div>
    ${showCats ? `<div class="chips" style="margin-top:10px"><button class="chip ${ui.custCat === '' ? 'on' : ''}" data-act="custCat" data-v="">All categories</button>${S.categories.map(x => `<button class="chip ${ui.custCat === x.id ? 'on' : ''}" data-act="custCat" data-v="${x.id}">${esc(x.name)}<small>${S.customers.filter(c => inType(c) && c.categoryId === x.id).length}</small></button>`).join('')}<button class="chip ${ui.custCat === '_none' ? 'on' : ''}" data-act="custCat" data-v="_none">No category</button></div>` : ''}
    <div class="tw" style="margin-top:14px">${list.length ? `<table><thead><tr><th>Customer</th><th>Type</th><th>Category and products</th><th class="r">Orders</th><th>Last chat</th></tr></thead><tbody>
      ${list.map(c => { const n = ordersOf(c.id).filter(live).length; return `<tr><td><button class="lnk" data-act="openCust" data-id="${c.id}"><b class="mono">${esc(c.phone)}</b></button><div class="muted small">${esc(c.name)}${c.address ? ' · ' + esc(c.address) : ''}</div></td>
        <td>${typeBadge(c.type)}</td><td>${wantsText(c)}</td><td class="r">${n ? n + '<div class="muted small">' + money(spentBy(c.id)) + '</div>' : '<span class="muted">0</span>'}</td><td>${fmtDate(lastChat(c.id))}</td></tr>`; }).join('')}</tbody></table>` : empty(S.customers.length ? 'No customers match these filters.' : 'No customers yet. Type a phone number in the box at the top to save the first one.')}</div>`;
}
function viewCustomers() {
  return `<div class="head"><div><h2>Customers</h2><div class="sub">Every number you have saved, with type, category and purchase history.</div></div>
    <div class="row"><input class="search" id="custQ" style="width:260px" placeholder="Search number, name, address" value="${esc(ui.custQ)}" data-input="custQ"><button class="btn" data-act="exportCust">Export CSV</button></div></div>
    <div class="panel" id="custBody">${custBodyHTML()}</div>`;
}
const paintCust = () => { const b = $('#custBody'); if (b) b.innerHTML = custBodyHTML(); };
I.custQ = el => { ui.custQ = el.value; paintCust(); };
A.custType = el => { ui.custType = el.dataset.v; ui.custCat = ''; paintCust(); };
A.custCat = el => { ui.custCat = el.dataset.v; paintCust(); };
A.exportCust = () => downloadCSV('customers-' + today() + '.csv', [['Phone', 'Name', 'Type', 'Category', 'Products', 'Other contact', 'Address', 'Notes', 'Orders', 'Total spent']]
  .concat(filteredCustomers().map(c => [c.phone, c.name, TYPES[c.type], catName(c.categoryId), (c.productIds || []).map(id => (prod(id) || {}).name).filter(Boolean).join('; '), c.altContact, c.address, c.notes, ordersOf(c.id).filter(live).length, spentBy(c.id)])));

/* =========================================================================
   ORDER FORM (inside the side sheet)
   ========================================================================= */
function openOrder(cid, oid) {
  if (D && D.id === cid) { D.order = { id: oid || null }; paintDrawer(); }
  else { D = { id: cid, tab: 'orders', note: '', warn: false, order: { id: oid || null }, solo: true }; paintDrawer(); if (!drawer.open) { drawer.showModal(); document.body.classList.add('lock'); } }
}
A.newOrder = el => openOrder(el.dataset.id, null);
A.editOrder = el => { const o = S.orders.find(x => x.id === el.dataset.id); if (o) openOrder(o.customerId, o.id); };
A.orderBack = async () => { if (D.solo) closeDrawer(); else { D.order = null; paintDrawer(); } };

function itemCard(it) {
  const groups = S.categories.map(c => [c.name, S.products.filter(p => p.categoryId === c.id)]).concat([['Other products', S.products.filter(p => !p.categoryId || !catName(p.categoryId))]]).filter(g => g[1].length);
  const opts = '<option value="">Custom item…</option>' + groups.map(([n, ps]) => `<optgroup label="${esc(n)}">${ps.map(p => `<option value="${p.id}" ${p.id === it.productId ? 'selected' : ''}>${esc(p.name)} · ${p.stock} in stock</option>`).join('')}</optgroup>`).join('');
  return `<div class="item"><div class="top"><select class="ip" data-change="itemProd" aria-label="Product">${opts}</select><button class="x" data-act="rmItem" aria-label="Remove item">×</button></div>
    <input class="in" placeholder="Item name" value="${esc(it.name || '')}">
    <div class="g"><label>Size or colour<input class="is" value="${esc(it.size || '')}"></label><label>Quantity<input class="iq" type="number" min="1" value="${it.qty || 1}" data-input="calc"></label>
      <label>Price each<input class="ipr" type="number" min="0" value="${it.price || ''}" data-input="calc"></label><div class="lt">Rs 0</div></div><div class="wn" hidden></div></div>`;
}
function orderFormHTML(c) {
  const o = D.order.id ? S.orders.find(x => x.id === D.order.id) : null;
  const items = o ? o.items : [{ qty: 1 }];
  const auto = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  const msg = o && o.trackingId ? fill(S.settings.trackingTemplate, { name: o.customerName || c.name || 'Sir/Madam', orderNo: o.orderNo, tracking: o.trackingId, courier: o.courier ? '(' + o.courier + ')' : '', business: S.settings.businessName }) : '';
  return `<div class="dr-head"><div><div class="dr-title">${o ? esc(o.orderNo) : 'New order'}${o ? statusBadge(o.status) : ''}</div><div class="muted small" style="margin-top:3px">${esc(c.name || c.phone)}${c.name ? ' · ' + esc(c.phone) : ''}</div></div><button class="x" data-act="orderBack" aria-label="Back">×</button></div>
  <div class="dr-body" id="orderForm">
    <section class="blk"><h3>Items</h3><div id="items">${items.map(itemCard).join('')}</div><button class="btn sm" data-act="addItem">+ Add another item</button></section>
    <div class="total">Items total <b id="oAuto">Rs 0</b></div>
    <section class="blk"><h3>Payment</h3><div class="grid2f">
      <label class="field"><span>Final total (leave empty to use the items total)</span><input id="oTotal" type="number" min="0" value="${o && o.total !== auto ? o.total : ''}" data-input="calc"></label>
      <label class="field"><span>Amount received</span><input id="oPaid" type="number" min="0" value="${o ? o.paid : ''}" data-input="calc"></label></div>
      <div class="row"><button class="btn sm" data-act="paidFull">Mark paid in full</button><span id="oBal" class="muted"></span></div></section>
    <section class="blk"><h3>Status and tracking</h3><div class="grid2f">
      <label class="field"><span>Status</span><select id="oStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${(o ? o.status : 'placed') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Order date</span><input type="date" id="oDate" value="${o ? o.date : today()}"></label>
      <label class="field"><span>Tracking ID</span><input id="oTrack" value="${esc(o ? o.trackingId : '')}"></label>
      <label class="field"><span>Courier</span><input id="oCourier" value="${esc(o ? o.courier : '')}" placeholder="For example TCS, Leopards"></label></div>
      ${msg ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(c.phone, msg)}">Send tracking on WhatsApp</a>` : ''}</section>
    <section class="blk"><h3>Delivery <span>filled from the customer record when empty</span></h3><div class="grid2f">
      <label class="field full"><span>Name</span><input id="oName" value="${esc(o ? o.customerName : c.name)}"></label>
      <label class="field full"><span>Address</span><input id="oAddr" value="${esc(o ? o.address : c.address)}"></label>
      <label class="field full"><span>Notes</span><input id="oNotes" value="${esc(o ? o.notes : '')}"></label></div></section></div>
  <div class="dr-foot"><button class="btn primary" data-act="saveOrder">Save order</button><button class="btn" data-act="orderBack">Cancel</button>${o ? '<span class="grow"></span><button class="btn danger" data-act="delOrder">Delete</button>' : ''}</div>`;
}
function orderSum() {
  let sum = 0;
  $$('#orderForm .item').forEach(card => { sum += Math.max(1, Number($('.iq', card).value) || 1) * (Number($('.ipr', card).value) || 0); });
  return sum;
}
function calcOrder() {
  const f = $('#orderForm'); if (!f) return;
  const o = D.order.id ? S.orders.find(x => x.id === D.order.id) : null;
  $$('.item', f).forEach(card => {
    const q = Math.max(1, Number($('.iq', card).value) || 1), pr = Number($('.ipr', card).value) || 0, p = prod($('.ip', card).value), wn = $('.wn', card);
    $('.lt', card).textContent = money(q * pr);
    if (p) {
      const back = o && o.stockApplied ? o.items.filter(i => i.productId === p.id).reduce((s, i) => s + i.qty, 0) : 0, avail = p.stock + back;
      wn.hidden = q <= avail; wn.textContent = avail <= 0 ? 'Out of stock. Saving will take stock below zero.' : 'Only ' + avail + ' in stock.';
    } else wn.hidden = true;
  });
  const sum = orderSum(), tot = $('#oTotal').value === '' ? sum : Number($('#oTotal').value) || 0, paid = Number($('#oPaid').value) || 0;
  $('#oAuto').textContent = money(sum);
  $('#oBal').textContent = tot - paid > 0 ? 'Balance to collect: ' + money(tot - paid) : (tot > 0 ? 'Fully paid' : '');
}
I.calc = calcOrder;
C.itemProd = el => { const card = el.closest('.item'), p = prod(el.value); if (p) { $('.in', card).value = p.name; if (p.price > 0) $('.ipr', card).value = p.price; } calcOrder(); };
A.addItem = () => { $('#items').insertAdjacentHTML('beforeend', itemCard({ qty: 1 })); calcOrder(); };
A.rmItem = el => { const cards = $$('#orderForm .item'); if (cards.length > 1) el.closest('.item').remove(); else { $$('input', cards[0]).forEach(i => i.value = ''); $('.iq', cards[0]).value = 1; $('.ip', cards[0]).value = ''; } calcOrder(); };
A.paidFull = () => { const t = $('#oTotal').value === '' ? orderSum() : Number($('#oTotal').value) || 0; $('#oPaid').value = t; calcOrder(); };
A.saveOrder = async () => {
  const items = $$('#orderForm .item').map(card => ({ productId: $('.ip', card).value || null, name: $('.in', card).value.trim(), size: $('.is', card).value.trim(), qty: Number($('.iq', card).value) || 1, price: Number($('.ipr', card).value) || 0 })).filter(i => i.name);
  if (!items.length) throw new Error('Add at least one item and give it a name.');
  const v = id => $('#' + id).value;
  const body = { items, date: v('oDate') || today(), status: v('oStatus'), total: v('oTotal'), paid: v('oPaid') === '' ? 0 : v('oPaid'), trackingId: v('oTrack'), courier: v('oCourier'), customerName: v('oName'), address: v('oAddr'), notes: v('oNotes') };
  if (D.order.id) await api('/api/orders/' + D.order.id, 'PUT', body);
  else await api('/api/orders', 'POST', Object.assign({ customerId: D.id }, body));
  toast('Order saved');
  if (D.solo) { closeDrawer(); return; }
  D.order = null; D.tab = 'orders'; await commit();
};
A.delOrder = async () => {
  const o = S.orders.find(x => x.id === D.order.id);
  if (!confirm('Delete order ' + o.orderNo + '? Its stock goes back. This cannot be undone.')) return;
  await api('/api/orders/' + o.id, 'DELETE');
  toast('Order deleted');
  if (D.solo) { closeDrawer(); return; }
  D.order = null; D.tab = 'orders'; await commit();
};

/* =========================================================================
   ORDERS
   ========================================================================= */
function filteredOrders() {
  const q = ui.ordQ.trim().toLowerCase(), qd = digitsOf(q);
  return S.orders.filter(o => {
    if (ui.ordStatus === 'toship') { if (!['placed', 'packed'].includes(o.status)) return false; }
    else if (ui.ordStatus === 'active') { if (!['placed', 'packed', 'dispatched'].includes(o.status)) return false; }
    else if (ui.ordStatus && o.status !== ui.ordStatus) return false;
    if (ui.ordPay === 'due' && !(dueOf(o) > 0)) return false;
    if (ui.ordPay === 'paid' && payState(o) !== 'paid') return false;
    if (ui.ordFrom && o.date < ui.ordFrom) return false;
    if (ui.ordTo && o.date > ui.ordTo) return false;
    if (q) {
      const hay = [o.orderNo, o.customerName, o.phone, o.address, o.trackingId, o.courier, o.items.map(i => i.name).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q) && !(qd && digitsOf(o.phone).includes(qd))) return false;
    }
    return true;
  }).sort(byNewest);
}
const nameOfOrder = o => o.customerName || (cust(o.customerId) || {}).name || '';
function orderRow(o) {
  const c = cust(o.customerId), name = nameOfOrder(o);
  const msg = o.trackingId ? fill(S.settings.trackingTemplate, { name: name || 'Sir/Madam', orderNo: o.orderNo, tracking: o.trackingId, courier: o.courier ? '(' + o.courier + ')' : '', business: S.settings.businessName }) : '';
  return `<tr><td><button class="lnk" data-act="editOrder" data-id="${o.id}"><b class="mono">${esc(o.orderNo)}</b></button><div class="muted small">${fmtDate(o.date)}</div></td>
    <td><button class="lnk" data-act="openCust" data-id="${o.customerId}">${esc(name || o.phone)}</button><div class="muted small mono">${esc(o.phone)}</div>${o.address ? `<div class="muted small">${esc(o.address)}</div>` : ''}</td>
    <td>${esc(itemsText(o))}</td>
    <td class="r"><b>${money(o.total)}</b><div class="small">${payBadge(o)}</div>${dueOf(o) ? `<div class="small over">due ${money(dueOf(o))}</div>` : ''}</td>
    <td><select class="mini" data-change="ordStatus" data-id="${o.id}">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td>${o.trackingId ? `<span class="mono">${esc(o.trackingId)}</span> <button class="lnk small" data-act="copy" data-text="${esc(o.trackingId)}">copy</button><div class="muted small">${esc(o.courier)}</div><a class="small" target="_blank" rel="noopener" href="${waLink(o.phone, msg)}">Send on WhatsApp</a>` : '<span class="muted">—</span>'}</td>
    <td class="r"><button class="btn sm" data-act="editOrder" data-id="${o.id}">Edit</button></td></tr>`;
}
function ordBodyHTML() {
  const list = filteredOrders(), good = list.filter(live);
  const sum = good.reduce((s, o) => s + o.total, 0), paid = good.reduce((s, o) => s + Math.min(o.paid, o.total), 0), due = good.reduce((s, o) => s + dueOf(o), 0);
  return `<div class="sumbar"><div><b>${good.length}</b><span>orders</span></div><div><b>${money(sum)}</b><span>order value</span></div><div><b>${money(paid)}</b><span>received</span></div><div><b class="${due ? 'over' : ''}">${money(due)}</b><span>still to collect</span></div></div>
    <div class="tw">${list.length ? `<table><thead><tr><th>Order</th><th>Customer and address</th><th>Items</th><th class="r">Amount</th><th>Status</th><th>Tracking</th><th></th></tr></thead><tbody>${list.map(orderRow).join('')}</tbody></table>` : empty(S.orders.length ? 'No orders match these filters.' : 'No orders yet. Open a customer and press “New order”, or use the New order button above.')}</div>`;
}
function viewOrders() {
  const sel = (id, cur, opts) => `<select id="${id}" data-change="${id}">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="head"><div><h2>Orders</h2><div class="sub">Every order with the customer’s name, number and address in one place.</div></div>
    <div class="row"><button class="btn" data-act="exportOrders">Export CSV</button><button class="btn" data-act="copyDelivery">Copy delivery list</button><button class="btn tape" data-act="pickCust">+ New order</button></div></div>
    <div class="panel"><div class="row" style="margin-bottom:12px"><input id="ordQ" style="width:250px" placeholder="Search order, name, number, tracking" value="${esc(ui.ordQ)}" data-input="ordQ">
      ${sel('ordStatusF', ui.ordStatus, [['', 'All statuses'], ['toship', 'To ship (placed, packed)'], ['active', 'In progress'], ...Object.entries(STATUS)])}
      ${sel('ordPayF', ui.ordPay, [['', 'All payments'], ['due', 'Money still due'], ['paid', 'Fully paid']])}
      <span class="muted small">From</span><input type="date" value="${ui.ordFrom}" data-change="ordFromF"><span class="muted small">to</span><input type="date" value="${ui.ordTo}" data-change="ordToF"></div>
      <div class="chips" style="margin-bottom:14px"><button class="chip" data-act="ordRange" data-v="today">Today</button><button class="chip" data-act="ordRange" data-v="yesterday">Yesterday</button><button class="chip" data-act="ordRange" data-v="week">Last 7 days</button><button class="chip" data-act="ordRange" data-v="all">All dates</button></div>
      <div id="ordBody">${ordBodyHTML()}</div></div>`;
}
const paintOrders = () => { const b = $('#ordBody'); if (b) b.innerHTML = ordBodyHTML(); updateNav(); };
I.ordQ = el => { ui.ordQ = el.value; paintOrders(); };
C.ordStatusF = el => { ui.ordStatus = el.value; paintOrders(); };
C.ordPayF = el => { ui.ordPay = el.value; paintOrders(); };
C.ordFromF = el => { ui.ordFrom = el.value; paintOrders(); };
C.ordToF = el => { ui.ordTo = el.value; paintOrders(); };
A.ordRange = el => {
  const t = today(), v = el.dataset.v;
  [ui.ordFrom, ui.ordTo] = v === 'today' ? [t, t] : v === 'yesterday' ? [addDays(t, -1), addDays(t, -1)] : v === 'week' ? [addDays(t, -6), t] : ['', ''];
  safe(renderView);
};
C.ordStatus = async el => {
  const o = S.orders.find(x => x.id === el.dataset.id), had = o.trackingId;
  await api('/api/orders/' + o.id, 'PUT', { status: el.value });
  await load(); paintOrders();
  if (el.value === 'dispatched' && !had) { toast('Dispatched. Add the tracking ID.'); openOrder(o.customerId, o.id); }
};
A.pickCust = () => openDlg(`${dHead('New order')}<div class="dlg-body"><form data-submit="pickCust">
  <p class="muted small" style="margin-top:0">Type the customer’s number. If it is not saved yet, it is added now.</p>
  <div class="field"><span>Phone number</span><input id="pcPhone" list="custList" placeholder="03xx xxxxxxx" autocomplete="off"></div>
  <datalist id="custList">${S.customers.map(c => `<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('')}</datalist>
  <div class="row"><button class="btn primary">Continue</button><button type="button" class="btn" data-act="closeDlg">Cancel</button></div></form></div>`);
F.pickCust = async () => {
  const raw = $('#pcPhone').value, key = digitsOf(raw).slice(-10);
  if (digitsOf(raw).length < 7) throw new Error('Enter a valid phone number.');
  let c = S.customers.find(x => x.phoneKey === key);
  if (!c) { c = (await api('/api/intake', 'POST', { phone: raw, date: today() })).customer; await load(); }
  closeDlg(); openOrder(c.id, null);
};
A.exportOrders = () => downloadCSV('orders-' + today() + '.csv', [['Order', 'Date', 'Status', 'Name', 'Phone', 'Address', 'Items', 'Total', 'Received', 'Due', 'Tracking', 'Courier', 'Notes']]
  .concat(filteredOrders().map(o => [o.orderNo, o.date, STATUS[o.status], nameOfOrder(o), o.phone, o.address, itemsText(o), o.total, o.paid, dueOf(o), o.trackingId, o.courier, o.notes])));
A.copyDelivery = () => {
  const list = filteredOrders().filter(live);
  if (!list.length) throw new Error('No orders in the current list.');
  const text = list.map(o => [nameOfOrder(o) || '(no name)', o.phone, o.address || '(no address)', itemsText(o), dueOf(o) ? 'Collect ' + money(dueOf(o)) : 'Paid', o.trackingId ? 'Tracking ' + o.trackingId : ''].filter(Boolean).join(' | ')).join('\n');
  return A.copy({ dataset: { text } });
};

/* =========================================================================
   PRODUCTS AND STOCK
   ========================================================================= */
function prodItemsHTML() {
  const inCat = p => ui.prodCat === '' || (ui.prodCat === '_none' ? !catName(p.categoryId) : p.categoryId === ui.prodCat);
  const list = S.products.filter(inCat).sort((a, b) => catName(a.categoryId).localeCompare(catName(b.categoryId)) || a.name.localeCompare(b.name));
  const unc = S.products.filter(p => !catName(p.categoryId)).length;
  const isLow = p => p.stock <= 0 || (p.lowStockAt > 0 && p.stock <= p.lowStockAt);
  return `<div class="split"><div class="panel"><h3>Categories</h3><div class="sub">For example Jackton, Shilwar</div>
      <div class="catlist"><button class="${ui.prodCat === '' ? 'on' : ''}" data-act="prodCat" data-v=""><span>All products</span><span>${S.products.length}</span></button>
      ${S.categories.map(c => `<button class="${ui.prodCat === c.id ? 'on' : ''}" data-act="prodCat" data-v="${c.id}"><span>${esc(c.name)}</span><span>${S.products.filter(p => p.categoryId === c.id).length}</span></button>`).join('')}
      ${unc ? `<button class="${ui.prodCat === '_none' ? 'on' : ''}" data-act="prodCat" data-v="_none"><span>No category</span><span>${unc}</span></button>` : ''}</div>
      <form data-submit="addCategory" class="row" style="margin-top:12px;flex-wrap:nowrap"><input id="catName" placeholder="New category" style="flex:1"><button class="btn sm">Add</button></form>
      ${ui.prodCat && ui.prodCat !== '_none' ? '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="renameCat">Rename</button><button class="btn sm danger" data-act="delCat">Delete category</button></div>' : ''}</div>
    <div class="panel">${list.length ? `<div class="tw"><table><thead><tr><th>Product</th><th>Category</th><th class="r">Price</th><th class="r">In stock</th><th></th></tr></thead><tbody>
      ${list.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(catName(p.categoryId)) || '<span class="muted">—</span>'}</td><td class="r">${p.price ? money(p.price) : '<span class="muted">—</span>'}</td>
        <td class="r ${isLow(p) ? 'low' : ''}">${p.stock}${isLow(p) ? `<div class="small">${p.stock <= 0 ? 'out of stock' : 'low'}</div>` : ''}</td>
        <td class="r"><button class="btn sm" data-act="stockDlg" data-id="${p.id}">Stock</button> <button class="btn sm" data-act="histDlg" data-id="${p.id}">History</button> <button class="btn sm" data-act="prodDlg" data-id="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`
      : empty(S.products.length ? 'No products in this category.' : 'No products yet. Press “+ Add product” to create the first one.')}</div></div>`;
}
async function stockReportHTML() {
  const r = await api(`/api/stock-report?from=${ui.stockFrom}&to=${ui.stockTo}`);
  const rows = r.rows.sort((a, b) => catName(a.categoryId).localeCompare(catName(b.categoryId)) || a.name.localeCompare(b.name));
  const tot = k => rows.reduce((s, x) => s + x[k], 0);
  return `<div class="panel"><div class="row" style="margin-bottom:12px"><span class="muted small">From</span><input type="date" value="${ui.stockFrom}" data-change="stockFrom"><span class="muted small">to</span><input type="date" value="${ui.stockTo}" data-change="stockTo">
      <button class="chip" data-act="stockRange" data-v="today">Today</button><button class="chip" data-act="stockRange" data-v="yesterday">Yesterday</button><button class="chip" data-act="stockRange" data-v="week">Last 7 days</button><button class="chip" data-act="stockRange" data-v="month">This month</button>
      <span class="grow"></span><button class="btn" data-act="exportStock">Export CSV</button></div>
    <p class="muted small" style="margin-top:0">Started with + received − sold ± adjustments = left at the end of the period.</p>
    ${rows.length ? `<div class="tw"><table><thead><tr><th>Product</th><th>Category</th><th class="r">Started with</th><th class="r">Received</th><th class="r">Sold</th><th class="r">Adjusted</th><th class="r">Left</th><th class="r">In stock now</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(catName(x.categoryId)) || '<span class="muted">—</span>'}</td><td class="r">${x.opening}</td><td class="r">${x.received}</td><td class="r">${x.sold}</td><td class="r">${x.adjust}</td><td class="r"><b>${x.closing}</b></td><td class="r">${x.onHand}</td></tr>`).join('')}
      <tr class="grp"><td colspan="2">Total</td><td class="r">${tot('opening')}</td><td class="r">${tot('received')}</td><td class="r">${tot('sold')}</td><td class="r">${tot('adjust')}</td><td class="r">${tot('closing')}</td><td class="r">${tot('onHand')}</td></tr></tbody></table></div>` : empty('No products yet.')}</div>`;
}
async function viewProducts() {
  const body = ui.prodTab === 'items' ? prodItemsHTML() : await stockReportHTML();
  return `<div class="head"><div><h2>Products and stock</h2><div class="sub">What you have, what came in, and what was sold.</div></div>
    <div class="row"><div class="seg"><button class="${ui.prodTab === 'items' ? 'on' : ''}" data-act="prodTab" data-v="items">Products</button><button class="${ui.prodTab === 'report' ? 'on' : ''}" data-act="prodTab" data-v="report">Stock report</button></div>
    ${ui.prodTab === 'items' ? '<button class="btn tape" data-act="prodDlg">+ Add product</button>' : ''}</div></div>${body}`;
}
A.prodTab = el => { ui.prodTab = el.dataset.v; safe(renderView); };
A.prodCat = el => { ui.prodCat = el.dataset.v; safe(renderView); };
F.addCategory = async () => { const name = $('#catName').value.trim(); if (!name) return; const r = await api('/api/categories', 'POST', { name }); ui.prodCat = r.category.id; await sync(); toast('Category added'); };
A.renameCat = async () => { const c = S.categories.find(x => x.id === ui.prodCat), n = prompt('New name for this category:', c.name); if (n && n.trim()) { await api('/api/categories/' + c.id, 'PUT', { name: n }); await sync(); } };
A.delCat = async () => {
  const c = S.categories.find(x => x.id === ui.prodCat);
  if (!confirm('Delete the category “' + c.name + '”? Products and customers in it are kept, but become uncategorised.')) return;
  await api('/api/categories/' + c.id, 'DELETE'); ui.prodCat = ''; await sync();
};
A.prodDlg = el => {
  const p = el.dataset.id ? prod(el.dataset.id) : null;
  openDlg(`${dHead(p ? 'Edit ' + esc(p.name) : 'Add product')}<div class="dlg-body"><form data-submit="saveProd" data-id="${p ? p.id : ''}"><div class="grid2f">
    <label class="field full"><span>Product name</span><input id="pName" value="${esc(p ? p.name : '')}" required></label>
    <label class="field"><span>Category</span><select id="pCat"><option value="">No category</option>${S.categories.map(c => `<option value="${c.id}" ${(p ? p.categoryId : ui.prodCat) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Selling price (optional)</span><input id="pPrice" type="number" min="0" value="${p && p.price ? p.price : ''}"></label>
    ${p ? '' : '<label class="field"><span>Stock you have now</span><input id="pStock" type="number" min="0" value=""></label>'}
    <label class="field"><span>Warn me when stock falls to</span><input id="pLow" type="number" min="0" value="${p && p.lowStockAt ? p.lowStockAt : ''}"></label></div>
    <div class="row"><button class="btn primary">${p ? 'Save changes' : 'Add product'}</button><button type="button" class="btn" data-act="closeDlg">Cancel</button>${p ? '<span class="grow"></span><button type="button" class="btn danger" data-act="delProd" data-id="' + p.id + '">Delete</button>' : ''}</div></form></div>`);
};
F.saveProd = async f => {
  const id = f.dataset.id, body = { name: $('#pName').value, categoryId: $('#pCat').value || null, price: $('#pPrice').value, lowStockAt: $('#pLow').value };
  if (id) await api('/api/products/' + id, 'PUT', body); else await api('/api/products', 'POST', Object.assign(body, { stock: $('#pStock').value }));
  closeDlg(); await sync(); toast(id ? 'Product saved' : 'Product added');
};
A.delProd = async el => {
  const p = prod(el.dataset.id);
  if (!confirm('Delete “' + p.name + '” and its stock history? Past orders keep the item name.')) return;
  await api('/api/products/' + p.id, 'DELETE'); closeDlg(); await sync();
};
A.stockDlg = el => {
  const p = prod(el.dataset.id);
  openDlg(`${dHead('Stock: ' + esc(p.name))}<div class="dlg-body"><form data-submit="saveStock" data-id="${p.id}"><p style="margin-top:0">In stock now: <b>${p.stock}</b></p>
    <label class="field"><span>What happened?</span><select id="stMode"><option value="in">Stock received</option><option value="out">Stock removed (damaged, lost, given away)</option><option value="count">Physical count (set the exact number you counted)</option></select></label>
    <div class="grid2f"><label class="field"><span>Quantity</span><input id="stQty" type="number" min="0" step="1" required></label><label class="field"><span>Date</span><input id="stDate" type="date" value="${today()}"></label></div>
    <label class="field"><span>Note (optional)</span><input id="stNote" placeholder="For example: new lot from the factory"></label>
    <div class="row"><button class="btn primary">Save stock</button><button type="button" class="btn" data-act="closeDlg">Cancel</button></div></form></div>`);
};
F.saveStock = async f => {
  await api('/api/products/' + f.dataset.id + '/stock', 'POST', { mode: $('#stMode').value, qty: $('#stQty').value, date: $('#stDate').value, note: $('#stNote').value });
  closeDlg(); await sync(); toast('Stock updated');
};
A.histDlg = async el => {
  const p = prod(el.dataset.id), r = await api('/api/products/' + p.id + '/movements');
  openDlg(`${dHead('Stock history: ' + esc(p.name))}<div class="dlg-body">${r.movements.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>What</th><th class="r">Change</th><th class="r">Left</th><th>Note</th></tr></thead><tbody>
    ${r.movements.map(m => `<tr><td>${fmtDate(m.date)}</td><td>${MOVE[m.type] || esc(m.type)}</td><td class="r ${m.delta < 0 ? 'over' : ''}">${m.delta > 0 ? '+' : ''}${m.delta}</td><td class="r">${m.balanceAfter}</td><td class="muted small">${esc(m.note)}</td></tr>`).join('')}</tbody></table></div>` : empty('No stock movements yet.')}</div>`, 'wide');
};
C.stockFrom = el => { ui.stockFrom = el.value || today(); if (ui.stockTo < ui.stockFrom) ui.stockTo = ui.stockFrom; safe(renderView); };
C.stockTo = el => { ui.stockTo = el.value || ui.stockFrom; if (ui.stockTo < ui.stockFrom) ui.stockFrom = ui.stockTo; safe(renderView); };
A.stockRange = el => {
  const t = today(), v = el.dataset.v;
  [ui.stockFrom, ui.stockTo] = v === 'today' ? [t, t] : v === 'yesterday' ? [addDays(t, -1), addDays(t, -1)] : v === 'week' ? [addDays(t, -6), t] : [t.slice(0, 8) + '01', t];
  safe(renderView);
};
A.exportStock = async () => {
  const r = await api(`/api/stock-report?from=${ui.stockFrom}&to=${ui.stockTo}`);
  downloadCSV(`stock-${ui.stockFrom}-to-${ui.stockTo}.csv`, [['Product', 'Category', 'Started with', 'Received', 'Sold', 'Adjusted', 'Left', 'In stock now']]
    .concat(r.rows.map(x => [x.name, catName(x.categoryId), x.opening, x.received, x.sold, x.adjust, x.closing, x.onHand])));
};

/* =========================================================================
   FOLLOW-UPS
   ========================================================================= */
function viewFollowups() {
  const t = today(), all = S.interactions.filter(i => i.followUpDate && !i.followUpDone).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
  const groups = [['Overdue', all.filter(i => i.followUpDate < t), 'over'], ['Due today', all.filter(i => i.followUpDate === t), 'dtoday'], ['Coming up', all.filter(i => i.followUpDate > t), '']];
  const card = i => {
    const c = cust(i.customerId); if (!c) return '';
    const msg = fill(S.settings.reminderTemplate, { name: c.name || 'Sir/Madam', business: S.settings.businessName, note: i.followUpNote ? i.followUpNote + ' ' : '' });
    return `<div class="card"><div class="row"><button class="lnk grow" data-act="openCust" data-id="${c.id}"><b class="mono">${esc(c.phone)}</b> ${esc(c.name)}</button>${typeBadge(c.type)}</div>
      <div class="meta">Chat on ${fmtDate(i.date)}${i.notes ? ' · ' + esc(i.notes) : ''}</div>${i.followUpNote ? `<div style="margin-top:6px">${esc(i.followUpNote)}</div>` : ''}
      <div class="row" style="margin-top:10px"><a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(c.phone, msg)}">Send reminder on WhatsApp</a><button class="btn sm" data-act="fuDone" data-id="${i.id}">Mark done</button><button class="btn sm" data-act="fuLater" data-id="${i.id}">Push to tomorrow</button></div></div>`;
  };
  return `<div class="head"><div><h2>Follow-ups</h2><div class="sub">Customers you promised to come back to. Set the date in a customer’s “Today’s chat” tab.</div></div></div>
    ${all.length ? groups.filter(g => g[1].length).map(([l, list, cls]) => `<div class="panel"><h3 class="${cls}">${l} (${list.length})</h3><div style="margin-top:12px">${list.map(card).join('')}</div></div>`).join('') : `<div class="panel">${empty('No follow-ups waiting. Set a follow-up date on a chat and it shows up here.')}</div>`}`;
}
A.fuDone = async el => { await api('/api/interactions/' + el.dataset.id, 'PUT', { followUpDone: true }); await sync(); toast('Follow-up done'); };
A.fuLater = async el => { await api('/api/interactions/' + el.dataset.id, 'PUT', { followUpDate: addDays(today(), 1) }); await sync(); toast('Moved to tomorrow'); };

/* =========================================================================
   SETTINGS AND BACKUP
   ========================================================================= */
function viewSettings() {
  const s = S.settings;
  return `<div class="head"><div><h2>Settings and backup</h2></div></div><div class="cols2"><div>
    <div class="panel"><h3>Business and WhatsApp messages</h3><div class="sub">Used in the WhatsApp buttons. These words can be filled in automatically: {name} {business} {note} {orderNo} {tracking} {courier}</div>
      <label class="field"><span>Business name</span><input id="sName" value="${esc(s.businessName)}"></label>
      <label class="field"><span>Follow-up reminder message</span><textarea id="sRemind" rows="4">${esc(s.reminderTemplate)}</textarea></label>
      <label class="field"><span>Tracking message</span><textarea id="sTrack" rows="4">${esc(s.trackingTemplate)}</textarea></label>
      <button class="btn primary" data-act="saveSettings">Save settings</button></div>
    <div class="panel"><h3>Reasons a customer did not order</h3><div class="sub">These appear when you mark a chat as “Did not order”.</div>
      <div class="chips" style="margin-bottom:12px">${S.lostReasons.map(r => `<span class="chip">${esc(r)} <button class="x" style="font-size:16px;padding:0 0 0 6px" data-act="delReason" data-v="${esc(r)}" aria-label="Remove">×</button></span>`).join('')}</div>
      <form data-submit="addReason" class="row" style="flex-wrap:nowrap"><input id="newReason" placeholder="For example: Color not available" style="flex:1"><button class="btn">Add reason</button></form></div>
  </div><div>
    <div class="panel"><h3>Backup and restore</h3><div class="sub">All your data is in one file on this computer: <span class="mono">data/db.json</span>. A copy is saved every day in <span class="mono">data/backups</span> (last 30 kept).</div>
      <div class="row"><a class="btn primary" href="/api/backup">Download a backup</a>
      <label class="btn">Restore from a backup<input type="file" accept=".json,application/json" data-change="restoreFile" hidden></label></div>
      <p class="muted small" style="margin-bottom:0">Restoring replaces everything with the backup file. The current data is saved to <span class="mono">data/backups</span> first.</p></div>
    <div class="panel"><h3>Your data at a glance</h3><div class="sumbar" style="margin:10px 0 0"><div><b>${S.customers.length}</b><span>customers</span></div><div><b>${S.interactions.length}</b><span>chats logged</span></div><div><b>${S.orders.length}</b><span>orders</span></div><div><b>${S.products.length}</b><span>products</span></div></div></div>
  </div></div>`;
}
A.saveSettings = async () => { await api('/api/settings', 'PUT', { businessName: $('#sName').value, reminderTemplate: $('#sRemind').value, trackingTemplate: $('#sTrack').value }); await sync(); toast('Settings saved'); };
F.addReason = async () => { const r = $('#newReason').value.trim(); if (!r) return; await api('/api/lostReasons', 'POST', { reason: r }); await sync(); };
A.delReason = async el => { await api('/api/lostReasons?reason=' + encodeURIComponent(el.dataset.v), 'DELETE'); await sync(); };
C.restoreFile = async el => {
  const file = el.files[0]; if (!file) return;
  let data; try { data = JSON.parse(await file.text()); } catch (_) { throw new Error('That file is not a valid backup.'); }
  if (!confirm('Replace ALL current data with this backup?')) { el.value = ''; return; }
  await api('/api/restore', 'POST', data); await sync(); toast('Backup restored');
};

/* ---------- start ---------- */
(async function init() {
  try { await load(); }
  catch (e) { $('#view').innerHTML = `<div class="panel">${empty(esc(e.message))}</div>`; return; }
  route();
  window.addEventListener('focus', () => { if (!drawer.open && !dlg.open && ui.view !== 'settings') safe(sync); });
})();
