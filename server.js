/* ============================================================================
   CUSTOMER CRM — BACKEND (Express + better-sqlite3)
   Complete backend with embedded schema.
   ============================================================================ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/* ---------------------------- Configuration ------------------------------ */
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'customer-management.sqlite');
const TZ = 'Asia/Karachi';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

/* ---------------------------- Schema ------------------------------------- */
const SCHEMA = `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('timezone', 'Asia/Karachi'),
  ('tracking_prefix', 'NT'),
  ('default_currency', 'PKR');

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL UNIQUE,
  name TEXT,
  whatsapp TEXT,
  whatsapp_normalized TEXT,
  alternate_phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','archived')),
  lead_status TEXT CHECK (lead_status IS NULL OR lead_status IN
    ('new','contacted','interested','follow_up','converted','not_interested')),
  lead_source TEXT,
  preferred_contact TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_customers_whatsapp ON customers(whatsapp_normalized);
CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_created ON customers(created_at);

CREATE TRIGGER trg_customers_created_immutable
BEFORE UPDATE OF created_at ON customers
WHEN NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'created_at is immutable');
END;

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO categories (name) VALUES ('Wholesale'), ('Retail'), ('Lead'), ('Other');

CREATE TABLE customer_categories (
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (customer_id, category_id)
);
CREATE INDEX idx_cc_category ON customer_categories(category_id);

CREATE TABLE hardware_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_name TEXT, brand TEXT, model TEXT, specifications TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  budget_minor INTEGER CHECK (budget_minor IS NULL OR budget_minor >= 0),
  currency TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_hw_customer ON hardware_requirements(customer_id);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','completed','cancelled')),
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','dispatched','delivered')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid')),
  currency TEXT NOT NULL DEFAULT 'PKR',
  subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  extra_charges_minor INTEGER NOT NULL DEFAULT 0 CHECK (extra_charges_minor >= 0),
  final_price_minor INTEGER CHECK (final_price_minor IS NULL OR final_price_minor >= 0),
  payment_notes TEXT, order_notes TEXT, product_requirements TEXT,
  customer_name_snapshot TEXT,
  customer_phone_snapshot TEXT,
  customer_whatsapp_snapshot TEXT,
  shipping_address_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at TEXT, finalized_at TEXT,
  CHECK (status <> 'completed' OR
    (final_price_minor IS NOT NULL AND finalized_at IS NOT NULL AND tracking_id IS NOT NULL))
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_finalized ON orders(finalized_at);

CREATE TRIGGER trg_orders_locked_after_completion
BEFORE UPDATE ON orders
WHEN OLD.status = 'completed' AND (
     NEW.final_price_minor IS NOT OLD.final_price_minor
  OR NEW.tracking_id IS NOT OLD.tracking_id
  OR NEW.finalized_at IS NOT OLD.finalized_at
  OR NEW.customer_name_snapshot IS NOT OLD.customer_name_snapshot
  OR NEW.customer_phone_snapshot IS NOT OLD.customer_phone_snapshot
  OR NEW.customer_whatsapp_snapshot IS NOT OLD.customer_whatsapp_snapshot
  OR NEW.shipping_address_snapshot IS NOT OLD.shipping_address_snapshot)
BEGIN
  SELECT RAISE(ABORT, 'completed order is locked');
END;

CREATE TABLE tracking_counters (
  day TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_sku TEXT, description TEXT, size_variant TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (line_total_minor = quantity * unit_price_minor - discount_minor),
  CHECK (line_total_minor >= 0)
);
CREATE INDEX idx_items_order ON order_items(order_id);
CREATE INDEX idx_items_product ON order_items(product_name);

CREATE TABLE customer_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  source TEXT CHECK (source IS NULL OR source IN ('whatsapp','call','other')),
  message_text TEXT NOT NULL, message_at TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_msg_customer ON customer_messages(customer_id);
CREATE INDEX idx_msg_order ON customer_messages(order_id);

CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL, details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_log_customer ON activity_logs(customer_id);
CREATE INDEX idx_log_order ON activity_logs(order_id);

CREATE VIEW v_dashboard_counts AS
SELECT
  (SELECT COUNT(*) FROM customers WHERE status <> 'archived') AS all_customers,
  (SELECT COUNT(*) FROM customers c JOIN customer_categories cc ON cc.customer_id = c.id
     JOIN categories g ON g.id = cc.category_id WHERE g.name = 'Wholesale' AND c.status <> 'archived') AS wholesale,
  (SELECT COUNT(*) FROM customers c JOIN customer_categories cc ON cc.customer_id = c.id
     JOIN categories g ON g.id = cc.category_id WHERE g.name = 'Retail' AND c.status <> 'archived') AS retail,
  (SELECT COUNT(*) FROM customers c JOIN customer_categories cc ON cc.customer_id = c.id
     JOIN categories g ON g.id = cc.category_id WHERE g.name = 'Lead' AND c.status <> 'archived') AS leads,
  (SELECT COUNT(DISTINCT customer_id) FROM orders WHERE status = 'completed') AS previous_customers,
  (SELECT COUNT(*) FROM orders WHERE status = 'draft') AS draft_orders,
  (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') AS pending_orders,
  (SELECT COUNT(*) FROM orders WHERE status IN ('draft','confirmed')) AS orders_in_progress,
  (SELECT COUNT(*) FROM orders WHERE status = 'completed') AS completed_orders,
  (SELECT COUNT(*) FROM orders WHERE status = 'cancelled') AS cancelled_orders,
  (SELECT COUNT(DISTINCT customer_id) FROM hardware_requirements) AS hardware_requirements,
  (SELECT COUNT(*) FROM customers c WHERE c.status <> 'archived'
     AND NOT EXISTS (SELECT 1 FROM customer_categories cc WHERE cc.customer_id = c.id)) AS uncategorized;
`;

