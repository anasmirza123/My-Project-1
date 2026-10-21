const { getDb } = require('../db');
const { HttpError, bad, notFound } = require('../middleware/error');
const { parseMoney } = require('../utils/money');
const { nowIso, localDayStartIso, localDayEndIso } = require('../utils/datetime');
const { logActivity } = require('./activity');
const { getSettings } = require('./settings');
const { nextTrackingId } = require('./tracking');
const { clean, likeEscape, paging } = require('./util');

const PAYMENT = ['unpaid', 'partial', 'paid'];
const DELIVERY = ['pending', 'dispatched', 'delivered'];

function money(v, label) {
  try { return parseMoney(v); } catch { throw bad(`${label} must be a number like 1500 or 1500.50.`); }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) throw bad('items must be a list.');
  return items.map((it, i) => {
    const name = clean(it.product_name);
    if (!name) throw bad(`Item ${i + 1}: product name is required.`);
    const qtyRaw = it.quantity === undefined || it.quantity === '' ? 1 : it.quantity;
    if (!/^\d+$/.test(String(qtyRaw)) || Number(qtyRaw) < 1) throw bad(`Item ${i + 1}: quantity must be a whole number of 1 or more.`);
    const quantity = Number(qtyRaw);
    const unit = money(it.unit_price, `Item ${i + 1}: unit price`);
    const discount = money(it.discount, `Item ${i + 1}: discount`);
    const line = quantity * unit - discount;
    if (line < 0) throw bad(`Item ${i + 1}: discount is larger than the line amount.`);
    return { product_name: name, product_sku: clean(it.product_sku), description: clean(it.description),
      size_variant: clean(it.size_variant), quantity, unit_price_minor: unit, discount_minor: discount, line_total_minor: line };
  });
}

function writeItems(db, orderId, items) {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  const ins = db.prepare(`INSERT INTO order_items(order_id, product_name, product_sku, description, size_variant,
    quantity, unit_price_minor, discount_minor, line_total_minor) VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const it of items) ins.run(orderId, it.product_name, it.product_sku, it.description, it.size_variant,
    it.quantity, it.unit_price_minor, it.discount_minor, it.line_total_minor);
  const subtotal = items.reduce((s, it) => s + it.line_total_minor, 0);
  db.prepare('UPDATE orders SET subtotal_minor = ? WHERE id = ?').run(subtotal, orderId);
}

const totalOf = (o) => o.subtotal_minor - o.discount_minor + o.extra_charges_minor;

function createOrder(customerId, body = {}) {
  const db = getDb(); const settings = getSettings();
  if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw notFound('Customer not found');
  const items = body.items ? normalizeItems(body.items) : [];
  const discount = money(body.discount, 'Order discount');
  const extra = money(body.additional_charges, 'Additional charges');
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO orders(customer_id, currency, discount_minor, extra_charges_minor, order_notes,
      product_requirements, shipping_address_snapshot, payment_notes) VALUES (?,?,?,?,?,?,?,?)`)
      .run(customerId, clean(body.currency) || settings.default_currency, discount, extra, clean(body.order_notes),
        clean(body.product_requirements), clean(body.shipping_address), clean(body.payment_notes));
    writeItems(db, r.lastInsertRowid, items);
    logActivity(db, { customerId, orderId: r.lastInsertRowid, type: 'order_created' });
    return Number(r.lastInsertRowid);
  })();
  return getOrder(id);
}

function getOrder(id) {
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw notFound('Order not found');
  return hydrate(db, o);
}
function getOrderByTracking(tid) {
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE tracking_id = ? COLLATE NOCASE').get(String(tid).trim());
  if (!o) throw notFound('No order with that tracking ID');
  return hydrate(db, o);
}
function hydrate(db, o) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id);
  const customer = db.prepare('SELECT id, name, phone, whatsapp, address, city FROM customers WHERE id = ?').get(o.customer_id);
  const messages = db.prepare('SELECT * FROM customer_messages WHERE order_id = ? ORDER BY COALESCE(message_at, created_at) DESC').all(o.id);
  return { ...o, total_minor: totalOf(o), items, customer, messages };
}

