const { getDb } = require('../db');
const { bad, notFound } = require('../middleware/error');
const { parseMoney } = require('../utils/money');
const { nowIso } = require('../utils/datetime');
const { logActivity } = require('./activity');
const { clean } = require('./util');

function requireCustomer(id) {
  if (!getDb().prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) throw notFound('Customer not found');
}

// ── hardware requirements ──
function hwValues(b, partial = false) {
  const v = {};
  for (const f of ['product_name', 'brand', 'model', 'specifications', 'notes', 'currency']) if (!partial || b[f] !== undefined) v[f] = clean(b[f]);
  if (!partial || b.quantity !== undefined) {
    const q = clean(b.quantity);
    if (q !== null && !(/^\d+$/.test(q) && Number(q) > 0)) throw bad('Quantity must be a positive whole number.');
    v.quantity = q === null ? null : Number(q);
  }
  if (!partial || b.budget !== undefined) {
    const raw = clean(b.budget);
    try { v.budget_minor = raw === null ? null : parseMoney(raw); } catch { throw bad('Budget must be a number.'); }
  }
  return v;
}
function listHardware(customerId) {
  requireCustomer(customerId);
  return getDb().prepare('SELECT * FROM hardware_requirements WHERE customer_id = ? ORDER BY id DESC').all(customerId);
}
function addHardware(customerId, body) {
  requireCustomer(customerId);
  const db = getDb(); const v = hwValues(body);
  const keys = Object.keys(v);
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO hardware_requirements(customer_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`)
      .run(customerId, ...keys.map((k) => v[k]));
    logActivity(db, { customerId, type: 'hardware_requirement_added', details: v });
    return r.lastInsertRowid;
  })();
  return db.prepare('SELECT * FROM hardware_requirements WHERE id = ?').get(id);
}
function updateHardware(id, body) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM hardware_requirements WHERE id = ?').get(id)) throw notFound('Requirement not found');
  const v = hwValues(body, true); const keys = Object.keys(v);
  if (keys.length) db.prepare(`UPDATE hardware_requirements SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => v[k]), nowIso(), id);
  return db.prepare('SELECT * FROM hardware_requirements WHERE id = ?').get(id);
}

// ── messages ──
const SOURCES = ['whatsapp', 'call', 'other'];
function listMessages(customerId) {
  requireCustomer(customerId);
  return getDb().prepare('SELECT * FROM customer_messages WHERE customer_id = ? ORDER BY COALESCE(message_at, created_at) DESC, id DESC').all(customerId);
}
function addMessage(customerId, b) {
  requireCustomer(customerId);
  const text = clean(b.message_text);
  if (!text) throw bad('Message text is required.');
  const source = clean(b.source);
  if (source && !SOURCES.includes(source)) throw bad('Source must be whatsapp, call or other.');
  const orderId = b.order_id ? Number(b.order_id) : null;
  const db = getDb();
  if (orderId && !db.prepare('SELECT 1 FROM orders WHERE id = ? AND customer_id = ?').get(orderId, customerId)) throw bad('That order does not belong to this customer.');
  let at = clean(b.message_at);
  if (at && Number.isNaN(Date.parse(at))) throw bad('Message date is invalid.');
  at = at ? new Date(at).toISOString() : null;
  const r = db.prepare('INSERT INTO customer_messages(customer_id, order_id, source, message_text, message_at, notes) VALUES (?,?,?,?,?,?)')
    .run(customerId, orderId, source, text, at, clean(b.notes));
  return db.prepare('SELECT * FROM customer_messages WHERE id = ?').get(r.lastInsertRowid);
}
function updateMessage(id, b) {
  const db = getDb();
  const m = db.prepare('SELECT * FROM customer_messages WHERE id = ?').get(id);
  if (!m) throw notFound('Message not found');
  const text = b.message_text !== undefined ? clean(b.message_text) : m.message_text;
  if (!text) throw bad('Message text is required.');
  const source = b.source !== undefined ? clean(b.source) : m.source;
  if (source && !SOURCES.includes(source)) throw bad('Source must be whatsapp, call or other.');
  db.prepare('UPDATE customer_messages SET message_text = ?, source = ?, notes = ? WHERE id = ?')
    .run(text, source, b.notes !== undefined ? clean(b.notes) : m.notes, id);
  return db.prepare('SELECT * FROM customer_messages WHERE id = ?').get(id);
}
module.exports = { listHardware, addHardware, updateHardware, listMessages, addMessage, updateMessage };