const ready = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
if (!ready) { db.exec(SCHEMA); console.log('[db] initialized:', DB_PATH); }
else { console.log('[db] loaded:', DB_PATH); }

/* ---------------------------- Utilities ---------------------------------- */
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function nowIso() { return new Date().toISOString(); }
function dayInTz(date = new Date(), tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const g = (t) => parts.find(p => p.type === t).value;
  return `${g('year')}${g('month')}${g('day')}`;
}
function normalizePhone(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) { const d = s.slice(1).replace(/\D/g, ''); return d ? '+' + d : null; }
  if (s.startsWith('00')) { const d = s.slice(2).replace(/\D/g, ''); return d ? '+' + d : null; }
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) return '+92' + digits.slice(1);
  if (digits.startsWith('92')) return '+' + digits;
  if (digits.length === 10 && digits.startsWith('3')) return '+92' + digits;
  return '+' + digits;
}
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function logActivity({ customerId = null, orderId = null, actionType, details = null }) {
  db.prepare(`INSERT INTO activity_logs (customer_id, order_id, action_type, details_json)
              VALUES (?, ?, ?, ?)`).run(customerId, orderId, actionType,
    details ? JSON.stringify(details) : null);
}
function generateTrackingId() {
  const prefix = getSetting('tracking_prefix', 'NT');
  const day = dayInTz();
  const existing = db.prepare('SELECT last_seq FROM tracking_counters WHERE day = ?').get(day);
  let seq;
  if (existing) {
    db.prepare('UPDATE tracking_counters SET last_seq = last_seq + 1 WHERE day = ?').run(day);
    seq = existing.last_seq + 1;
  } else {
    db.prepare('INSERT INTO tracking_counters (day, last_seq) VALUES (?, 1)').run(day);
    seq = 1;
  }
  return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
}
function getOrderFull(id) {
  const order = db.prepare(
    `SELECT o.*, c.phone AS customer_phone, c.name AS customer_name, c.whatsapp AS customer_whatsapp
     FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
  ).get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  return order;
}
function recalcSubtotal(orderId) {
  const row = db.prepare('SELECT COALESCE(SUM(line_total_minor),0) AS s FROM order_items WHERE order_id = ?').get(orderId);
  db.prepare('UPDATE orders SET subtotal_minor = ?, updated_at = ? WHERE id = ?').run(row.s, nowIso(), orderId);
  return row.s;
}

/* ---------------------------- Express ------------------------------------ */
const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true, time: nowIso(), db: DB_PATH }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* Dashboard */
app.get('/api/dashboard/stats', (req, res, next) => {
  try {
    const counts = db.prepare('SELECT * FROM v_dashboard_counts').get();
    const recentCustomers = db.prepare(
      'SELECT id, phone, name, created_at FROM customers ORDER BY created_at DESC LIMIT 6').all();
    const recentOrders = db.prepare(
      `SELECT o.id, o.tracking_id, o.status, o.created_at, o.finalized_at,
              c.phone, c.name AS customer_name
       FROM orders o JOIN customers c ON c.id = o.customer_id
       ORDER BY o.created_at DESC LIMIT 6`).all();
    const recentlyFinalized = db.prepare(
      `SELECT o.id, o.tracking_id, o.final_price_minor, o.currency, o.finalized_at,
              c.phone, c.name AS customer_name
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.status = 'completed' ORDER BY o.finalized_at DESC LIMIT 5`).all();
    res.json({ counts, recentCustomers, recentOrders, recentlyFinalized });
  } catch (e) { next(e); }
});

/* Categories */
app.get('/api/categories', (req, res, next) => {
  try { res.json(db.prepare('SELECT * FROM categories ORDER BY name').all()); }
  catch (e) { next(e); }
});

/* Customers */
app.post('/api/customers', (req, res, next) => {
  try {
    const b = req.body || {};
    const phone = (b.phone || '').trim();
    if (!phone) throw httpError(400, 'Phone number is required');
    const norm = normalizePhone(phone);
    if (!norm) throw httpError(400, 'Invalid phone number');
    const existing = db.prepare('SELECT * FROM customers WHERE phone_normalized = ?').get(norm);
    if (existing) return res.status(200).json({ customer: existing, duplicate: true });

    const now = nowIso();
    const whatsapp = b.whatsapp ? String(b.whatsapp).trim() : null;
    const whatsappNorm = whatsapp ? normalizePhone(whatsapp) : null;
    const info = db.prepare(
      `INSERT INTO customers
        (phone, phone_normalized, name, whatsapp, whatsapp_normalized,
         alternate_phone, email, address, city, province, country,
         status, lead_status, lead_source, preferred_contact, notes,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(phone, norm, b.name || null, whatsapp, whatsappNorm,
      b.alternate_phone || null, b.email || null, b.address || null,
      b.city || null, b.province || null, b.country || null,
      b.status || 'active', b.lead_status || null, b.lead_source || null,
      b.preferred_contact || null, b.notes || null, now, now);
    const id = Number(info.lastInsertRowid);
    logActivity({ customerId: id, actionType: 'customer_created', details: { phone: norm } });
    res.status(201).json({ customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(id), duplicate: false });
  } catch (e) { next(e); }
});