function updateOrder(id, body) {
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw notFound('Order not found');
  if (!['draft', 'confirmed'].includes(o.status)) throw new HttpError(409, `A ${o.status} order can no longer be edited.`, 'LOCKED');
  const set = {};
  if (body.order_notes !== undefined) set.order_notes = clean(body.order_notes);
  if (body.product_requirements !== undefined) set.product_requirements = clean(body.product_requirements);
  if (body.payment_notes !== undefined) set.payment_notes = clean(body.payment_notes);
  if (body.shipping_address !== undefined) set.shipping_address_snapshot = clean(body.shipping_address);
  if (body.currency !== undefined) set.currency = clean(body.currency) || o.currency;
  if (body.discount !== undefined) set.discount_minor = money(body.discount, 'Order discount');
  if (body.additional_charges !== undefined) set.extra_charges_minor = money(body.additional_charges, 'Additional charges');
  if (body.payment_status !== undefined) {
    if (!PAYMENT.includes(body.payment_status)) throw bad('Unknown payment status.');
    set.payment_status = body.payment_status;
  }
  const items = body.items !== undefined ? normalizeItems(body.items) : null;
  db.transaction(() => {
    const keys = Object.keys(set);
    if (keys.length) db.prepare(`UPDATE orders SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), id);
    if (items) writeItems(db, id, items);
    const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (totalOf(fresh) < 0) throw bad('Discount is larger than the order amount.');
    db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    logActivity(db, { customerId: o.customer_id, orderId: id, type: 'order_updated', details: { fields: [...keys, ...(items ? ['items'] : [])] } });
  })();
  return getOrder(id);
}

function confirmOrder(id) {
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw notFound('Order not found');
  if (o.status !== 'draft') throw new HttpError(409, `Only a draft can be confirmed (this one is ${o.status}).`, 'BAD_STATE');
  const n = db.prepare('SELECT COUNT(*) n FROM order_items WHERE order_id = ?').get(id).n;
  if (!n) throw bad('Add at least one product before confirming.');
  db.transaction(() => {
    const now = nowIso();
    db.prepare(`UPDATE orders SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
    logActivity(db, { customerId: o.customer_id, orderId: id, type: 'order_confirmed' });
  })();
  return getOrder(id);
}

function finalizeOrder(id, body = {}) {
  if (body.confirm !== true) throw bad('Finalizing must be confirmed explicitly.', 'NOT_CONFIRMED');
  const db = getDb(); const settings = getSettings();
  const result = db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw notFound('Order not found');
    if (o.status === 'completed') throw new HttpError(409, `Already finalized as ${o.tracking_id}.`, 'ALREADY_FINALIZED', { tracking_id: o.tracking_id });
    if (o.status === 'cancelled') throw new HttpError(409, 'A cancelled order cannot be finalized.', 'BAD_STATE');
    const n = db.prepare('SELECT COUNT(*) n FROM order_items WHERE order_id = ?').get(id).n;
    if (!n) throw bad('Add at least one product before finalizing.');
    const total = totalOf(o);
    if (total <= 0) throw bad('The final price must be greater than zero.');
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(o.customer_id);
    const now = new Date();
    const tracking = nextTrackingId(db, now, settings);
    const iso = now.toISOString();
    db.prepare(`UPDATE orders SET status = 'completed', tracking_id = ?, final_price_minor = ?, finalized_at = ?,
        confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?,
        customer_name_snapshot = ?, customer_phone_snapshot = ?, customer_whatsapp_snapshot = ?,
        shipping_address_snapshot = COALESCE(shipping_address_snapshot, ?)
      WHERE id = ?`)
      .run(tracking, total, iso, iso, iso, c.name, c.phone, c.whatsapp, [c.address, c.city].filter(Boolean).join(', ') || null, id);
    logActivity(db, { customerId: o.customer_id, orderId: id, type: 'order_finalized', details: { tracking_id: tracking, final_price_minor: total } });
    return id;
  })();
  return getOrder(result);
}

