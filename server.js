'use strict';
/*
 * Garment Management System - local server
 * Run:  node server.js     then open  http://localhost:3003
 * No npm packages needed (Node.js 16+).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { exec } = require('child_process');

const PORT = 3003;
const HOST = '127.0.0.1'; // this computer only. Use '0.0.0.0' to open it from a phone on the same Wi-Fi.
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* ---------------- constants ---------------- */
const CUSTOMER_TYPES = ['unclassified', 'wholesale', 'reseller', 'retail', 'lead', 'no_response', 'other'];
const OUTCOMES = ['open', 'ordered', 'no_order', 'no_response'];
const ORDER_STATUSES = ['placed', 'packed', 'dispatched', 'delivered', 'cancelled'];
const DEFAULT_LOST = [
  'Out of stock',
  'Sizing issue',
  'Price too high',
  'Upgraded version unavailable',
  'Design / product not available',
  'Delivery charges or location',
  'Just inquiring / comparing',
  'No response after follow-up',
  'Other'
];

/* ---------------- small helpers ---------------- */
const pad = n => String(n).padStart(2, '0');
function localDate(d = new Date()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addDays(ds, n) { const [y, m, d] = ds.split('-').map(Number); return localDate(new Date(y, m - 1, d + n)); }
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const uid = () => crypto.randomBytes(8).toString('hex');
const nowISO = () => new Date().toISOString();
const str = v => (v == null ? '' : String(v).trim());
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const digits = s => String(s || '').replace(/\D/g, '');
const phoneKey = s => { const d = digits(s); return d.length > 10 ? d.slice(-10) : d; };
function cleanPhone(s) {
  const raw = String(s || '').trim();
  const d = digits(raw);
  if (d.length === 12 && d.startsWith('92')) return '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('3')) return '0' + d;
  if (d.length === 11 && d.startsWith('03')) return d;
  return raw.replace(/\s+/g, '');
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

/* ---------------- database (JSON file, atomic writes) ---------------- */
function defaultDB() {
  return {
    version: 2,
    customers: [],
    categories: [],
    products: [],
    movements: [],
    interactions: [],
    orders: [],
    lostReasons: [...DEFAULT_LOST],
    counters: {},
    settings: {
      businessName: 'Garment Management System',
      reminderTemplate: 'Assalam o Alaikum {name}, this is a gentle reminder from {business}. {note}Please let us know if you would like to go ahead with your order.',
      trackingTemplate: 'Assalam o Alaikum {name}, your order {orderNo} has been dispatched. Tracking ID: {tracking} {courier}. Thank you for shopping with {business}!'
    }
  };
}

function migrate(d) {
  const def = defaultDB();
  for (const k of Object.keys(def)) if (!(k in d)) d[k] = def[k];
  d.settings = Object.assign({}, def.settings, d.settings || {});
  d.customers.forEach(c => {
    if (c.customerType && !c.type) c.type = c.customerType === 'active_lead' ? 'lead' : c.customerType;
    if (!CUSTOMER_TYPES.includes(c.type)) c.type = 'unclassified';
    if (!Array.isArray(c.productIds)) c.productIds = c.productId ? [c.productId] : [];
    c.phoneKey = phoneKey(c.phone);
    c.altContact = c.altContact || '';
    c.categoryId = c.categoryId || null;
  });
  d.products.forEach(p => { p.price = num(p.price); p.stock = num(p.stock); p.lowStockAt = num(p.lowStockAt); });
  d.orders.forEach(o => {
    if (!Array.isArray(o.items)) {
      o.items = [{ productId: o.productId || null, name: o.productName || 'Item', size: '', qty: num(o.quantity) || 1, price: o.amount ? num(o.amount) / (num(o.quantity) || 1) : 0 }];
      o.total = num(o.amount);
    }
    o.paid = num(o.paid);
    if (!ORDER_STATUSES.includes(o.status)) o.status = 'placed';
    if (!o.orderNo) o.orderNo = 'ORD-' + String(o.date || localDate()).replace(/-/g, '') + '-' + o.id.slice(0, 3).toUpperCase();
    o.stockApplied = !!o.stockApplied;
  });
  d.interactions.forEach(i => {
    if (!OUTCOMES.includes(i.outcome)) i.outcome = i.outcome === 'pending' ? 'open' : 'open';
    i.followUpDate = i.followUpDate || '';
    i.followUpNote = i.followUpNote || '';
    i.followUpDone = !!i.followUpDone;
  });
  return d;
}

let db;
if (fs.existsSync(DB_FILE)) {
  try {
    db = migrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {
    const bad = path.join(DATA_DIR, 'db.corrupt-' + Date.now() + '.json');
    try { fs.copyFileSync(DB_FILE, bad); } catch (_) {}
    console.error('Could not read data/db.json (copied to ' + bad + '). Starting with an empty database.');
    db = defaultDB();
  }
} else {
  db = defaultDB();
}
function saveDB() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
saveDB();

function autoBackup() {
  try {
    const f = path.join(BACKUP_DIR, 'db-' + localDate() + '.json');
    if (!fs.existsSync(f)) fs.copyFileSync(DB_FILE, f);
    const files = fs.readdirSync(BACKUP_DIR).filter(n => /^db-.*\.json$/.test(n)).sort();
    while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) { console.error('Auto-backup failed:', e.message); }
}
autoBackup();
setInterval(autoBackup, 60 * 60 * 1000).unref();

/* ---------------- domain helpers ---------------- */
function makeCustomer(rawPhone) {
  return {
    id: uid(), phone: cleanPhone(rawPhone), phoneKey: phoneKey(rawPhone),
    name: '', address: '', altContact: '', type: 'unclassified',
    categoryId: null, productIds: [], notes: '',
    createdAt: nowISO(), updatedAt: nowISO()
  };
}
function makeChat(customerId, date) {
  return {
    id: uid(), customerId, date, outcome: 'open', lostReason: '', notes: '',
    followUpDate: '', followUpNote: '', followUpDone: false, createdAt: nowISO()
  };
}
function ensureChat(customerId, date) {
  let it = db.interactions.find(i => i.customerId === customerId && i.date === date);
  if (it) return { interaction: it, created: false };
  it = makeChat(customerId, date);
  db.interactions.push(it);
  return { interaction: it, created: true };
}
function refreshChat(customerId, date) {
  const has = db.orders.some(o => o.customerId === customerId && o.date === date && o.status !== 'cancelled');
  let it = db.interactions.find(i => i.customerId === customerId && i.date === date);
  if (has) {
    if (!it) { it = makeChat(customerId, date); db.interactions.push(it); }
    it.outcome = 'ordered'; it.lostReason = '';
  } else if (it && it.outcome === 'ordered') {
    it.outcome = 'open';
  }
}
function nextOrderNo(date) {
  const key = date.replace(/-/g, '');
  db.counters[key] = (db.counters[key] || 0) + 1;
  return 'ORD-' + key + '-' + String(db.counters[key]).padStart(3, '0');
}
function addMovement(product, delta, type, note, date, orderId) {
  product.stock = (Number(product.stock) || 0) + delta;
  db.movements.push({
    id: uid(), productId: product.id, type, delta, note: note || '',
    date: date || localDate(), orderId: orderId || null,
    balanceAfter: product.stock, createdAt: nowISO()
  });
}
function releaseStock(order, date, note) {
  if (!order.stockApplied) return;
  for (const it of order.items) {
    const p = it.productId && db.products.find(x => x.id === it.productId);
    if (p) addMovement(p, it.qty, 'return', note || ('Order ' + order.orderNo + ' reversed'), date || localDate(), order.id);
  }
  order.stockApplied = false;
}
function syncOrderStock(order) {
  if (order.status === 'cancelled') { releaseStock(order, localDate(), 'Order ' + order.orderNo + ' cancelled'); return; }
  if (order.stockApplied) return;
  for (const it of order.items) {
    const p = it.productId && db.products.find(x => x.id === it.productId);
    if (p) addMovement(p, -it.qty, 'sale', 'Order ' + order.orderNo, order.date, order.id);
  }
  order.stockApplied = true;
}
function cleanItems(arr) {
  return (Array.isArray(arr) ? arr : []).map(it => {
    const p = it.productId ? db.products.find(x => x.id === it.productId) : null;
    return {
      productId: p ? p.id : null,
      name: str(it.name) || (p ? p.name : ''),
      size: str(it.size),
      qty: Math.max(1, Math.floor(num(it.qty)) || 1),
      price: Math.max(0, num(it.price))
    };
  }).filter(it => it.name);
}
function calcTotal(items, override) {
  if (override !== undefined && override !== null && override !== '' && Number.isFinite(Number(override))) return Math.max(0, Number(override));
  return items.reduce((s, i) => s + i.qty * i.price, 0);
}
function removeOrder(order) {
  releaseStock(order, localDate(), 'Order ' + order.orderNo + ' deleted');
  db.orders = db.orders.filter(o => o.id !== order.id);
}

/* ---------------- dashboard + stock report ---------------- */
function dayStats(date) {
  const orders = db.orders.filter(o => o.date === date && o.status !== 'cancelled');
  const orderedSet = new Set(orders.map(o => o.customerId));
  const chats = db.interactions.filter(i => i.date === date);
  const seg = {
    wholesale: { chats: 0, ordered: 0 },
    reseller: { chats: 0, ordered: 0 },
    active: { chats: 0, ordered: 0, no_order: 0, open: 0 },
    no_response: { chats: 0 },
    unclassified: { chats: 0 }
  };
  const lost = {};
  for (const it of chats) {
    const c = db.customers.find(x => x.id === it.customerId);
    const t = c ? c.type : 'unclassified';
    const outcome = orderedSet.has(it.customerId) ? 'ordered' : it.outcome;
    let s;
    if (t === 'wholesale') s = 'wholesale';
    else if (t === 'reseller') s = 'reseller';
    else if (outcome === 'ordered' || outcome === 'no_order') s = 'active';
    else if (t === 'no_response' || outcome === 'no_response') s = 'no_response';
    else if (t === 'unclassified') s = 'unclassified';
    else s = 'active';
    seg[s].chats++;
    if (s === 'wholesale' || s === 'reseller') { if (outcome === 'ordered') seg[s].ordered++; }
    if (s === 'active') {
      if (outcome === 'ordered') seg.active.ordered++;
      else if (outcome === 'no_order') seg.active.no_order++;
      else seg.active.open++;
    }
    if (outcome === 'no_order') {
      const r = it.lostReason || 'Reason not recorded';
      lost[r] = (lost[r] || 0) + 1;
    }
  }
  const orderedChats = chats.filter(i => orderedSet.has(i.customerId) || i.outcome === 'ordered').length;
  return {
    date,
    chats: chats.length,
    orders: orders.length,
    revenue: orders.reduce((s, o) => s + o.total, 0),
    orderedChats,
    segments: seg,
    lostReasons: Object.entries(lost).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  };
}
function computeDashboard(date) {
  const d = dayStats(date);
  const y = dayStats(addDays(date, -1));
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const ds = addDays(date, -i);
    const s = i === 0 ? d : dayStats(ds);
    trend.push({ date: ds, chats: s.chats, orders: s.orders });
  }
  const a = d.segments.active;
  return Object.assign({}, d, {
    yesterday: { chats: y.chats, orders: y.orders, revenue: y.revenue },
    activeConversion: a.chats ? Math.round((a.ordered / a.chats) * 100) : 0,
    overallConversion: d.chats ? Math.round((d.orderedChats / d.chats) * 100) : 0,
    trend
  });
}
function stockReport(from, to) {
  const rows = db.products.map(p => {
    const mv = db.movements.filter(m => m.productId === p.id);
    const opening = mv.filter(m => m.date < from).reduce((s, m) => s + m.delta, 0);
    const inRange = mv.filter(m => m.date >= from && m.date <= to);
    const sum = fn => inRange.filter(fn).reduce((s, m) => s + m.delta, 0);
    const received = sum(m => m.type === 'opening' || m.type === 'in');
    const sold = -sum(m => m.type === 'sale' || m.type === 'return');
    const adjust = sum(m => m.type === 'out' || m.type === 'count');
    return {
      productId: p.id, name: p.name, categoryId: p.categoryId, opening, received, sold, adjust,
      closing: opening + received - sold + adjust, onHand: p.stock
    };
  });
  return { from, to, rows };
}

/* ---------------- API routes ---------------- */
const routes = [];
function route(method, pattern, fn) {
  const keys = (pattern.match(/:(\w+)/g) || []).map(s => s.slice(1));
  routes.push({ method, keys, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn });
}
const find = (list, id, what) => {
  const x = list.find(i => i.id === id);
  if (!x) throw new HttpError(404, what + ' not found');
  return x;
};

route('GET', '/api/state', () => { const { movements, ...rest } = db; return rest; });

route('GET', '/api/dashboard', ({ query }) => computeDashboard(isDate(query.date) ? query.date : localDate()));

route('GET', '/api/stock-report', ({ query }) => {
  const from = isDate(query.from) ? query.from : localDate();
  const to = isDate(query.to) ? query.to : from;
  return stockReport(from, to < from ? from : to);
});

/* Quick phone intake: saves the number instantly and logs today's chat */
route('POST', '/api/intake', ({ body }) => {
  const raw = str(body.phone);
  if (digits(raw).length < 7) throw new HttpError(400, 'Please enter a valid phone number.');
  const key = phoneKey(raw);
  const date = isDate(body.date) ? body.date : localDate();
  let customer = db.customers.find(c => c.phoneKey === key);
  const existed = !!customer;
  if (!customer) { customer = makeCustomer(raw); db.customers.push(customer); }
  const { interaction, created } = ensureChat(customer.id, date);
  saveDB();
  return { customer, interaction, existed, chatCreated: created };
});

/* Customers */
route('PUT', '/api/customers/:id', ({ params, body }) => {
  const c = find(db.customers, params.id, 'Customer');
  if ('phone' in body) {
    const key = phoneKey(body.phone);
    if (digits(body.phone).length < 7) throw new HttpError(400, 'Please enter a valid phone number.');
    if (db.customers.some(x => x.id !== c.id && x.phoneKey === key)) throw new HttpError(409, 'Another customer already has this number.');
    c.phone = cleanPhone(body.phone); c.phoneKey = key;
  }
  for (const k of ['name', 'address', 'altContact', 'notes']) if (k in body) c[k] = str(body[k]);
  if ('type' in body && CUSTOMER_TYPES.includes(body.type)) c.type = body.type;
  if ('categoryId' in body) c.categoryId = db.categories.some(x => x.id === body.categoryId) ? body.categoryId : null;
  if ('productIds' in body) c.productIds = (Array.isArray(body.productIds) ? body.productIds : []).filter(id => db.products.some(p => p.id === id));
  c.updatedAt = nowISO();
  saveDB();
  return { customer: c };
});
route('DELETE', '/api/customers/:id', ({ params }) => {
  const c = find(db.customers, params.id, 'Customer');
  db.orders.filter(o => o.customerId === c.id).forEach(removeOrder);
  db.interactions = db.interactions.filter(i => i.customerId !== c.id);
  db.customers = db.customers.filter(x => x.id !== c.id);
  saveDB();
  return { ok: true };
});

/* Categories (e.g. Jackton, Shilwar) */
route('POST', '/api/categories', ({ body }) => {
  const name = str(body.name);
  if (!name) throw new HttpError(400, 'Category name is required.');
  if (db.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'That category already exists.');
  const category = { id: uid(), name, createdAt: nowISO() };
  db.categories.push(category); saveDB();
  return [201, { category }];
});
route('PUT', '/api/categories/:id', ({ params, body }) => {
  const c = find(db.categories, params.id, 'Category');
  const name = str(body.name);
  if (!name) throw new HttpError(400, 'Category name is required.');
  c.name = name; saveDB();
  return { category: c };
});
route('DELETE', '/api/categories/:id', ({ params }) => {
  const c = find(db.categories, params.id, 'Category');
  db.categories = db.categories.filter(x => x.id !== c.id);
  db.customers.forEach(x => { if (x.categoryId === c.id) x.categoryId = null; });
  db.products.forEach(x => { if (x.categoryId === c.id) x.categoryId = null; });
  saveDB();
  return { ok: true };
});

/* Products + stock */
route('POST', '/api/products', ({ body }) => {
  const name = str(body.name);
  if (!name) throw new HttpError(400, 'Product name is required.');
  const product = {
    id: uid(), name,
    categoryId: db.categories.some(c => c.id === body.categoryId) ? body.categoryId : null,
    price: Math.max(0, num(body.price)), stock: 0, lowStockAt: Math.max(0, num(body.lowStockAt)),
    createdAt: nowISO()
  };
  db.products.push(product);
  const qty = Math.floor(num(body.stock));
  if (qty > 0) addMovement(product, qty, 'opening', 'Opening stock', localDate());
  saveDB();
  return [201, { product }];
});
route('PUT', '/api/products/:id', ({ params, body }) => {
  const p = find(db.products, params.id, 'Product');
  if ('name' in body) { if (!str(body.name)) throw new HttpError(400, 'Product name is required.'); p.name = str(body.name); }
  if ('categoryId' in body) p.categoryId = db.categories.some(c => c.id === body.categoryId) ? body.categoryId : null;
  if ('price' in body) p.price = Math.max(0, num(body.price));
  if ('lowStockAt' in body) p.lowStockAt = Math.max(0, num(body.lowStockAt));
  saveDB();
  return { product: p };
});
route('DELETE', '/api/products/:id', ({ params }) => {
  const p = find(db.products, params.id, 'Product');
  db.products = db.products.filter(x => x.id !== p.id);
  db.movements = db.movements.filter(m => m.productId !== p.id);
  db.orders.forEach(o => o.items.forEach(it => { if (it.productId === p.id) it.productId = null; }));
  db.customers.forEach(c => { c.productIds = c.productIds.filter(id => id !== p.id); });
  saveDB();
  return { ok: true };
});
route('POST', '/api/products/:id/stock', ({ params, body }) => {
  const p = find(db.products, params.id, 'Product');
  const qty = Math.floor(num(body.qty));
  if (!(qty >= 0) || (body.mode !== 'count' && qty === 0)) throw new HttpError(400, 'Enter a quantity greater than zero.');
  const date = isDate(body.date) ? body.date : localDate();
  const note = str(body.note);
  if (body.mode === 'in') addMovement(p, qty, 'in', note || 'Stock received', date);
  else if (body.mode === 'out') addMovement(p, -qty, 'out', note || 'Stock removed', date);
  else if (body.mode === 'count') {
    const delta = qty - p.stock;
    if (delta === 0) throw new HttpError(400, 'Stock already matches that count.');
    addMovement(p, delta, 'count', note || 'Physical count', date);
  } else throw new HttpError(400, 'Unknown stock action.');
  saveDB();
  return { product: p };
});
route('GET', '/api/products/:id/movements', ({ params }) => {
  find(db.products, params.id, 'Product');
  return { movements: db.movements.filter(m => m.productId === params.id).slice(-60).reverse() };
});

/* Chats (one record per customer per day) */
route('POST', '/api/interactions', ({ body }) => {
  const c = find(db.customers, body.customerId, 'Customer');
  const date = isDate(body.date) ? body.date : localDate();
  const { interaction: it } = ensureChat(c.id, date);
  if (OUTCOMES.includes(body.outcome)) it.outcome = body.outcome;
  it.lostReason = it.outcome === 'no_order' ? str(body.lostReason) : '';
  if ('notes' in body) it.notes = str(body.notes);
  if ('followUpDate' in body) {
    const nd = isDate(body.followUpDate) ? body.followUpDate : '';
    if (nd !== it.followUpDate) it.followUpDone = false;
    it.followUpDate = nd;
  }
  if ('followUpNote' in body) it.followUpNote = str(body.followUpNote);
  saveDB();
  return [201, { interaction: it }];
});
route('PUT', '/api/interactions/:id', ({ params, body }) => {
  const it = find(db.interactions, params.id, 'Chat');
  if ('followUpDone' in body) it.followUpDone = !!body.followUpDone;
  if ('followUpDate' in body) it.followUpDate = isDate(body.followUpDate) ? body.followUpDate : '';
  saveDB();
  return { interaction: it };
});
route('DELETE', '/api/interactions/:id', ({ params }) => {
  const it = find(db.interactions, params.id, 'Chat');
  db.interactions = db.interactions.filter(x => x.id !== it.id);
  saveDB();
  return { ok: true };
});

/* Orders */
route('POST', '/api/orders', ({ body }) => {
  const customer = find(db.customers, body.customerId, 'Customer');
  const items = cleanItems(body.items);
  if (!items.length) throw new HttpError(400, 'Add at least one item to the order.');
  const date = isDate(body.date) ? body.date : localDate();
  const order = {
    id: uid(), orderNo: nextOrderNo(date), customerId: customer.id,
    customerName: str(body.customerName) || customer.name,
    phone: customer.phone, address: str(body.address) || customer.address,
    items, total: calcTotal(items, body.total), paid: Math.max(0, num(body.paid)),
    status: ORDER_STATUSES.includes(body.status) ? body.status : 'placed',
    trackingId: str(body.trackingId), courier: str(body.courier),
    date, notes: str(body.notes), stockApplied: false, createdAt: nowISO()
  };
  if (order.status === 'delivered') order.deliveredAt = nowISO();
  if (!customer.name && order.customerName) customer.name = order.customerName;
  if (!customer.address && order.address) customer.address = order.address;
  syncOrderStock(order);
  db.orders.push(order);
  refreshChat(customer.id, date);
  saveDB();
  return [201, { order }];
});
route('PUT', '/api/orders/:id', ({ params, body }) => {
  const o = find(db.orders, params.id, 'Order');
  const oldDate = o.date;
  let items = o.items;
  if ('items' in body) {
    items = cleanItems(body.items);
    if (!items.length) throw new HttpError(400, 'Add at least one item to the order.');
  }
  const newDate = 'date' in body && isDate(body.date) ? body.date : o.date;
  if ('items' in body || newDate !== o.date) releaseStock(o, o.date, 'Order ' + o.orderNo + ' edited');
  o.items = items;
  o.date = newDate;
  for (const k of ['customerName', 'address', 'trackingId', 'courier', 'notes']) if (k in body) o[k] = str(body[k]);
  if ('paid' in body) o.paid = Math.max(0, num(body.paid));
  if ('status' in body && ORDER_STATUSES.includes(body.status)) {
    o.status = body.status;
    if (o.status === 'delivered' && !o.deliveredAt) o.deliveredAt = nowISO();
  }
  if ('items' in body || 'total' in body) o.total = calcTotal(items, body.total);
  syncOrderStock(o);
  refreshChat(o.customerId, o.date);
  if (oldDate !== o.date) refreshChat(o.customerId, oldDate);
  saveDB();
  return { order: o };
});
route('DELETE', '/api/orders/:id', ({ params }) => {
  const o = find(db.orders, params.id, 'Order');
  removeOrder(o);
  refreshChat(o.customerId, o.date);
  saveDB();
  return { ok: true };
});

/* Settings + lost reasons */
route('PUT', '/api/settings', ({ body }) => {
  for (const k of ['businessName', 'reminderTemplate', 'trackingTemplate']) if (k in body) db.settings[k] = String(body[k]);
  saveDB();
  return { settings: db.settings };
});
route('POST', '/api/lostReasons', ({ body }) => {
  const r = str(body.reason);
  if (r && !db.lostReasons.some(x => x.toLowerCase() === r.toLowerCase())) { db.lostReasons.push(r); saveDB(); }
  return { lostReasons: db.lostReasons };
});
route('DELETE', '/api/lostReasons', ({ query }) => {
  db.lostReasons = db.lostReasons.filter(x => x !== query.reason);
  saveDB();
  return { lostReasons: db.lostReasons };
});

/* Backup / restore */
route('POST', '/api/restore', ({ body }) => {
  if (!body || !Array.isArray(body.customers) || !Array.isArray(body.orders) || !Array.isArray(body.products)) {
    throw new HttpError(400, 'This file is not a valid backup.');
  }
  try { fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, 'before-restore-' + Date.now() + '.json')); } catch (_) {}
  db = migrate(body);
  saveDB();
  return { ok: true };
});

/* ---------------- HTTP plumbing ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 50 * 1024 * 1024) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^[\/\\]+/, '');
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) return serveStatic(res, pathname);

    if (req.method === 'GET' && pathname === '/api/backup') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="garment-backup-' + localDate() + '.json"'
      });
      return res.end(JSON.stringify(db, null, 1));
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams.entries());
      const out = await r.fn({ params, body, query });
      return Array.isArray(out) ? sendJSON(res, out[0], out[1]) : sendJSON(res, 200, out);
    }
    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) sendJSON(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
    else res.end();
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error('\nPort ' + PORT + ' is already in use. Close the other program (or an older copy of this app) and try again.\n');
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = 'http://localhost:' + PORT;
  console.log('');
  console.log('  Garment Management System is running');
  console.log('  Open in your browser: ' + url);
  console.log('  Your data is saved in: ' + DB_FILE);
  console.log('  (Press Ctrl+C to stop)');
  console.log('');
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
    exec(cmd, () => {});
  }
});