app.get('/api/customers', (req, res, next) => {
  try {
    const { category, filter, search, status, from, to } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const where = [], params = [];
    if (status) { where.push('c.status = ?'); params.push(status); }
    else where.push("c.status <> 'archived'");
    if (category) {
      where.push(`EXISTS (SELECT 1 FROM customer_categories cc JOIN categories g ON g.id = cc.category_id
                         WHERE cc.customer_id = c.id AND g.name = ?)`);
      params.push(category);
    }
    if (filter === 'previous') where.push(`EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed')`);
    else if (filter === 'hardware') where.push(`EXISTS (SELECT 1 FROM hardware_requirements h WHERE h.customer_id = c.id)`);
    else if (filter === 'uncategorized') where.push(`NOT EXISTS (SELECT 1 FROM customer_categories cc WHERE cc.customer_id = c.id)`);
    if (search) {
      where.push(`(c.phone LIKE ? OR c.phone_normalized LIKE ? OR c.whatsapp LIKE ?
                   OR c.whatsapp_normalized LIKE ? OR c.name LIKE ?)`);
      const q = `%${search}%`; params.push(q, q, q, q, q);
    }
    if (from) { where.push('c.created_at >= ?'); params.push(from); }
    if (to) { where.push('c.created_at <= ?'); params.push(to + 'T23:59:59.999Z'); }

    const whereSql = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM customers c ${whereSql}`).get(...params).n;
    const rows = db.prepare(
      `SELECT c.*,
        (SELECT GROUP_CONCAT(g.name, ',') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id) AS category_list,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS completed_order_count,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count
       FROM customers c ${whereSql}
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({ rows, total, limit, offset });
  } catch (e) { next(e); }
});

