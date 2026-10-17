const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { httpErr } = require('../utils/helpers');

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function sendCsv(res, filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(r => lines.push(r.map(csvEscape).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send('\uFEFF' + lines.join('\n'));
}

router.get('/reports/:type', (req, res, next) => {
  try {
    const db = getDb();
    const type = req.params.type;
    const ts = new Date().toISOString().slice(0, 10);
    if (type === 'customers') {
      const rows = db.prepare(`
        SELECT c.id, c.phone, c.name, c.whatsapp, c.email, c.address, c.city, c.status,
          (SELECT GROUP_CONCAT(g.name, ',') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id) AS categories,
          c.created_at
        FROM customers c ORDER BY c.created_at DESC
      `).all();
      return sendCsv(res, 'customers-' + ts + '.csv',
        ['ID','Phone','Name','WhatsApp','Email','Address','City','Status','Categories','Created'],
        rows.map(r => [r.id, r.phone, r.name || '', r.whatsapp || '', r.email || '', r.address || '', r.city || '', r.status, r.categories || '', r.created_at]));
    }
    if (type === 'orders' || type === 'completed') {
      const statusCond = type === 'completed' ? "WHERE o.status = 'completed'" : '';
      const rows = db.prepare(`
        SELECT o.id, o.tracking_id, o.status, o.final_price_minor, o.currency, o.created_at, o.completed_at,
          c.name AS customer_name, c.phone,
          (SELECT COALESCE(SUM(p.amount_minor),0) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed') AS paid_minor,
          (SELECT COALESCE(SUM(r.amount_minor),0) FROM refunds r WHERE r.order_id = o.id) AS refunded_minor
        FROM orders o JOIN customers c ON c.id = o.customer_id
        ${statusCond}
        ORDER BY o.created_at DESC
      `).all();
      return sendCsv(res, type + '-' + ts + '.csv',
        ['Order ID','Tracking','Status','Final (PKR)','Currency','Created','Completed','Customer','Phone','Paid (PKR)','Refunded','Balance (PKR)'],
        rows.map(r => [r.id, r.tracking_id || '', r.status, (r.final_price_minor || 0) / 100, r.currency,
          r.created_at, r.completed_at || '', r.customer_name || '', r.phone, r.paid_minor / 100,
          r.refunded_minor / 100, ((r.final_price_minor || 0) - r.paid_minor + r.refunded_minor) / 100]));
    }
    if (type === 'payments') {
      const rows = db.prepare(`
        SELECT p.id, p.order_id, o.tracking_id, p.amount_minor, p.method, p.reference, p.status, p.paid_at,
          c.name AS customer_name, c.phone
        FROM payments p JOIN orders o ON o.id = p.order_id JOIN customers c ON c.id = o.customer_id
        ORDER BY p.paid_at DESC
      `).all();
      return sendCsv(res, 'payments-' + ts + '.csv',
        ['Payment ID','Order','Tracking','Amount','Method','Reference','Status','Paid At','Customer','Phone'],
        rows.map(r => [r.id, r.order_id, r.tracking_id || '', r.amount_minor / 100, r.method,
          r.reference || '', r.status, r.paid_at, r.customer_name || '', r.phone]));
    }
    if (type === 'follow-ups' || type === 'followups') {
      const rows = db.prepare(`
        SELECT f.id, f.due_date, f.due_time, f.type, f.purpose, f.status,
          c.name AS customer_name, c.phone, o.tracking_id
        FROM followups f JOIN customers c ON c.id = f.customer_id
        LEFT JOIN orders o ON o.id = f.order_id
        ORDER BY f.due_date ASC
      `).all();
      return sendCsv(res, 'followups-' + ts + '.csv',
        ['ID','Due Date','Due Time','Type','Purpose','Status','Customer','Phone','Order'],
        rows.map(r => [r.id, r.due_date, r.due_time || '', r.type, r.purpose || '', r.status,
          r.customer_name || '', r.phone, r.tracking_id || '']));
    }
    if (type === 'outstanding') {
      const rows = db.prepare(`
        SELECT o.id, o.tracking_id, o.final_price_minor, o.currency, c.name AS customer_name, c.phone,
          (SELECT COALESCE(SUM(p.amount_minor),0) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed') AS paid_minor,
          (SELECT COALESCE(SUM(r.amount_minor),0) FROM refunds r WHERE r.order_id = o.id) AS refunded_minor
        FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.status IN ('confirmed','completed') AND o.final_price_minor IS NOT NULL
      `).all();
      const filtered = rows.filter(r => r.final_price_minor > (r.paid_minor - r.refunded_minor));
      return sendCsv(res, 'outstanding-' + ts + '.csv',
        ['Order','Tracking','Final','Customer','Phone','Paid','Refunded','Balance'],
        filtered.map(r => [r.id, r.tracking_id || '', r.final_price_minor / 100,
          r.customer_name || '', r.phone, r.paid_minor / 100, r.refunded_minor / 100,
          (r.final_price_minor - r.paid_minor + r.refunded_minor) / 100]));
    }
    throw httpErr(400, 'Unknown report type: ' + type);
  } catch (e) { next(e); }
});

module.exports = router;