function cancelOrder(id, body = {}) {
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw notFound('Order not found');
  if (!['draft', 'confirmed'].includes(o.status)) throw new HttpError(409, `A ${o.status} order cannot be cancelled here.`, 'BAD_STATE');
  db.transaction(() => {
    db.prepare(`UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(nowIso(), id);
    logActivity(db, { customerId: o.customer_id, orderId: id, type: 'order_cancelled', details: { reason: clean(body.reason) } });
  })();
  return getOrder(id);
}

/** Payment / delivery can change after the sale is final; price and tracking cannot. */
function updateFulfillment(id, body) {
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw notFound('Order not found');
  if (o.status === 'cancelled') throw new HttpError(409, 'A cancelled order cannot be changed.', 'BAD_STATE');
  const payment = body.payment_status ?? o.payment_status;
  const delivery = body.delivery_status ?? o.delivery_status;
  if (!PAYMENT.includes(payment)) throw bad('Unknown payment status.');
  if (!DELIVERY.includes(delivery)) throw bad('Unknown delivery status.');
  db.transaction(() => {
    db.prepare('UPDATE orders SET payment_status = ?, delivery_status = ?, payment_notes = ?, updated_at = ? WHERE id = ?')
      .run(payment, delivery, body.payment_notes !== undefined ? clean(body.payment_notes) : o.payment_notes, nowIso(), id);
    logActivity(db, { customerId: o.customer_id, orderId: id, type: 'fulfillment_updated', details: { payment_status: payment, delivery_status: delivery } });
  })();
  return getOrder(id);
}

function listOrders(q) {
  const db = getDb(); const settings = getSettings();
  const where = []; const args = [];
  if (q.status && q.status !== 'all') {
    const list = String(q.status).split(',');
    where.push(`o.status IN (${list.map(() => '?').join(',')})`); args.push(...list);
  }
  if (q.customer_id) { where.push('o.customer_id = ?'); args.push(Number(q.customer_id)); }
  if (q.q && String(q.q).trim()) {
    const like = likeEscape(q.q); const digits = String(q.q).replace(/\D/g, '');
    const parts = [`o.tracking_id LIKE ? ESCAPE '\\'`, `COALESCE(o.customer_name_snapshot, c.name) LIKE ? ESCAPE '\\'`,
      `COALESCE(o.customer_phone_snapshot, c.phone) LIKE ? ESCAPE '\\'`, `o.order_notes LIKE ? ESCAPE '\\'`,
      `EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_name LIKE ? ESCAPE '\\')`];
    args.push(like, like, like, like, like);
    if (/^\d+$/.test(String(q.q).trim())) { parts.push('o.id = ?'); args.push(Number(q.q)); }
    if (digits.length >= 3) { parts.push('c.phone_normalized LIKE ?'); args.push('%' + digits.replace(/^0/, '') + '%'); }
    where.push('(' + parts.join(' OR ') + ')');
  }
  if (q.product) { where.push(`EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_name LIKE ? ESCAPE '\\')`); args.push(likeEscape(q.product)); }
  const dateCol = q.status === 'completed' ? 'o.finalized_at' : 'o.created_at';
  if (q.from) { where.push(`${dateCol} >= ?`); args.push(localDayStartIso(q.from, settings.timezone)); }
  if (q.to) { where.push(`${dateCol} < ?`); args.push(localDayEndIso(q.to, settings.timezone)); }
  const dir = q.sort === 'oldest' ? 'ASC' : 'DESC';
  const { page, pageSize, offset } = paging(q);
  const base = `FROM orders o JOIN customers c ON c.id = o.customer_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...args).n;
  const rows = db.prepare(`SELECT o.*, COALESCE(o.customer_name_snapshot, c.name) AS customer_name,
      COALESCE(o.customer_phone_snapshot, c.phone) AS customer_phone,
      COALESCE(o.customer_whatsapp_snapshot, c.whatsapp) AS customer_whatsapp,
      (SELECT group_concat(i.product_name || ' x' || i.quantity, ', ') FROM order_items i WHERE i.order_id = o.id) AS product_summary
    ${base} ORDER BY COALESCE(o.finalized_at, o.created_at) ${dir}, o.id ${dir} LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
  return { items: rows.map((r) => ({ ...r, total_minor: totalOf(r) })), total, page, pageSize };
}

module.exports = { createOrder, getOrder, getOrderByTracking, updateOrder, confirmOrder, finalizeOrder, cancelOrder, updateFulfillment, listOrders };
