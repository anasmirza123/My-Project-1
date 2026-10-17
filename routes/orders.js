const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const {
  httpErr, nowIso, logActivity, logOrderStatus,
  generateTrackingId, getPaymentsSummary, recalcSubtotal
} = require('../utils/helpers');

function buildFullOrder(orderId) {
  const db = getDb();
  const o = db.prepare(`
    SELECT o.*, c.phone AS customer_phone, c.name AS customer_name,
           c.whatsapp AS customer_whatsapp, c.address AS customer_address, c.city AS customer_city
    FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?
  `).get(orderId);
  if (!o) return null;
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
  o.payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY paid_at DESC').all(orderId);
  o.refunds = db.prepare('SELECT * FROM refunds WHERE order_id = ? ORDER BY refunded_at DESC').all(orderId);
  o.expenses = db.prepare('SELECT * FROM order_expenses WHERE order_id = ? ORDER BY id').all(orderId);
  o.payment_summary = getPaymentsSummary(orderId);
  o.status_history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC').all(orderId);

  let costKnown = 0, anyMissing = false;
  o.items.forEach(it => {
    if (it.cost_minor != null) costKnown += it.cost_minor * it.quantity;
    else anyMissing = true;
  });
  o.cost_minor = anyMissing && o.items.length ? null : costKnown;
  o.cost_complete = !anyMissing && o.items.length > 0;

  const saleNet = o.subtotal_minor - o.discount_minor + o.extra_charges_minor;
  o.sale_net_minor = saleNet;
  const totalExpenses = o.expenses.reduce((s, e) => s + e.amount_minor, 0);
  o.total_expenses_minor = totalExpenses;

  if (!anyMissing && o.items.length) {
    o.gross_profit_minor = saleNet - costKnown;
    o.net_profit_minor = saleNet - costKnown - totalExpenses;
    o.margin_pct = saleNet > 0 ? Math.round((o.net_profit_minor / saleNet) * 10000) / 100 : null;
  } else {
    o.gross_profit_minor = null;
    o.net_profit_minor = null;
    o.margin_pct = null;
  }

  o.followups = db.prepare('SELECT * FROM followups WHERE order_id = ? ORDER BY due_date ASC').all(orderId);
  return o;
}

router.get('/orders', (req, res, next) => {
  try {
    const db = getDb();
    const { status, search, from, to } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const where = [], params = [];

    if (status) { where.push('o.status = ?'); params.push(status); }
    if (search) {
      where.push(`(o.tracking_id LIKE ? OR CAST(o.id AS TEXT) LIKE ? OR c.phone LIKE ? OR c.name LIKE ?)`);
      const q = `%${search}%`; params.push(q, q, q, q);
    }
    if (from) { where.push('COALESCE(o.completed_at, o.created_at) >= ?'); params.push(from); }
    if (to) { where.push('COALESCE(o.completed_at, o.created_at) <= ?'); params.push(to + 'T23:59:59.999Z'); }

    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id ${wsql}`
    ).get(...params).n;

    const rows = db.prepare(`
      SELECT o.*, c.phone AS customer_phone, c.name AS customer_name,
             c.address AS customer_address,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
        (SELECT GROUP_CONCAT(oi.product_name, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS product_summary,
        (SELECT COALESCE(SUM(p.amount_minor),0) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed') AS paid_minor,
        (SELECT COALESCE(SUM(r.amount_minor),0) FROM refunds r WHERE r.order_id = o.id) AS refunded_minor,
        (SELECT COALESCE(SUM(oi.cost_minor * oi.quantity),0) FROM order_items oi WHERE oi.order_id = o.id AND oi.cost_minor IS NOT NULL) AS cost_known_minor,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.cost_minor IS NULL) AS missing_cost_count
      FROM orders o JOIN customers c ON c.id = o.customer_id ${wsql}
      ORDER BY o.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    rows.forEach(r => {
      const final = r.final_price_minor != null
        ? r.final_price_minor
        : (r.subtotal_minor - r.discount_minor + r.extra_charges_minor);
      const netPaid = r.paid_minor - r.refunded_minor;
      r.balance_minor = final - netPaid;
      if (netPaid <= 0) r.payment_status = 'unpaid';
      else if (netPaid < final) r.payment_status = 'partial';
      else if (netPaid === final) r.payment_status = 'paid';
      else r.payment_status = 'overpaid';
      r.cost_minor = r.missing_cost_count > 0 ? null : r.cost_known_minor;
    });

    res.json({ rows, total, limit, offset });
  } catch (e) { next(e); }
});

router.get('/orders/completed', (req, res, next) => {
  try {
    const db = getDb();
    const { search } = req.query;
    const where = ["o.status = 'completed'"], params = [];
    if (search) {
      where.push('(o.tracking_id LIKE ? OR c.phone LIKE ? OR c.name LIKE ?)');
      const q = `%${search}%`; params.push(q, q, q);
    }
    const wsql = 'WHERE ' + where.join(' AND ');
    const rows = db.prepare(`
      SELECT o.*, c.phone AS customer_phone, c.name AS customer_name,
        (SELECT COALESCE(SUM(p.amount_minor),0) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed') AS paid_minor,
        (SELECT COALESCE(SUM(r.amount_minor),0) FROM refunds r WHERE r.order_id = o.id) AS refunded_minor,
        (SELECT COALESCE(SUM(oi.cost_minor * oi.quantity),0) FROM order_items oi WHERE oi.order_id = o.id AND oi.cost_minor IS NOT NULL) AS cost_known_minor,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.cost_minor IS NULL) AS missing_cost_count
      FROM orders o JOIN customers c ON c.id = o.customer_id ${wsql}
      ORDER BY o.completed_at DESC LIMIT 500
    `).all(...params);
    rows.forEach(r => {
      r.balance_minor = r.final_price_minor - (r.paid_minor - r.refunded_minor);
      r.cost_minor = r.missing_cost_count > 0 ? null : r.cost_known_minor;
      r.profit_minor = r.cost_minor != null ? (r.final_price_minor - r.cost_minor) : null;
    });
    res.json({ rows });
  } catch (e) { next(e); }
});

router.get('/orders/:id', (req, res, next) => {
  try {
    const o = buildFullOrder(Number(req.params.id));
    if (!o) throw httpErr(404, 'Order not found');
    res.json(o);
  } catch (e) { next(e); }
});

router.post('/orders', (req, res, next) => {
  try {
    const db = getDb();
    const b = req.body || {};
    if (!b.customer_id) throw httpErr(400, 'customer_id required');
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(b.customer_id)) throw httpErr(404, 'Customer not found');
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO orders (customer_id, status, currency, discount_minor, extra_charges_minor,
                          payment_notes, order_notes, product_requirements, created_at, updated_at)
      VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.customer_id, b.currency || 'PKR', b.discount_minor || 0, b.extra_charges_minor || 0,
      b.payment_notes || null, b.order_notes || null, b.product_requirements || null, now, now);
    const orderId = Number(info.lastInsertRowid);
    logActivity({ customerId: b.customer_id, orderId, actionType: 'order_created' });
    res.status(201).json(buildFullOrder(orderId));
  } catch (e) { next(e); }
});

