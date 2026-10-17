/* ============================================================
   DASHBOARD — GET /api/dashboard/stats
   Fixes the 404: this route is registered before any catch-all
   ============================================================ */
const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { todayIsoDate } = require('../utils/helpers');

router.get('/dashboard/stats', (req, res, next) => {
  try {
    const db = getDb();
    const today = todayIsoDate();

    const counts = {
      all_customers: db.prepare("SELECT COUNT(*) AS n FROM customers WHERE status <> 'archived'").get().n,
      wholesale: db.prepare(`SELECT COUNT(DISTINCT c.id) AS n FROM customers c
        JOIN customer_categories cc ON cc.customer_id = c.id
        JOIN categories g ON g.id = cc.category_id
        WHERE g.name = 'Wholesale' AND c.status <> 'archived'`).get().n,
      retail: db.prepare(`SELECT COUNT(DISTINCT c.id) AS n FROM customers c
        JOIN customer_categories cc ON cc.customer_id = c.id
        JOIN categories g ON g.id = cc.category_id
        WHERE g.name = 'Retail' AND c.status <> 'archived'`).get().n,
      leads: db.prepare(`SELECT COUNT(DISTINCT c.id) AS n FROM customers c
        JOIN customer_categories cc ON cc.customer_id = c.id
        JOIN categories g ON g.id = cc.category_id
        WHERE g.name = 'Lead' AND c.status <> 'archived'`).get().n,
      hardware_customers: db.prepare("SELECT COUNT(DISTINCT customer_id) AS n FROM hardware_requirements").get().n,
      uncategorized: db.prepare(`SELECT COUNT(*) AS n FROM customers c
        WHERE c.status <> 'archived'
          AND NOT EXISTS (SELECT 1 FROM customer_categories cc WHERE cc.customer_id = c.id)`).get().n,
      previous_customers: db.prepare("SELECT COUNT(DISTINCT customer_id) AS n FROM orders WHERE status = 'completed'").get().n,
      total_orders: db.prepare("SELECT COUNT(*) AS n FROM orders").get().n,
      draft_orders: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'draft'").get().n,
      pending_orders: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'confirmed'").get().n,
      completed_orders: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'completed'").get().n,
      cancelled_orders: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'cancelled'").get().n,
      followups_due_today: db.prepare(`SELECT COUNT(*) AS n FROM followups
        WHERE status = 'scheduled' AND due_date = ?`).get(today).n,
      followups_overdue: db.prepare(`SELECT COUNT(*) AS n FROM followups
        WHERE status = 'scheduled' AND due_date < ?`).get(today).n,
      followups_upcoming: db.prepare(`SELECT COUNT(*) AS n FROM followups
        WHERE status = 'scheduled' AND due_date > ?`).get(today).n
    };

    const financials = db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(subtotal_minor - discount_minor + extra_charges_minor),0)
         FROM orders WHERE status IN ('confirmed','completed')) AS total_sale_minor,
        (SELECT COALESCE(SUM(amount_minor),0) FROM payments WHERE status = 'confirmed') AS received_minor,
        (SELECT COALESCE(SUM(oi.cost_minor * oi.quantity),0)
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.status IN ('confirmed','completed') AND oi.cost_minor IS NOT NULL) AS total_cost_minor
    `).get();

    const outstandingRow = db.prepare(`
      SELECT COALESCE(SUM(
        o.final_price_minor - COALESCE(
          (SELECT SUM(p.amount_minor) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed'), 0
        ) + COALESCE(
          (SELECT SUM(r.amount_minor) FROM refunds r WHERE r.order_id = o.id), 0
        )
      ),0) AS s
      FROM orders o
      WHERE o.status IN ('confirmed','completed') AND o.final_price_minor IS NOT NULL
    `).get();

    const estimated_profit = financials.total_sale_minor - financials.total_cost_minor;
    const margin_pct = financials.total_sale_minor > 0
      ? Math.round((estimated_profit / financials.total_sale_minor) * 10000) / 100
      : null;

    const recentCustomers = db.prepare(
      'SELECT id, phone, name, created_at FROM customers ORDER BY created_at DESC LIMIT 6'
    ).all();

    const recentOrders = db.prepare(`
      SELECT o.id, o.tracking_id, o.status, o.created_at, o.final_price_minor, o.currency,
              c.phone, c.name AS customer_name
      FROM orders o JOIN customers c ON c.id = o.customer_id
      ORDER BY o.created_at DESC LIMIT 6
    `).all();

    const todayFollowups = db.prepare(`
      SELECT f.*, c.name AS customer_name, c.phone, o.tracking_id
      FROM followups f
      JOIN customers c ON c.id = f.customer_id
      LEFT JOIN orders o ON o.id = f.order_id
      WHERE f.status = 'scheduled' AND f.due_date <= ?
      ORDER BY f.due_date ASC, f.due_time ASC LIMIT 10
    `).all(today);

    res.json({
      counts,
      financials: {
        total_sale_minor: financials.total_sale_minor,
        received_minor: financials.received_minor,
        total_cost_minor: financials.total_cost_minor,
        outstanding_minor: outstandingRow.s,
        estimated_profit_minor: estimated_profit,
        margin_pct
      },
      recentCustomers,
      recentOrders,
      todayFollowups
    });
  } catch (e) {
    console.error('[dashboard/stats error]', e.message);
    next(e);
  }
});

router.get('/dashboard/recent-activity', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT a.*, c.name AS customer_name, c.phone
      FROM activity_logs a
      LEFT JOIN customers c ON c.id = a.customer_id
      ORDER BY a.created_at DESC LIMIT 30
    `).all();
    res.json({ rows });
  } catch (e) { next(e); }
});

module.exports = router;
