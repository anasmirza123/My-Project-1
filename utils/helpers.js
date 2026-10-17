/* ============================================================
   SHARED HELPERS
   ============================================================ */
const { getDb } = require('../config/database');

const TZ = 'Asia/Karachi';

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function nowIso() { return new Date().toISOString(); }

function todayIsoDate() { return new Date().toISOString().slice(0, 10); }

function dayInTz() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return g('year') + g('month') + g('day');
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

function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function logActivity({ customerId = null, orderId = null, actionType, details = null }) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO activity_logs (customer_id, order_id, action_type, details_json)
       VALUES (?,?,?,?)`
    ).run(customerId, orderId, actionType,
      details ? JSON.stringify(details) : null);
  } catch (e) {
    console.error('[activity log error]', e.message);
  }
}

function logOrderStatus(orderId, oldStatus, newStatus, note = null) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO order_status_history (order_id, old_status, new_status, note)
       VALUES (?,?,?,?)`
    ).run(orderId, oldStatus, newStatus, note);
  } catch (e) {
    console.error('[status history error]', e.message);
  }
}

function generateTrackingId() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tracking_prefix'").get();
  const prefix = (row && row.value) || 'NT';
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
  return prefix + '-' + day + '-' + String(seq).padStart(4, '0');
}

function getPaymentsSummary(orderId) {
  const db = getDb();
  const order = db.prepare(
    'SELECT final_price_minor, subtotal_minor, discount_minor, extra_charges_minor FROM orders WHERE id = ?'
  ).get(orderId);
  if (!order) return null;

  const paid = db.prepare(
    "SELECT COALESCE(SUM(amount_minor),0) AS s FROM payments WHERE order_id = ? AND status = 'confirmed'"
  ).get(orderId).s;

  const refunded = db.prepare(
    'SELECT COALESCE(SUM(amount_minor),0) AS s FROM refunds WHERE order_id = ?'
  ).get(orderId).s;

  const final = order.final_price_minor != null
    ? order.final_price_minor
    : (order.subtotal_minor - order.discount_minor + order.extra_charges_minor);

  const netPaid = paid - refunded;
  const balance = final - netPaid;

  let status;
  if (netPaid <= 0) status = 'unpaid';
  else if (netPaid < final) status = 'partial';
  else if (netPaid === final) status = 'paid';
  else status = 'overpaid';

  return {
    final_minor: final,
    paid_minor: netPaid,
    refunded_minor: refunded,
    balance_minor: balance,
    status
  };
}

function recalcSubtotal(orderId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT COALESCE(SUM(line_total_minor),0) AS s FROM order_items WHERE order_id = ?'
  ).get(orderId);
  db.prepare('UPDATE orders SET subtotal_minor = ?, updated_at = ? WHERE id = ?')
    .run(row.s, nowIso(), orderId);
}

module.exports = {
  httpErr, nowIso, todayIsoDate, dayInTz, normalizePhone, toInt,
  logActivity, logOrderStatus, generateTrackingId, getPaymentsSummary,
  recalcSubtotal, TZ
};