app.get('/api/customers/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) throw httpError(404, 'Customer not found');
    c.categories = db.prepare(
      `SELECT c.id, c.name FROM customer_categories cc JOIN categories c ON c.id = cc.category_id WHERE cc.customer_id = ?`
    ).all(id);
    res.json(c);
  } catch (e) { next(e); }
});

app.patch('/api/customers/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!current) throw httpError(404, 'Customer not found');
    const b = req.body || {};
    const allowed = ['name','whatsapp','alternate_phone','email','address','city','province','country','status','lead_status','lead_source','preferred_contact','notes'];
    const updates = {};
    for (const f of allowed) if (b[f] !== undefined) updates[f] = b[f] === '' ? null : b[f];
    if (b.whatsapp !== undefined) updates.whatsapp_normalized = b.whatsapp ? normalizePhone(b.whatsapp) : null;
    if (b.phone !== undefined && b.phone !== current.phone) {
      const norm = normalizePhone(b.phone);
      if (!norm) throw httpError(400, 'Invalid phone');
      const clash = db.prepare('SELECT id FROM customers WHERE phone_normalized = ? AND id <> ?').get(norm, id);
      if (clash) throw httpError(409, 'Phone already used by another customer');
      updates.phone = b.phone; updates.phone_normalized = norm;
    }
    if (!Object.keys(updates).length) return res.json(current);
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE customers SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
    logActivity({ customerId: id, actionType: 'customer_updated', details: { fields: Object.keys(updates) } });
    res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

app.put('/api/customers/:id/categories', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(id)) throw httpError(404, 'Customer not found');
    const names = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const getCat = db.prepare('SELECT id FROM categories WHERE name = ?');
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM customer_categories WHERE customer_id = ?').run(id);
      const ins = db.prepare('INSERT INTO customer_categories (customer_id, category_id) VALUES (?, ?)');
      for (const n of names) { const c = getCat.get(n); if (c) ins.run(id, c.id); }
    });
    tx();
    logActivity({ customerId: id, actionType: 'categories_updated', details: { categories: names } });
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    c.categories = db.prepare(
      `SELECT c.id, c.name FROM customer_categories cc JOIN categories c ON c.id = cc.category_id WHERE cc.customer_id = ?`
    ).all(id);
    res.json(c);
  } catch (e) { next(e); }
});

app.get('/api/customers/:id/activity', (req, res, next) => {
  try {
    res.json(db.prepare('SELECT * FROM activity_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100').all(Number(req.params.id)));
  } catch (e) { next(e); }
});

