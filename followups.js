// Follow-ups / Next Visit + purchase history. Registered by server.js; schema applied by runMigrations().
export const FOLLOWUP_SCHEMA = `
CREATE TABLE IF NOT EXISTS follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id INTEGER REFERENCES orders(id) ON DELETE RESTRICT,
  follow_up_date TEXT NOT NULL, follow_up_time TEXT,
  type TEXT NOT NULL DEFAULT 'Next Visit', purpose TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','rescheduled','completed','cancelled')),
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_followups_status_date ON follow_ups(status, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_followups_customer ON follow_ups(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_followup_active ON follow_ups(customer_id, COALESCE(order_id,0), type, follow_up_date) WHERE status IN ('scheduled','rescheduled');
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (2, 'follow-ups and purchase history');`;
export const FOLLOWUP_TYPES = ['Next Visit','New Order','Payment Collection','Product Requirement','Customer Check-in','Delivery Follow-up','Other'];
const ACTIVE = "f.status IN ('scheduled','rescheduled')";
export const todayKarachi = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const validTime = (s) => s == null || s === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function registerFollowups(app, db, { httpError, logActivity, calcFin }) {
  const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };
  const SEL = `SELECT f.*, c.name AS customer_name, c.phone AS customer_phone, c.whatsapp AS customer_whatsapp,
    o.tracking_id, o.finalized_at AS order_completed_at FROM follow_ups f JOIN customers c ON c.id = f.customer_id LEFT JOIN orders o ON o.id = f.order_id`;
  const stateOf = (f, t) => (f.status === 'completed' || f.status === 'cancelled') ? f.status : f.follow_up_date < t ? 'overdue' : f.follow_up_date === t ? 'due_today' : 'upcoming';
  const enrich = (f, t) => { const fin = f.order_id ? calcFin(f.order_id, db) : null;
    return { ...f, state: stateOf(f, t), amount_paid_minor: fin ? fin.netAmountReceived : null, balance_minor: fin ? fin.remainingBalance : null }; };
  const getOne = (id) => { const f = db.prepare(SEL + ' WHERE f.id = ?').get(id); if (!f) throw httpError(404, 'Follow-up not found'); return enrich(f, todayKarachi()); };
  const idOf = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid id'); return id; };
  const activeOne = (id) => { const f = getOne(id); if (f.status === 'completed' || f.status === 'cancelled') throw httpError(409, `Follow-up is already ${f.status}`); return f; };
  const touch = (id, sql, ...p) => db.prepare(`UPDATE follow_ups SET ${sql}, updated_at = ? WHERE id = ?`).run(...p, new Date().toISOString(), id);
  const dateTime = (b) => { if (!validDate(b.follow_up_date)) throw httpError(400, 'follow_up_date must be a real date (YYYY-MM-DD)'); if (!validTime(b.follow_up_time)) throw httpError(400, 'follow_up_time must be HH:MM'); };

  app.get('/api/followups', wrap((req, res) => {
    const t = todayKarachi(), q = req.query, w = [], p = [];
    const st = q.state || 'active';
    if (st === 'active') w.push(ACTIVE);
    else if (st === 'due_today') { w.push(ACTIVE, 'f.follow_up_date = ?'); p.push(t); }
    else if (st === 'overdue') { w.push(ACTIVE, 'f.follow_up_date < ?'); p.push(t); }
    else if (st === 'upcoming') { w.push(ACTIVE, 'f.follow_up_date > ?'); p.push(t); }
    else if (st === 'completed' || st === 'cancelled') { w.push('f.status = ?'); p.push(st); }
    else if (st !== 'all') throw httpError(400, 'Invalid state filter');
    if (q.customer_id) { w.push('f.customer_id = ?'); p.push(Number(q.customer_id)); }
    if (q.search) { const s = `%${q.search}%`; w.push('(c.name LIKE ? OR c.phone LIKE ? OR o.tracking_id LIKE ? OR f.purpose LIKE ?)'); p.push(s, s, s, s); }
    const W = w.length ? ' WHERE ' + w.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM follow_ups f JOIN customers c ON c.id = f.customer_id LEFT JOIN orders o ON o.id = f.order_id${W}`).get(...p).n;
    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200), offset = Math.max(parseInt(q.offset || '0', 10) || 0, 0);
    const rows = db.prepare(`${SEL}${W} ORDER BY f.follow_up_date ASC, COALESCE(f.follow_up_time,'99:99') ASC, f.id ASC LIMIT ? OFFSET ?`).all(...p, limit, offset).map((f) => enrich(f, t));
    res.json({ rows, total, limit, offset, today: t });
  }));

  app.post('/api/followups', wrap((req, res) => {
    const b = req.body || {}, cid = Number(b.customer_id);
    if (!Number.isInteger(cid) || cid <= 0) throw httpError(400, 'customer_id is required');
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw httpError(404, 'Customer not found');
    let oid = null;
    if (b.order_id != null && b.order_id !== '') { oid = Number(b.order_id);
      const o = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(oid);
      if (!o) throw httpError(404, 'Order not found'); if (o.customer_id !== cid) throw httpError(400, 'Order does not belong to this customer'); }
    dateTime(b);
    const type = b.type || 'Next Visit'; if (!FOLLOWUP_TYPES.includes(type)) throw httpError(400, 'Invalid follow-up type');
    const dup = db.prepare(`SELECT id FROM follow_ups f WHERE customer_id = ? AND COALESCE(order_id,0) = ? AND type = ? AND follow_up_date = ? AND ${ACTIVE}`).get(cid, oid || 0, type, b.follow_up_date);
    if (dup) throw Object.assign(httpError(409, 'An active follow-up of this type already exists for this customer, order and date'), { existingId: dup.id });
    const r = db.prepare('INSERT INTO follow_ups (customer_id, order_id, follow_up_date, follow_up_time, type, purpose, notes) VALUES (?,?,?,?,?,?,?)')
      .run(cid, oid, b.follow_up_date, b.follow_up_time || null, type, String(b.purpose || '').slice(0, 500) || null, String(b.notes || '').slice(0, 2000) || null);
    logActivity({ customerId: cid, orderId: oid, actionType: 'followup_created', details: { type, date: b.follow_up_date } });
    res.status(201).json(getOne(Number(r.lastInsertRowid)));
  }));

  app.patch('/api/followups/:id', wrap((req, res) => {
    const id = idOf(req), f = activeOne(id), b = req.body || {};
    const m = { follow_up_date: b.follow_up_date ?? f.follow_up_date, follow_up_time: b.follow_up_time ?? f.follow_up_time }; dateTime(m);
    const type = b.type ?? f.type; if (!FOLLOWUP_TYPES.includes(type)) throw httpError(400, 'Invalid follow-up type');
    touch(id, 'follow_up_date = ?, follow_up_time = ?, type = ?, purpose = ?, notes = ?', m.follow_up_date, m.follow_up_time || null, type, b.purpose ?? f.purpose, b.notes ?? f.notes);
    res.json(getOne(id));
  }));
  app.post('/api/followups/:id/reschedule', wrap((req, res) => {
    const id = idOf(req), f = activeOne(id), b = req.body || {}; dateTime(b);
    touch(id, "follow_up_date = ?, follow_up_time = ?, status = 'rescheduled', reschedule_count = reschedule_count + 1", b.follow_up_date, b.follow_up_time || null);
    logActivity({ customerId: f.customer_id, orderId: f.order_id, actionType: 'followup_rescheduled', details: { from: f.follow_up_date, to: b.follow_up_date } });
    res.json(getOne(id));
  }));
  app.post('/api/followups/:id/complete', wrap((req, res) => {
    const id = idOf(req), f = activeOne(id), now = new Date().toISOString();
    touch(id, "status = 'completed', completed_at = ?", now);
    logActivity({ customerId: f.customer_id, orderId: f.order_id, actionType: 'followup_completed', details: { type: f.type } });
    res.json(getOne(id));
  }));
  app.post('/api/followups/:id/cancel', wrap((req, res) => {
    const id = idOf(req), f = activeOne(id); touch(id, "status = 'cancelled'");
    logActivity({ customerId: f.customer_id, orderId: f.order_id, actionType: 'followup_cancelled', details: { type: f.type } });
    res.json(getOne(id));
  }));

  app.get('/api/dashboard/followups', wrap((req, res) => {
    const t = todayKarachi(), n = (cond, ...p) => db.prepare(`SELECT COUNT(*) AS n FROM follow_ups f WHERE ${ACTIVE} AND ${cond}`).get(...p).n;
    const list = (cond) => db.prepare(`${SEL} WHERE ${ACTIVE} AND ${cond} ORDER BY f.follow_up_date, f.id LIMIT 5`).all(t).map((f) => enrich(f, t));
    res.json({ today: t, due_today: n('f.follow_up_date = ?', t), overdue: n('f.follow_up_date < ?', t), upcoming: n('f.follow_up_date > ?', t),
      customers_needing_followup: db.prepare(`SELECT COUNT(DISTINCT customer_id) AS n FROM follow_ups f WHERE ${ACTIVE} AND f.follow_up_date <= ?`).get(t).n,
      lists: { due_today: list('f.follow_up_date = ?'), overdue: list('f.follow_up_date < ?') } });
  }));

  // Purchase history = completed orders, derived from orders (one row per order, so it can never be counted twice).
  function purchases(req, res) {
    const q = req.query, w = ["o.status = 'completed'"], p = [];
    const cid = req.params.id || q.customer_id; if (cid) { w.push('o.customer_id = ?'); p.push(Number(cid)); }
    if (q.search) { const s = `%${q.search}%`; w.push('(COALESCE(o.customer_name_snapshot,c.name) LIKE ? OR COALESCE(o.customer_phone_snapshot,c.phone) LIKE ? OR o.tracking_id LIKE ?)'); p.push(s, s, s); }
    if (q.from) { w.push('substr(o.finalized_at,1,10) >= ?'); p.push(q.from); } if (q.to) { w.push('substr(o.finalized_at,1,10) <= ?'); p.push(q.to); }
    const W = ' WHERE ' + w.join(' AND '), base = 'FROM orders o JOIN customers c ON c.id = o.customer_id';
    const total = db.prepare(`SELECT COUNT(*) AS n ${base}${W}`).get(...p).n;
    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200), offset = Math.max(parseInt(q.offset || '0', 10) || 0, 0);
    const rows = db.prepare(`SELECT o.id, o.tracking_id, o.customer_id, o.finalized_at, o.created_at, COALESCE(o.customer_name_snapshot,c.name) AS customer_name, COALESCE(o.customer_phone_snapshot,c.phone) AS customer_phone,
      (SELECT GROUP_CONCAT(product_name, ', ') FROM order_items WHERE order_id = o.id) AS products ${base}${W} ORDER BY o.finalized_at DESC, o.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset).map((o) => {
      const f = calcFin(o.id, db);
      return { order_id: o.id, tracking_id: o.tracking_id, customer_id: o.customer_id, customer_name: o.customer_name, customer_phone: o.customer_phone, products: o.products || '—',
        purchase_date: o.created_at, completed_at: o.finalized_at, sale_minor: f.totalSaleAmount, received_minor: f.netAmountReceived, balance_minor: f.remainingBalance,
        payment_status: f.calculatedPaymentStatus, cost_minor: f.totalPurchaseCost, profit_minor: f.estimatedGrossProfit }; });
    res.json({ rows, total, limit, offset });
  }
  app.get('/api/purchases', wrap(purchases));
  app.get('/api/customers/:id/purchases', wrap(purchases));
}