router.put('/orders/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status === 'completed') throw httpErr(400, 'Completed order is locked');
    if (o.status === 'cancelled') throw httpErr(400, 'Cancelled order is locked');
    const b = req.body || {};
    const updates = {};
    for (const f of ['currency','payment_notes','order_notes','product_requirements','delivery_status'])
      if (b[f] !== undefined) updates[f] = b[f];
    for (const f of ['discount_minor','extra_charges_minor']) if (b[f] !== undefined) {
      const v = parseInt(b[f], 10);
      if (isNaN(v) || v < 0) throw httpErr(400, 'Invalid ' + f);
      updates[f] = v;
    }
    if (!Object.keys(updates).length) return res.json(buildFullOrder(id));
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map(k => k + ' = ?').join(', ');
    db.prepare(`UPDATE orders SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
    res.json(buildFullOrder(id));
  } catch (e) { next(e); }
});

router.patch('/orders/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status === 'completed') throw httpErr(400, 'Completed order is locked');
    if (o.status === 'cancelled') throw httpErr(400, 'Cancelled order is locked');
    const b = req.body || {};
    const updates = {};
    for (const f of ['currency','payment_notes','order_notes','product_requirements','delivery_status'])
      if (b[f] !== undefined) updates[f] = b[f];
    for (const f of ['discount_minor','extra_charges_minor']) if (b[f] !== undefined) {
      const v = parseInt(b[f], 10);
      if (isNaN(v) || v < 0) throw httpErr(400, 'Invalid ' + f);
      updates[f] = v;
    }
    if (!Object.keys(updates).length) return res.json(buildFullOrder(id));
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map(k => k + ' = ?').join(', ');
    db.prepare(`UPDATE orders SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
    res.json(buildFullOrder(id));
  } catch (e) { next(e); }
});

