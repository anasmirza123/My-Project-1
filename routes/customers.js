const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const {
  httpErr, nowIso, normalizePhone, logActivity
} = require('../utils/helpers');

router.get('/customers', (req, res, next) => {
  try {
    const db = getDb();
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
      where.push(`(c.phone LIKE ? OR c.phone_normalized LIKE ? OR c.whatsapp LIKE ? OR c.name LIKE ?)`);
      const q = `%${search}%`; params.push(q, q, q, q);
    }
    if (from) { where.push('c.created_at >= ?'); params.push(from); }
    if (to) { where.push('c.created_at <= ?'); params.push(to + 'T23:59:59.999Z'); }

    const wsql = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM customers c ${wsql}`).get(...params).n;
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT GROUP_CONCAT(g.name, ',') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id) AS category_list,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS completed_order_count,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count
      FROM customers c ${wsql}
      ORDER BY c.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ rows, total, limit, offset });
  } catch (e) { next(e); }
});

router.get('/customers/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) throw httpErr(404, 'Customer not found');
    c.categories = db.prepare(
      `SELECT g.id, g.name FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = ?`
    ).all(id);
    res.json(c);
  } catch (e) { next(e); }
});

router.post('/customers', (req, res, next) => {
  try {
    const db = getDb();
    const b = req.body || {};
    const phone = (b.phone || '').trim();
    if (!phone) throw httpErr(400, 'Phone number is required');
    const norm = normalizePhone(phone);
    if (!norm) throw httpErr(400, 'Invalid phone number');

    const existing = db.prepare('SELECT * FROM customers WHERE phone_normalized = ?').get(norm);
    if (existing) return res.status(200).json({ customer: existing, duplicate: true });

    const now = nowIso();
    const wa = b.whatsapp ? String(b.whatsapp).trim() : null;
    const waNorm = wa ? normalizePhone(wa) : null;

    const info = db.prepare(`
      INSERT INTO customers
        (phone, phone_normalized, name, whatsapp, whatsapp_normalized,
         alternate_phone, email, address, city, province, country,
         status, lead_status, lead_source, preferred_contact, notes,
         created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      phone, norm, b.name || null, wa, waNorm,
      b.alternate_phone || null, b.email || null, b.address || null,
      b.city || null, b.province || null, b.country || null,
      b.status || 'active', b.lead_status || null, b.lead_source || null,
      b.preferred_contact || null, b.notes || null, now, now
    );

    const id = Number(info.lastInsertRowid);
    logActivity({ customerId: id, actionType: 'customer_created', details: { phone: norm } });
    res.status(201).json({
      customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(id),
      duplicate: false
    });
  } catch (e) { next(e); }
});

router.put('/customers/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!current) throw httpErr(404, 'Customer not found');
    const b = req.body || {};
    const allowed = ['name','whatsapp','alternate_phone','email','address','city','province','country','status','lead_status','lead_source','preferred_contact','notes'];
    const updates = {};
    for (const f of allowed) if (b[f] !== undefined) updates[f] = b[f] === '' ? null : b[f];
    if (b.whatsapp !== undefined) updates.whatsapp_normalized = b.whatsapp ? normalizePhone(b.whatsapp) : null;
    if (b.phone !== undefined && b.phone !== current.phone) {
      const norm = normalizePhone(b.phone);
      if (!norm) throw httpErr(400, 'Invalid phone');
      const clash = db.prepare('SELECT id FROM customers WHERE phone_normalized = ? AND id <> ?').get(norm, id);
      if (clash) throw httpErr(409, 'Phone already used by another customer');
      updates.phone = b.phone; updates.phone_normalized = norm;
    }
    if (!Object.keys(updates).length) return res.json(current);
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map(k => k + ' = ?').join(', ');
    db.prepare(`UPDATE customers SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
    logActivity({ customerId: id, actionType: 'customer_updated', details: { fields: Object.keys(updates) } });
    res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

router.patch('/customers/:id', (req, res, next) => {
  // Alias PATCH to PUT for compatibility
  router.handle({ ...req, method: 'PUT', url: '/customers/' + req.params.id }, res, next);
});

router.put('/customers/:id/categories', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(id)) throw httpErr(404, 'Customer not found');
    const names = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const getCat = db.prepare('SELECT id FROM categories WHERE name = ?');
    db.transaction(() => {
      db.prepare('DELETE FROM customer_categories WHERE customer_id = ?').run(id);
      const ins = db.prepare('INSERT INTO customer_categories (customer_id, category_id) VALUES (?, ?)');
      for (const n of names) { const c = getCat.get(n); if (c) ins.run(id, c.id); }
    })();
    logActivity({ customerId: id, actionType: 'categories_updated', details: { categories: names } });
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    c.categories = db.prepare(
      `SELECT g.id, g.name FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = ?`
    ).all(id);
    res.json(c);
  } catch (e) { next(e); }
});

router.get('/customers/:id/activity', (req, res, next) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM activity_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(Number(req.params.id)));
  } catch (e) { next(e); }
});

router.get('/customers/:id/orders', (req, res, next) => {
  try {
    const db = getDb();
    res.json(db.prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC
    `).all(Number(req.params.id)));
  } catch (e) { next(e); }
});

router.post('/customers/:id/orders', (req, res, next) => {
  try {
    const db = getDb();
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) throw httpErr(404, 'Customer not found');
    const b = req.body || {};
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO orders (customer_id, status, currency, discount_minor, extra_charges_minor,
                          payment_notes, order_notes, product_requirements, created_at, updated_at)
      VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cid, b.currency || 'PKR', b.discount_minor || 0, b.extra_charges_minor || 0,
      b.payment_notes || null, b.order_notes || null, b.product_requirements || null, now, now);
    const orderId = Number(info.lastInsertRowid);
    logActivity({ customerId: cid, orderId, actionType: 'order_created' });
    res.status(201).json({ id: orderId, message: 'Order created' });
  } catch (e) { next(e); }
});

module.exports = router;