/* Hardware */
app.post('/api/customers/:id/hardware', (req, res, next) => {
  try {
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw httpError(404, 'Customer not found');
    const b = req.body || {};
    const now = nowIso();
    const info = db.prepare(
      `INSERT INTO hardware_requirements (customer_id, product_name, brand, model, specifications, quantity, budget_minor, currency, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(cid, b.product_name || null, b.brand || null, b.model || null, b.specifications || null,
      b.quantity ? parseInt(b.quantity, 10) : null,
      b.budget_minor != null ? parseInt(b.budget_minor, 10) : null,
      b.currency || 'PKR', b.notes || null, now, now);
    res.status(201).json(db.prepare('SELECT * FROM hardware_requirements WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});
app.get('/api/customers/:id/hardware', (req, res, next) => {
  try { res.json(db.prepare('SELECT * FROM hardware_requirements WHERE customer_id = ? ORDER BY created_at DESC').all(Number(req.params.id))); }
  catch (e) { next(e); }
});
app.get('/api/hardware', (req, res, next) => {
  try {
    res.json(db.prepare(
      `SELECT h.*, c.phone, c.name AS customer_name, c.whatsapp
       FROM hardware_requirements h JOIN customers c ON c.id = h.customer_id
       ORDER BY h.created_at DESC`).all());
  } catch (e) { next(e); }
});

/* Messages */
app.post('/api/customers/:id/messages', (req, res, next) => {
  try {
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw httpError(404, 'Customer not found');
    const b = req.body || {};
    if (!b.message_text) throw httpError(400, 'Message text is required');
    const info = db.prepare(
      `INSERT INTO customer_messages (customer_id, order_id, source, message_text, message_at, notes, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(cid, b.order_id || null, b.source || 'whatsapp', b.message_text, b.message_at || null, b.notes || null, nowIso());
    res.status(201).json(db.prepare('SELECT * FROM customer_messages WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});
app.get('/api/customers/:id/messages', (req, res, next) => {
  try { res.json(db.prepare('SELECT * FROM customer_messages WHERE customer_id = ? ORDER BY created_at DESC').all(Number(req.params.id))); }
  catch (e) { next(e); }
});

/* Orders */
app.post('/api/customers/:id/orders', (req, res, next) => {
  try {
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw httpError(404, 'Customer not found');
    const b = req.body || {};
    const now = nowIso();
    const info = db.prepare(
      `INSERT INTO orders (customer_id, status, currency, discount_minor, extra_charges_minor,
                           payment_notes, order_notes, product_requirements, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(cid, b.currency || 'PKR', b.discount_minor || 0, b.extra_charges_minor || 0,
      b.payment_notes || null, b.order_notes || null, b.product_requirements || null, now, now);
    const orderId = Number(info.lastInsertRowid);
    logActivity({ customerId: cid, orderId, actionType: 'order_created' });
    res.status(201).json(getOrderFull(orderId));
  } catch (e) { next(e); }
});

app.get('/api/customers/:id/orders', (req, res, next) => {
  try {
    res.json(db.prepare(
      `SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC`).all(Number(req.params.id)));
  } catch (e) { next(e); }
});

app.get('/api/orders', (req, res, next) => {
  try {
    const { status, finalized, progress, search, from, to } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const where = [], params = [];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (finalized === '1') where.push("o.status = 'completed'");
    if (progress === '1') where.push("o.status IN ('draft','confirmed')");
    if (search) {
      where.push(`(o.tracking_id LIKE ? OR CAST(o.id AS TEXT) LIKE ? OR c.phone LIKE ? OR c.name LIKE ?)`);
      const q = `%${search}%`; params.push(q, q, q, q);
    }
    if (from) { where.push('COALESCE(o.finalized_at, o.created_at) >= ?'); params.push(from); }
    if (to) { where.push('COALESCE(o.finalized_at, o.created_at) <= ?'); params.push(to + 'T23:59:59.999Z'); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id ${whereSql}`
    ).get(...params).n;
    const rows = db.prepare(
      `SELECT o.*, c.phone AS customer_phone, c.name AS customer_name, c.whatsapp AS customer_whatsapp,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
        (SELECT GROUP_CONCAT(oi.product_name, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS product_summary
       FROM orders o JOIN customers c ON c.id = o.customer_id ${whereSql}
       ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({ rows, total, limit, offset });
  } catch (e) { next(e); }
});

app.get('/api/orders/:id', (req, res, next) => {
  try {
    const order = getOrderFull(Number(req.params.id));
    if (!order) throw httpError(404, 'Order not found');
    res.json(order);
  } catch (e) { next(e); }
});

app.patch('/api/orders/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw httpError(404, 'Order not found');
    if (order.status === 'completed') throw httpError(400, 'Cannot edit a completed order');
    if (order.status === 'cancelled') throw httpError(400, 'Cannot edit a cancelled order');
    const b = req.body || {};
    const updates = {};
    for (const f of ['currency','payment_notes','order_notes','product_requirements','payment_status','delivery_status'])
      if (b[f] !== undefined) updates[f] = b[f];
    for (const f of ['discount_minor','extra_charges_minor']) if (b[f] !== undefined) {
      const v = parseInt(b[f], 10);
      if (isNaN(v) || v < 0) throw httpError(400, `Invalid ${f}`);
      updates[f] = v;
    }
    if (!Object.keys(updates).length) return res.json(order);
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE orders SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
    logActivity({ customerId: order.customer_id, orderId: id, actionType: 'order_updated' });
    res.json(getOrderFull(id));
  } catch (e) { next(e); }
});

app.post('/api/orders/:id/items', (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw httpError(404, 'Order not found');
    if (order.status === 'completed') throw httpError(400, 'Cannot edit a completed order');
    if (order.status === 'cancelled') throw httpError(400, 'Cannot edit a cancelled order');
    const b = req.body || {};
    if (!b.product_name || !String(b.product_name).trim()) throw httpError(400, 'Product name is required');
    const qty = Math.max(1, parseInt(b.quantity || 1, 10) || 1);
    const unit = Math.max(0, parseInt(b.unit_price_minor || 0, 10) || 0);
    const disc = Math.max(0, parseInt(b.discount_minor || 0, 10) || 0);
    const line = qty * unit - disc;
    if (line < 0) throw httpError(400, 'Line total cannot be negative');
    const now = nowIso();
    const info = db.prepare(
      `INSERT INTO order_items (order_id, product_name, product_sku, description, size_variant,
                                quantity, unit_price_minor, discount_minor, line_total_minor, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(orderId, String(b.product_name).trim(), b.product_sku || null, b.description || null,
      b.size_variant || null, qty, unit, disc, line, now, now);
    recalcSubtotal(orderId);
    res.status(201).json(db.prepare('SELECT * FROM order_items WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

app.delete('/api/orders/:id/items/:itemId', (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw httpError(404, 'Order not found');
    if (order.status === 'completed' || order.status === 'cancelled') throw httpError(400, 'Order is locked');
    db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(Number(req.params.itemId), orderId);
    recalcSubtotal(orderId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/orders/:id/confirm', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'draft') throw httpError(400, 'Only draft orders can be confirmed');
    const now = nowIso();
    db.prepare("UPDATE orders SET status='confirmed', confirmed_at=?, updated_at=? WHERE id=?").run(now, now, id);
    logActivity({ customerId: order.customer_id, orderId: id, actionType: 'order_confirmed' });
    res.json(getOrderFull(id));
  } catch (e) { next(e); }
});

app.post('/api/orders/:id/cancel', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw httpError(404, 'Order not found');
    if (order.status === 'completed') throw httpError(400, 'Cannot cancel a completed order');
    db.prepare("UPDATE orders SET status='cancelled', updated_at=? WHERE id=?").run(nowIso(), id);
    logActivity({ customerId: order.customer_id, orderId: id, actionType: 'order_cancelled' });
    res.json(getOrderFull(id));
  } catch (e) { next(e); }
});

app.post('/api/orders/:id/finalize', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw httpError(404, 'Order not found');
    if (order.status === 'completed') throw httpError(400, 'Order already finalized');
    if (order.status === 'cancelled') throw httpError(400, 'Cannot finalize a cancelled order');
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
    if (!items.length) throw httpError(400, 'Order must have at least one item to finalize');
    const subtotal = items.reduce((s, i) => s + i.line_total_minor, 0);
    const finalPrice = subtotal - order.discount_minor + order.extra_charges_minor;
    if (finalPrice < 0) throw httpError(400, 'Final price cannot be negative');
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    if (!customer) throw httpError(400, 'Customer not found');

    const tx = db.transaction(() => {
      let trackingId = order.tracking_id;
      if (!trackingId) trackingId = generateTrackingId();
      const now = nowIso();
      db.prepare(
        `UPDATE orders SET status='completed', tracking_id=?, finalized_at=?, final_price_minor=?,
          subtotal_minor=?, updated_at=?,
          customer_name_snapshot=COALESCE(customer_name_snapshot,?),
          customer_phone_snapshot=COALESCE(customer_phone_snapshot,?),
          customer_whatsapp_snapshot=COALESCE(customer_whatsapp_snapshot,?),
          shipping_address_snapshot=COALESCE(shipping_address_snapshot,?)
         WHERE id=?`
      ).run(trackingId, now, finalPrice, subtotal, now,
        customer.name, customer.phone, customer.whatsapp, customer.address, id);
      logActivity({ customerId: order.customer_id, orderId: id,
        actionType: 'order_finalized', details: { trackingId, finalPriceMinor: finalPrice } });
      return trackingId;
    });
    const trackingId = tx();
    res.json({ order: getOrderFull(id), trackingId });
  } catch (e) { next(e); }
});

app.get('/api/tracking/:trackingId', (req, res, next) => {
  try {
    const row = db.prepare('SELECT id FROM orders WHERE tracking_id = ?').get(req.params.trackingId);
    if (!row) throw httpError(404, 'Tracking ID not found');
    res.json(getOrderFull(row.id));
  } catch (e) { next(e); }
});

/* Global search */
app.get('/api/search', (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ customers: [], orders: [] });
    const like = `%${q}%`;
    const customers = db.prepare(
      `SELECT id, phone, phone_normalized, whatsapp, name, created_at FROM customers
       WHERE phone LIKE ? OR phone_normalized LIKE ? OR whatsapp LIKE ?
          OR whatsapp_normalized LIKE ? OR name LIKE ?
       ORDER BY created_at DESC LIMIT 20`
    ).all(like, like, like, like, like);
    const orders = db.prepare(
      `SELECT o.id, o.tracking_id, o.status, o.final_price_minor, o.currency,
              o.created_at, o.finalized_at, c.phone, c.name AS customer_name
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.tracking_id LIKE ? OR CAST(o.id AS TEXT) LIKE ? OR c.phone LIKE ? OR c.name LIKE ?
       ORDER BY o.created_at DESC LIMIT 20`
    ).all(like, like, like, like);
    res.json({ customers, orders });
  } catch (e) { next(e); }
});

/* Backup / Restore */
app.get('/api/backups', (req, res, next) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite'))
      .map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, size: st.size, modified: st.mtime.toISOString() }; })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    res.json(files);
  } catch (e) { next(e); }
});

app.post('/api/backup', (req, res, next) => {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${ts}.sqlite`;
    const dest = path.join(BACKUP_DIR, filename);
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    res.json({ filename, path: dest });
  } catch (e) { next(e); }
});

app.post('/api/restore', (req, res, next) => {
  try {
    const filename = req.body?.filename;
    if (!filename) throw httpError(400, 'Filename required');
    const safe = path.basename(filename);
    const src = path.join(BACKUP_DIR, safe);
    if (!fs.existsSync(src)) throw httpError(404, 'Backup not found');

    let probe;
    try {
      probe = new Database(src, { readonly: true });
      const t = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();
      if (!t) throw new Error('Not a compatible backup');
      probe.close();
    } catch (err) { throw httpError(400, 'Invalid or incompatible backup file'); }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safety = path.join(BACKUP_DIR, `pre-restore-${ts}.sqlite`);
    db.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);

    db.close();
    fs.copyFileSync(src, DB_PATH);
    for (const ext of ['-wal', '-shm']) {
      const f = DB_PATH + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* Serve frontend */
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.status(404).send('Not found');
});

/* Error handler */
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[err]', err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

/* Start */
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ✓ Customer CRM running');
  console.log('    http://localhost:' + PORT);
  console.log('    DB: ' + DB_PATH);
  console.log('    Backups: ' + BACKUP_DIR);
  console.log('');
});
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  try { db.close(); } catch (_) {}
  process.exit(0);
});