router.post('/orders/:id/items', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(oid);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status === 'completed' || o.status === 'cancelled') throw httpErr(400, 'Order locked');
    const b = req.body || {};
    if (!b.product_name || !String(b.product_name).trim()) throw httpErr(400, 'Product name required');
    const qty = Math.max(1, parseInt(b.quantity || 1, 10) || 1);
    const unit = Math.max(0, parseInt(b.unit_price_minor || 0, 10) || 0);
    const disc = Math.max(0, parseInt(b.discount_minor || 0, 10) || 0);
    const cost = b.cost_minor != null && b.cost_minor !== '' ? Math.max(0, parseInt(b.cost_minor, 10)) : null;
    const line = qty * unit - disc;
    if (line < 0) throw httpErr(400, 'Line total cannot be negative');
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO order_items (order_id, product_name, product_sku, description, size_variant,
                                quantity, unit_price_minor, cost_minor, discount_minor, line_total_minor, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(oid, String(b.product_name).trim(), b.product_sku || null, b.description || null,
      b.size_variant || null, qty, unit, cost, disc, line, now, now);
    recalcSubtotal(oid);
    res.status(201).json(db.prepare('SELECT * FROM order_items WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.patch('/orders/:id/items/:itemId', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    const iid = Number(req.params.itemId);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(oid);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status === 'completed' || o.status === 'cancelled') throw httpErr(400, 'Order locked');
    const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(iid, oid);
    if (!item) throw httpErr(404, 'Item not found');
    const b = req.body || {};
    const updates = {};
    if (b.cost_minor !== undefined) {
      updates.cost_minor = b.cost_minor == null || b.cost_minor === '' ? null : Math.max(0, parseInt(b.cost_minor, 10));
    }
    if (b.quantity !== undefined) {
      const q = Math.max(1, parseInt(b.quantity, 10) || 1);
      updates.quantity = q;
      updates.line_total_minor = q * item.unit_price_minor - item.discount_minor;
    }
    if (b.unit_price_minor !== undefined) {
      const u = Math.max(0, parseInt(b.unit_price_minor, 10) || 0);
      updates.unit_price_minor = u;
      updates.line_total_minor = item.quantity * u - item.discount_minor;
    }
    if (!Object.keys(updates).length) return res.json(item);
    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map(k => k + ' = ?').join(', ');
    db.prepare(`UPDATE order_items SET ${setSql} WHERE id = ?`).run(...Object.values(updates), iid);
    recalcSubtotal(oid);
    res.json(db.prepare('SELECT * FROM order_items WHERE id = ?').get(iid));
  } catch (e) { next(e); }
});

router.delete('/orders/:id/items/:itemId', (req, res, next) => {
  try {
    const db = getDb();
    const oid = Number(req.params.id);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(oid);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status === 'completed' || o.status === 'cancelled') throw httpErr(400, 'Order locked');
    db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(Number(req.params.itemId), oid);
    recalcSubtotal(oid);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/orders/:id/confirm', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status !== 'draft') throw httpErr(400, 'Only draft can be confirmed');
    const now = nowIso();
    db.prepare("UPDATE orders SET status='confirmed', confirmed_at=?, updated_at=? WHERE id=?").run(now, now, id);
    logOrderStatus(id, 'draft', 'confirmed');
    logActivity({ customerId: o.customer_id, orderId: id, actionType: 'order_confirmed' });
    res.json(buildFullOrder(id));
  } catch (e) { next(e); }
});

router.post('/orders/:id/cancel', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status === 'completed') throw httpErr(400, 'Cannot cancel completed');
    db.prepare("UPDATE orders SET status='cancelled', updated_at=? WHERE id=?").run(nowIso(), id);
    logOrderStatus(id, o.status, 'cancelled');
    logActivity({ customerId: o.customer_id, orderId: id, actionType: 'order_cancelled' });
    res.json(buildFullOrder(id));
  } catch (e) { next(e); }
});

router.post('/orders/:id/complete', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw httpErr(404, 'Order not found');
    if (o.status === 'completed') throw httpErr(400, 'Already completed');
    if (o.status === 'cancelled') throw httpErr(400, 'Cannot complete cancelled');
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
    if (!items.length) throw httpErr(400, 'Add at least one item');
    const subtotal = items.reduce((s, i) => s + i.line_total_minor, 0);
    const finalPrice = subtotal - o.discount_minor + o.extra_charges_minor;
    if (finalPrice < 0) throw httpErr(400, 'Final price cannot be negative');
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(o.customer_id);
    if (!cust) throw httpErr(400, 'Customer missing');

    const tx = db.transaction(() => {
      let trackingId = o.tracking_id || generateTrackingId();
      const now = nowIso();
      db.prepare(`
        UPDATE orders SET status='completed', tracking_id=?, finalized_at=COALESCE(finalized_at,?),
          completed_at=?, final_price_minor=?, subtotal_minor=?, updated_at=?,
          customer_name_snapshot=COALESCE(customer_name_snapshot,?),
          customer_phone_snapshot=COALESCE(customer_phone_snapshot,?),
          customer_whatsapp_snapshot=COALESCE(customer_whatsapp_snapshot,?),
          shipping_address_snapshot=COALESCE(shipping_address_snapshot,?)
        WHERE id=?
      `).run(trackingId, now, now, finalPrice, subtotal, now,
        cust.name, cust.phone, cust.whatsapp, cust.address, id);
      logOrderStatus(id, o.status, 'completed');
      logActivity({ customerId: o.customer_id, orderId: id, actionType: 'order_completed',
        details: { trackingId, finalPriceMinor: finalPrice } });
      return trackingId;
    });
    const trackingId = tx();
    res.json({ order: buildFullOrder(id), trackingId });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.buildFullOrder = buildFullOrder;
