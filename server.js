/* ============================================================================
   CUSTOMER MANAGEMENT, ORDER REGISTER & FINANCIAL TRACKING — BACKEND (server.ts)
   Express + SQLite (sql.js / WebAssembly) with ACID durability & schema triggers.
   ============================================================================ */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'customer-management.sqlite');
const TZ = 'Asia/Karachi';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* ---------------------------- SQLite Wrapper ------------------------------ */

class DatabaseWrapper {
          db               ;
          filePath        ;
          inTransaction          = false;

  constructor(db               , filePath        ) {
    this.db = db;
    this.filePath = filePath;
  }

  getRawDb()                {
    return this.db;
  }

  replaceDb(next               ) {
    try { this.db.close(); } catch (_) {}
    this.db = next;
    this.save();
  }

  save() {
    if (this.inTransaction) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.filePath, Buffer.from(data));
    } catch (err) {
      console.error('[db] Error saving SQLite database to disk:', err);
    }
  }

  exec(sql        ) {
    this.db.exec(sql);
    this.save();
  }

  prepare(sql        ) {
    const self = this;
    return {
      get(...params       )                                  {
        const stmt = self.db.prepare(sql);
        try {
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...params       )                        {
        const stmt = self.db.prepare(sql);
        const rows                        = [];
        try {
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
      run(...params       )                                               {
        const stmt = self.db.prepare(sql);
        try {
          if (params.length > 0) stmt.bind(params);
          stmt.step();

          let lastId = 0;
          let changes = 0;
          try {
            const idRes = self.db.exec('SELECT last_insert_rowid() AS id;');
            if (idRes && idRes[0]?.values?.[0]?.[0] !== undefined) {
              lastId = Number(idRes[0].values[0][0]);
            }
            const chRes = self.db.exec('SELECT changes() AS c;');
            if (chRes && chRes[0]?.values?.[0]?.[0] !== undefined) {
              changes = Number(chRes[0].values[0][0]);
            }
          } catch (_) {}

          self.save();

          return { lastInsertRowid: lastId, changes };
        } finally {
          stmt.free();
        }
      }
    };
  }

  transaction   (fn         )          {
    return () => {
      this.inTransaction = true;
      this.db.exec('BEGIN TRANSACTION;');
      try {
        const result = fn();
        this.db.exec('COMMIT;');
        this.inTransaction = false;
        this.save();
        return result;
      } catch (err) {
        this.inTransaction = false;
        try { this.db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    };
  }
}

/* ---------------------------- SQLite Schema & Migrations ----------------- */

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('business_name', 'Anas Management System'),
  ('timezone', 'Asia/Karachi'),
  ('tracking_prefix', 'NT'),
  ('default_currency', 'PKR');

CREATE TABLE IF NOT EXISTS customers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  phone               TEXT NOT NULL,
  phone_normalized    TEXT NOT NULL UNIQUE,
  name                TEXT,
  whatsapp            TEXT,
  whatsapp_normalized TEXT,
  alternate_phone     TEXT,
  email               TEXT,
  address             TEXT,
  city                TEXT,
  province            TEXT,
  country             TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','archived')),
  lead_status         TEXT
                      CHECK (lead_status IS NULL OR lead_status IN
                        ('new','contacted','interested','follow_up','converted','not_interested')),
  lead_source         TEXT,
  preferred_contact   TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp ON customers(whatsapp_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_name     ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_created  ON customers(created_at);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO categories (name) VALUES ('Wholesale'), ('Retail'), ('Lead'), ('Other');

CREATE TABLE IF NOT EXISTS customer_categories (
  customer_id INTEGER NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (customer_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_cc_category ON customer_categories(category_id);

CREATE TABLE IF NOT EXISTS hardware_requirements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_name TEXT,
  brand        TEXT,
  model        TEXT,
  specifications TEXT,
  quantity     INTEGER CHECK (quantity IS NULL OR quantity > 0),
  budget_minor INTEGER CHECK (budget_minor IS NULL OR budget_minor >= 0),
  currency     TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_hw_customer ON hardware_requirements(customer_id);

CREATE TABLE IF NOT EXISTS orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id           TEXT UNIQUE,
  customer_id           INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending','confirmed','processing','ready','dispatched','delivered','completed','cancelled','returned')),
  delivery_status       TEXT NOT NULL DEFAULT 'pending'
                        CHECK (delivery_status IN ('pending','dispatched','delivered')),
  payment_status        TEXT NOT NULL DEFAULT 'unpaid'
                        CHECK (payment_status IN ('unpaid','partial','partially_paid','paid','partially_refunded','refunded')),
  currency              TEXT NOT NULL DEFAULT 'PKR',
  subtotal_minor        INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  extra_charges_minor   INTEGER NOT NULL DEFAULT 0 CHECK (extra_charges_minor >= 0),
  additional_charges_minor INTEGER NOT NULL DEFAULT 0,
  final_price_minor     INTEGER CHECK (final_price_minor IS NULL OR final_price_minor >= 0),
  total_sale_amount_minor INTEGER,
  amount_received_minor INTEGER NOT NULL DEFAULT 0,
  purchase_cost_minor   INTEGER,
  additional_expenses_minor INTEGER NOT NULL DEFAULT 0,
  payment_notes         TEXT,
  order_notes           TEXT,
  product_requirements  TEXT,
  customer_name_snapshot      TEXT,
  customer_phone_snapshot     TEXT,
  customer_whatsapp_snapshot  TEXT,
  shipping_address_snapshot   TEXT,
  courier_tracking_no   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at          TEXT,
  finalized_at          TEXT,
  delivered_at          TEXT,
  cancelled_at          TEXT,
  returned_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_customer  ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_finalized ON orders(finalized_at);

CREATE TABLE IF NOT EXISTS tracking_counters (
  day      TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id                INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name            TEXT NOT NULL,
  product_sku             TEXT,
  description             TEXT,
  size_variant            TEXT,
  quantity                INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor        INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  unit_sale_price_minor   INTEGER NOT NULL DEFAULT 0 CHECK (unit_sale_price_minor >= 0),
  unit_purchase_cost_minor INTEGER CHECK (unit_purchase_cost_minor IS NULL OR unit_purchase_cost_minor >= 0),
  discount_minor          INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor        INTEGER NOT NULL,
  line_sale_total_minor   INTEGER NOT NULL DEFAULT 0,
  line_purchase_total_minor INTEGER,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_name);

CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_minor        INTEGER NOT NULL CHECK (amount_minor > 0),
  currency            TEXT NOT NULL DEFAULT 'PKR',
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'easypaisa', 'jazzcash', 'other')),
  payment_status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (payment_status IN ('confirmed', 'pending', 'cancelled')),
  payment_reference   TEXT,
  payment_date        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS refunds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id      INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
  currency        TEXT NOT NULL DEFAULT 'PKR',
  refund_date     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'rejected')),
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

CREATE TABLE IF NOT EXISTS order_expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL,
  description  TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency     TEXT NOT NULL DEFAULT 'PKR',
  expense_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_order ON order_expenses(order_id);

CREATE TABLE IF NOT EXISTS order_status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_hist_order ON order_status_history(order_id);

CREATE TABLE IF NOT EXISTS customer_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id     INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  source       TEXT CHECK (source IS NULL OR source IN ('whatsapp','call','other')),
  message_text TEXT NOT NULL,
  message_at   TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_customer ON customer_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_msg_order    ON customer_messages(order_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  order_id     INTEGER REFERENCES orders(id)    ON DELETE SET NULL,
  action_type  TEXT NOT NULL,
  details_json TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (1, 'baseline schema v1.2');
CREATE INDEX IF NOT EXISTS idx_log_customer ON activity_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_log_order    ON activity_logs(order_id);

DROP VIEW IF EXISTS v_dashboard_counts;
CREATE VIEW v_dashboard_counts AS
SELECT
  (SELECT COUNT(*) FROM customers WHERE status <> 'archived') AS all_customers,
  (SELECT COUNT(*) FROM customers c JOIN customer_categories cc ON cc.customer_id = c.id
     JOIN categories g ON g.id = cc.category_id
   WHERE g.name = 'Wholesale' AND c.status <> 'archived') AS wholesale,
  (SELECT COUNT(*) FROM customers c JOIN customer_categories cc ON cc.customer_id = c.id
     JOIN categories g ON g.id = cc.category_id
   WHERE g.name = 'Retail' AND c.status <> 'archived') AS retail,
  (SELECT COUNT(*) FROM customers c JOIN customer_categories cc ON cc.customer_id = c.id
     JOIN categories g ON g.id = cc.category_id
   WHERE g.name = 'Lead' AND c.status <> 'archived') AS leads,
  (SELECT COUNT(DISTINCT customer_id) FROM orders WHERE status = 'completed') AS previous_customers,
  (SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'confirmed', 'processing', 'ready', 'dispatched')) AS orders_in_progress,
  (SELECT COUNT(*) FROM orders WHERE status = 'completed') AS completed_orders,
  (SELECT COUNT(DISTINCT customer_id) FROM hardware_requirements) AS hardware_requirements,
  (SELECT COUNT(*) FROM customers c
   WHERE c.status <> 'archived'
     AND NOT EXISTS (SELECT 1 FROM customer_categories cc WHERE cc.customer_id = c.id)) AS uncategorized,
  (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders;
`;

function runMigrations(db                 ) {
  try {
    const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c     ) => c.name);
    if (!orderCols.includes('delivered_at')) db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT;');
    if (!orderCols.includes('cancelled_at')) db.exec('ALTER TABLE orders ADD COLUMN cancelled_at TEXT;');
    if (!orderCols.includes('returned_at')) db.exec('ALTER TABLE orders ADD COLUMN returned_at TEXT;');
    if (!orderCols.includes('courier_tracking_no')) db.exec('ALTER TABLE orders ADD COLUMN courier_tracking_no TEXT;');
    if (!orderCols.includes('additional_charges_minor')) db.exec('ALTER TABLE orders ADD COLUMN additional_charges_minor INTEGER NOT NULL DEFAULT 0;');
    if (!orderCols.includes('total_sale_amount_minor')) db.exec('ALTER TABLE orders ADD COLUMN total_sale_amount_minor INTEGER;');
    if (!orderCols.includes('amount_received_minor')) db.exec('ALTER TABLE orders ADD COLUMN amount_received_minor INTEGER NOT NULL DEFAULT 0;');
    if (!orderCols.includes('purchase_cost_minor')) db.exec('ALTER TABLE orders ADD COLUMN purchase_cost_minor INTEGER;');
    if (!orderCols.includes('additional_expenses_minor')) db.exec('ALTER TABLE orders ADD COLUMN additional_expenses_minor INTEGER NOT NULL DEFAULT 0;');

    const itemCols = db.prepare("PRAGMA table_info(order_items)").all().map((c     ) => c.name);
    if (!itemCols.includes('unit_sale_price_minor')) db.exec('ALTER TABLE order_items ADD COLUMN unit_sale_price_minor INTEGER DEFAULT 0;');
    if (!itemCols.includes('unit_purchase_cost_minor')) db.exec('ALTER TABLE order_items ADD COLUMN unit_purchase_cost_minor INTEGER;');
    if (!itemCols.includes('line_sale_total_minor')) db.exec('ALTER TABLE order_items ADD COLUMN line_sale_total_minor INTEGER DEFAULT 0;');
    if (!itemCols.includes('line_purchase_total_minor')) db.exec('ALTER TABLE order_items ADD COLUMN line_purchase_total_minor INTEGER;');
  } catch (err) {
    console.error('[db migration]', err);
  }
}

/* ---------------------------- Financial Calculations --------------------- */

function calculateOrderFinancials(orderId        , db                 ) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const payments = db.prepare("SELECT * FROM payments WHERE order_id = ? AND payment_status = 'confirmed'").all(orderId);
  const refunds = db.prepare("SELECT * FROM refunds WHERE order_id = ? AND status = 'completed'").all(orderId);
  const expenses = db.prepare('SELECT * FROM order_expenses WHERE order_id = ?').all(orderId);

  // 1. Total Sale Amount
  let itemsSaleSubtotal = 0;
  let itemsPurchaseCostTotal = 0;
  let hasMissingItemCost = false;

  for (const item of items) {
    const saleTotal = item.line_sale_total_minor != null && Number(item.line_sale_total_minor) > 0
      ? Number(item.line_sale_total_minor)
      : Number(item.line_total_minor || 0);
    itemsSaleSubtotal += saleTotal;

    if (item.unit_purchase_cost_minor != null) {
      const lineCost = item.line_purchase_total_minor != null && Number(item.line_purchase_total_minor) > 0
        ? Number(item.line_purchase_total_minor)
        : Number(item.unit_purchase_cost_minor) * Number(item.quantity || 1);
      itemsPurchaseCostTotal += lineCost;
    } else {
      hasMissingItemCost = true;
    }
  }

  const discount = Number(order.discount_minor || 0);
  const extraCharges = Number(order.extra_charges_minor || order.additional_charges_minor || 0);
  const totalSaleAmount = Math.max(0, itemsSaleSubtotal - discount + extraCharges);

  // 2. Payments & Refunds
  const grossPaymentsReceived = payments.reduce((sum, p) => sum + Number(p.amount_minor || 0), 0);
  const totalRefunds = refunds.reduce((sum, r) => sum + Number(r.amount_minor || 0), 0);
  const netAmountReceived = Math.max(0, grossPaymentsReceived - totalRefunds);

  // 3. Remaining Balance
  const remainingBalance = Math.max(0, totalSaleAmount - netAmountReceived);

  // 4. Payment Status calculation
  let calculatedPaymentStatus = 'unpaid';
  if (totalRefunds > 0) {
    if (netAmountReceived <= 0) {
      calculatedPaymentStatus = 'refunded';
    } else {
      calculatedPaymentStatus = 'partially_refunded';
    }
  } else if (netAmountReceived >= totalSaleAmount && totalSaleAmount > 0) {
    calculatedPaymentStatus = 'paid';
  } else if (netAmountReceived > 0) {
    calculatedPaymentStatus = 'partially_paid';
  } else {
    calculatedPaymentStatus = 'unpaid';
  }

  // 5. Total Purchase Cost & Expenses
  const directExpenses = expenses.reduce((sum, e) => sum + Number(e.amount_minor || 0), 0);
  let totalPurchaseCost                = itemsPurchaseCostTotal + directExpenses;
  if (items.length > 0 && hasMissingItemCost) {
    totalPurchaseCost = null;
  }

  // 6. Estimated Gross and Net Profit
  let estimatedGrossProfit                = null;
  let estimatedNetProfit                = null;
  let profitMarginPercent                = null;

  if (totalPurchaseCost !== null) {
    estimatedGrossProfit = totalSaleAmount - totalPurchaseCost;
    estimatedNetProfit = estimatedGrossProfit;
    if (totalSaleAmount > 0) {
      profitMarginPercent = Math.round((estimatedGrossProfit / totalSaleAmount) * 1000) / 10;
    }
  }

  return {
    itemsSaleSubtotal,
    discountMinor: discount,
    extraChargesMinor: extraCharges,
    totalSaleAmount,
    grossPaymentsReceived,
    totalRefunds,
    netAmountReceived,
    remainingBalance,
    calculatedPaymentStatus,
    itemsPurchaseCostTotal,
    directExpenses,
    totalPurchaseCost,
    hasMissingItemCost,
    estimatedGrossProfit,
    estimatedNetProfit,
    profitMarginPercent,
    payments,
    refunds,
    expenses
  };
}

/* ---------------------------- Initial Seed Data -------------------------- */

function seedInitialData(db                 ) {
  const custCheck = db.prepare('SELECT COUNT(*) AS count FROM customers').get();
  const catWholesale = db.prepare('SELECT id FROM categories WHERE name = ?').get('Wholesale')?.id;
  const catRetail = db.prepare('SELECT id FROM categories WHERE name = ?').get('Retail')?.id;
  const catLead = db.prepare('SELECT id FROM categories WHERE name = ?').get('Lead')?.id;

  const now = new Date().toISOString();
  const past2d = new Date(Date.now() - 2 * 86400000).toISOString();
  const past4d = new Date(Date.now() - 4 * 86400000).toISOString();
  const past7d = new Date(Date.now() - 7 * 86400000).toISOString();

  let c1Id = 1, c2Id = 2, c3Id = 3, c4Id = 4;

  if (!custCheck || custCheck.count === 0) {
    console.log('[db] Preloading initial sample customers...');

    const c1 = db.prepare(
      `INSERT INTO customers (phone, phone_normalized, name, whatsapp, whatsapp_normalized, city, address, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run('0300-5544332', '+923005544332', 'Ahmed Fabrics & Sports', '0300-5544332', '+923005544332', 'Faisalabad', 'Shop 14, Commercial Market, Faisalabad', past7d, past7d);
    c1Id = Number(c1.lastInsertRowid);

    const c2 = db.prepare(
      `INSERT INTO customers (phone, phone_normalized, name, whatsapp, whatsapp_normalized, city, address, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run('0321-9876543', '+923219876543', 'Ali Garments & Apparel', '0321-9876543', '+923219876543', 'Lahore', 'House 42-B, Block 6, PECHS, Lahore', past4d, past4d);
    c2Id = Number(c2.lastInsertRowid);

    const c3 = db.prepare(
      `INSERT INTO customers (phone, phone_normalized, name, whatsapp, whatsapp_normalized, city, address, status, lead_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'interested', ?, ?)`
    ).run('0333-1122334', '+923331122334', 'Usman Retail Hub', '0333-1122334', '+923331122334', 'Karachi', 'Plot 108, I-9 Industrial Area, Karachi', past2d, past2d);
    c3Id = Number(c3.lastInsertRowid);

    const c4 = db.prepare(
      `INSERT INTO customers (phone, phone_normalized, name, whatsapp, whatsapp_normalized, city, address, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run('0345-8877665', '+923458877665', 'Karachi Hardware & Tech', '0345-8877665', '+923458877665', 'Karachi', 'Saddar Electronics Market, Shop G-12', now, now);
    c4Id = Number(c4.lastInsertRowid);

    // Uncategorized walk-in
    db.prepare(
      `INSERT INTO customers (phone, phone_normalized, name, city, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`
    ).run('0312-3456789', '+923123456789', 'Zubair Walk-in', 'Rawalpindi', now, now);
  }

  // Ensure category assignments
  if (catWholesale) {
    db.prepare('INSERT OR IGNORE INTO customer_categories (customer_id, category_id, assigned_at) VALUES (?, ?, ?)').run(c1Id, catWholesale, past7d);
    db.prepare('INSERT OR IGNORE INTO customer_categories (customer_id, category_id, assigned_at) VALUES (?, ?, ?)').run(c4Id, catWholesale, now);
  }
  if (catRetail) {
    db.prepare('INSERT OR IGNORE INTO customer_categories (customer_id, category_id, assigned_at) VALUES (?, ?, ?)').run(c2Id, catRetail, past4d);
  }
  if (catLead) {
    db.prepare('INSERT OR IGNORE INTO customer_categories (customer_id, category_id, assigned_at) VALUES (?, ?, ?)').run(c3Id, catLead, past2d);
  }

  // Ensure orders with purchase costs & payments
  const ordCheck = db.prepare('SELECT COUNT(*) AS count FROM orders').get();
  if (!ordCheck || ordCheck.count === 0) {
    console.log('[db] Preloading initial sample orders, items, costs, and payments...');

    // 1. Order 1: Ahmed (Completed, Partial Payment)
    const o1 = db.prepare(
      `INSERT INTO orders (customer_id, tracking_id, status, delivery_status, payment_status, currency, subtotal_minor, discount_minor, extra_charges_minor, final_price_minor, total_sale_amount_minor,
                           customer_name_snapshot, customer_phone_snapshot, customer_whatsapp_snapshot, shipping_address_snapshot, created_at, updated_at, confirmed_at, finalized_at)
       VALUES (?, 'NT-20261017-0001', 'completed', 'delivered', 'partially_paid', 'PKR', 1500000, 0, 0, 1500000, 1500000,
               'Ahmed Fabrics & Sports', '+923005544332', '+923005544332', 'Shop 14, Commercial Market, Faisalabad', ?, ?, ?, ?)`
    ).run(c1Id, past7d, past7d, past7d, past7d);
    const o1Id = Number(o1.lastInsertRowid);

    db.prepare(
      `INSERT INTO order_items (order_id, product_name, product_sku, description, size_variant, quantity, unit_price_minor, unit_sale_price_minor, unit_purchase_cost_minor, discount_minor, line_total_minor, line_sale_total_minor, line_purchase_total_minor, created_at, updated_at)
       VALUES (?, 'Athletic Tracksuit Set', 'TS-2026', 'Breathable polyester fleece', 'L (Large)', 20, 75000, 75000, 50000, 0, 1500000, 1500000, 1000000, ?, ?)`
    ).run(o1Id, past7d, past7d);

    db.prepare(
      `INSERT INTO payments (order_id, amount_minor, currency, payment_method, payment_status, payment_reference, payment_date, notes)
       VALUES (?, 1000000, 'PKR', 'bank_transfer', 'confirmed', 'HBL-FT-9921', ?, 'Advance deposit paid via mobile banking')`
    ).run(o1Id, past7d);

    db.prepare(
      `INSERT INTO order_expenses (order_id, expense_type, description, amount_minor, currency, expense_date, notes)
       VALUES (?, 'packaging', 'Polybags and carton packaging', 35000, 'PKR', ?, 'Branded delivery cartons')`
    ).run(o1Id, past7d);

    db.prepare(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, reason)
       VALUES (?, 'confirmed', 'completed', ?, 'Customer received parcel and signed POD')`
    ).run(o1Id, past7d);

    // 2. Order 2: Ali (Processing, Unpaid)
    const o2 = db.prepare(
      `INSERT INTO orders (customer_id, tracking_id, status, delivery_status, payment_status, currency, subtotal_minor, discount_minor, extra_charges_minor, final_price_minor, total_sale_amount_minor,
                           customer_name_snapshot, customer_phone_snapshot, customer_whatsapp_snapshot, shipping_address_snapshot, created_at, updated_at, confirmed_at)
       VALUES (?, 'NT-20261017-0002', 'processing', 'pending', 'unpaid', 'PKR', 850000, 0, 0, 850000, 850000,
               'Ali Garments & Apparel', '+923219876543', '+923219876543', 'House 42-B, Block 6, PECHS, Lahore', ?, ?, ?)`
    ).run(c2Id, past4d, past4d, past4d);
    const o2Id = Number(o2.lastInsertRowid);

    db.prepare(
      `INSERT INTO order_items (order_id, product_name, product_sku, description, size_variant, quantity, unit_price_minor, unit_sale_price_minor, unit_purchase_cost_minor, discount_minor, line_total_minor, line_sale_total_minor, line_purchase_total_minor, created_at, updated_at)
       VALUES (?, 'Cotton Shalwar Kameez', 'SK-CTN-10', 'Stitched Egyptian Cotton', 'M (Medium)', 10, 85000, 85000, 45000, 0, 850000, 850000, 450000, ?, ?)`
    ).run(o2Id, past4d, past4d);

    db.prepare(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, reason)
       VALUES (?, 'draft', 'processing', ?, 'Fabric cutting and stitching in workshop')`
    ).run(o2Id, past4d);

    // 3. Order 3: Usman (Completed, Paid in Full)
    const o3 = db.prepare(
      `INSERT INTO orders (customer_id, tracking_id, status, delivery_status, payment_status, currency, subtotal_minor, discount_minor, extra_charges_minor, final_price_minor, total_sale_amount_minor,
                           customer_name_snapshot, customer_phone_snapshot, customer_whatsapp_snapshot, shipping_address_snapshot, created_at, updated_at, confirmed_at, finalized_at)
       VALUES (?, 'NT-20261017-0003', 'completed', 'delivered', 'paid', 'PKR', 1500000, 0, 0, 1500000, 1500000,
               'Usman Retail Hub', '+923331122334', '+923331122334', 'Plot 108, I-9 Industrial Area, Karachi', ?, ?, ?, ?)`
    ).run(c3Id, past2d, past2d, past2d, past2d);
    const o3Id = Number(o3.lastInsertRowid);

    db.prepare(
      `INSERT INTO order_items (order_id, product_name, product_sku, description, size_variant, quantity, unit_price_minor, unit_sale_price_minor, unit_purchase_cost_minor, discount_minor, line_total_minor, line_sale_total_minor, line_purchase_total_minor, created_at, updated_at)
       VALUES (?, 'Summer Shorts & Tee Set', 'ST-SUM-30', 'Cotton blend casual wear', 'Free Size', 30, 50000, 50000, 30000, 0, 1500000, 1500000, 900000, ?, ?)`
    ).run(o3Id, past2d, past2d);

    db.prepare(
      `INSERT INTO payments (order_id, amount_minor, currency, payment_method, payment_status, payment_reference, payment_date, notes)
       VALUES (?, 1500000, 'PKR', 'easypaisa', 'confirmed', 'EP-TXN-8812', ?, 'Paid in full upon order confirmation')`
    ).run(o3Id, past2d);

    db.prepare(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, reason)
       VALUES (?, 'confirmed', 'completed', ?, 'Dispatched and delivered successfully')`
    ).run(o3Id, past2d);

    const today = now.slice(0, 10).replace(/-/g, '');
    db.prepare('INSERT OR REPLACE INTO tracking_counters (day, last_seq) VALUES (?, 3)').run(today);
  }

  // Ensure sample payments exist for demonstration
  const payCheck = db.prepare('SELECT COUNT(*) AS count FROM payments').get();
  if (!payCheck || payCheck.count === 0) {
    console.log('[db] Preloading sample payments...');
    db.prepare(`
      INSERT INTO payments (order_id, amount_minor, currency, payment_method, payment_status, payment_reference, payment_date, notes)
      VALUES (1, 10000000, 'PKR', 'bank_transfer', 'confirmed', 'HBL-FT-9921', ?, 'Advance payment via mobile banking')
    `).run(past7d);

    db.prepare(`
      INSERT INTO payments (order_id, amount_minor, currency, payment_method, payment_status, payment_reference, payment_date, notes)
      VALUES (2, 8535000, 'PKR', 'easypaisa', 'confirmed', 'EP-TXN-8812', ?, 'Paid in full on dispatch')
    `).run(past4d);

    db.prepare(`
      INSERT INTO payments (order_id, amount_minor, currency, payment_method, payment_status, payment_reference, payment_date, notes)
      VALUES (4, 1500000, 'PKR', 'cash', 'confirmed', 'CASH-REC-104', ?, 'Partial deposit received in cash')
    `).run(past2d);
  }

  // Ensure order_items have purchase costs populated
  db.prepare(`
    UPDATE order_items
    SET unit_purchase_cost_minor = CAST(COALESCE(unit_sale_price_minor, unit_price_minor) * 0.68 AS INTEGER),
        unit_sale_price_minor = COALESCE(unit_sale_price_minor, unit_price_minor),
        line_sale_total_minor = COALESCE(line_sale_total_minor, line_total_minor),
        line_purchase_total_minor = CAST(COALESCE(line_sale_total_minor, line_total_minor) * 0.68 AS INTEGER)
    WHERE unit_purchase_cost_minor IS NULL AND (unit_sale_price_minor > 0 OR unit_price_minor > 0)
  `).run();

  db.save();
}

/* ---------------------------- Helpers ------------------------------------ */

function nowIso()         {
  return new Date().toISOString();
}

function dayInTz(date = new Date(), tz = TZ)         {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const g = (t        ) => parts.find((p) => p.type === t)?.value || '';
  return `${g('year')}${g('month')}${g('day')}`;
}

function normalizePhone(input     )                {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) {
    const d = s.slice(1).replace(/\D/g, '');
    return d ? '+' + d : null;
  }
  if (s.startsWith('00')) {
    const d = s.slice(2).replace(/\D/g, '');
    return d ? '+' + d : null;
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) return '+92' + digits.slice(1);
  if (digits.startsWith('92')) return '+' + digits;
  if (digits.length === 10 && digits.startsWith('3')) return '+92' + digits;
  return '+' + digits;
}

function httpError(status        , message        ) {
  const e = new Error(message)       ;
  e.status = status;
  return e;
}

/* ---------------------------- App Initialization ------------------------- */

async function startServer() {
  const SQL = await initSqlJs();
  let sqlJsDb               ;

  if (fs.existsSync(DB_PATH)) {
    try {
      const filebuffer = fs.readFileSync(DB_PATH);
      sqlJsDb = new SQL.Database(filebuffer);
      console.log('[db] Loaded existing SQLite database from', DB_PATH);
    } catch (err) {
      console.error('[db] Error loading existing database, initializing new:', err);
      sqlJsDb = new SQL.Database();
    }
  } else {
    sqlJsDb = new SQL.Database();
    console.log('[db] Created fresh in-memory SQLite database for', DB_PATH);
  }

  const db = new DatabaseWrapper(sqlJsDb, DB_PATH);
  db.exec(SCHEMA);
  runMigrations(db);
  if (process.env.SEED_SAMPLE_DATA === '1') seedInitialData(db); // sample data only when explicitly enabled

  function getSetting(key        , fallback        )         {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  function logActivity(params                                                                                            ) {
    db.prepare(
      `INSERT INTO activity_logs (customer_id, order_id, action_type, details_json)
       VALUES (?, ?, ?, ?)`
    ).run(
      params.customerId || null,
      params.orderId || null,
      params.actionType,
      params.details ? JSON.stringify(params.details) : null
    );
  }

  function generateTrackingId()         {
    const prefix = getSetting('tracking_prefix', 'NT');
    const day = dayInTz();
    const existing = db.prepare('SELECT last_seq FROM tracking_counters WHERE day = ?').get(day);
    let seq = existing ? Number(existing.last_seq) + 1 : 1;

    let candidate = `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
    while (db.prepare('SELECT id FROM orders WHERE tracking_id = ?').get(candidate)) {
      seq++;
      candidate = `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
    }

    if (existing) {
      db.prepare('UPDATE tracking_counters SET last_seq = ? WHERE day = ?').run(seq, day);
    } else {
      db.prepare('INSERT INTO tracking_counters (day, last_seq) VALUES (?, ?)').run(day, seq);
    }
    return candidate;
  }

  function getOrderFull(id        ) {
    const order = db.prepare(
      `SELECT o.*, c.phone AS customer_phone, c.name AS customer_name,
              c.whatsapp AS customer_whatsapp, c.alternate_phone AS customer_alternate_phone,
              c.email AS customer_email, c.address AS customer_address, c.city AS customer_city,
              c.province AS customer_province, c.country AS customer_country,
              (SELECT GROUP_CONCAT(g.name, ', ') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id) AS customer_categories_list
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`
    ).get(id);
    if (!order) return null;

    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(id);
    order.status_history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY changed_at DESC').all(id);
    order.activity_logs = db.prepare('SELECT * FROM activity_logs WHERE order_id = ? ORDER BY created_at DESC').all(id);
    order.financials = calculateOrderFinancials(id, db);

    return order;
  }

  function recalcSubtotal(orderId        )         {
    const row = db.prepare(
      'SELECT COALESCE(SUM(line_total_minor), 0) AS s FROM order_items WHERE order_id = ?'
    ).get(orderId);
    const subtotal = row ? Number(row.s) : 0;
    db.prepare('UPDATE orders SET subtotal_minor = ?, updated_at = ? WHERE id = ?')
      .run(subtotal, nowIso(), orderId);
    return subtotal;
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  /* ---------------------------- API Routes -------------------------------- */

  // Health
  app.get('/api/health', (req         , res          ) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', database: 'connected', ok: true, time: nowIso(), version: 3 });
    } catch (e     ) {
      console.error('[health] database check failed:', e.message);
      res.status(503).json({ status: 'error', database: 'unavailable', ok: false, error: 'Database is not accessible' });
    }
  });

  // Dashboard Stats with Date Range & Financial Overview
  app.get('/api/dashboard/stats', (req         , res          , next              ) => {
    try {
      const range = (req.query.range          ) || 'all'; // all, today, 7d, month, last_month
      const counts = db.prepare('SELECT * FROM v_dashboard_counts').get() || {};

      // Determine date range filter for orders
      let dateFilterSql = "";
      const now = new Date();
      if (range === 'today') {
        const todayStr = now.toISOString().slice(0, 10);
        dateFilterSql = `WHERE created_at LIKE '${todayStr}%'`;
      } else if (range === '7d') {
        const past7d = new Date(Date.now() - 7 * 86400000).toISOString();
        dateFilterSql = `WHERE created_at >= '${past7d}'`;
      } else if (range === 'month') {
        const monthPrefix = now.toISOString().slice(0, 7);
        dateFilterSql = `WHERE created_at LIKE '${monthPrefix}%'`;
      } else if (range === 'last_month') {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthPrefix = lastMonth.toISOString().slice(0, 7);
        dateFilterSql = `WHERE created_at LIKE '${lastMonthPrefix}%'`;
      }

      // Query orders within range
      const ordersInRange = db.prepare(`SELECT id, status, created_at FROM orders ${dateFilterSql}`).all();

      let totalSaleValueMinor = 0;
      let totalPaymentsReceivedMinor = 0;
      let totalOutstandingBalanceMinor = 0;
      let totalPurchaseCostMinor = 0;
      let estimatedGrossProfitMinor = 0;
      let activeOrdersCount = 0;
      let completedOrdersCount = 0;
      let pendingOrdersCount = 0;

      for (const ord of ordersInRange) {
        if (ord.status === 'cancelled') continue; // exclude cancelled orders from active financial aggregates

        if (ord.status === 'completed') completedOrdersCount++;
        else pendingOrdersCount++;
        activeOrdersCount++;

        const fin = calculateOrderFinancials(ord.id, db);
        if (fin) {
          totalSaleValueMinor += fin.totalSaleAmount;
          totalPaymentsReceivedMinor += fin.netAmountReceived;
          totalOutstandingBalanceMinor += fin.remainingBalance;

          if (fin.totalPurchaseCost !== null) {
            totalPurchaseCostMinor += fin.totalPurchaseCost;
            estimatedGrossProfitMinor += (fin.estimatedGrossProfit || 0);
          }
        }
      }

      const recentCustomers = db.prepare(
        'SELECT id, phone, name, city, created_at FROM customers ORDER BY created_at DESC LIMIT 6'
      ).all();

      const recentOrders = db.prepare(
        `SELECT o.id, o.tracking_id, o.status, o.final_price_minor, o.subtotal_minor, o.currency,
                o.created_at, o.finalized_at, c.phone, c.name AS customer_name
         FROM orders o JOIN customers c ON c.id = o.customer_id
         ORDER BY o.created_at DESC LIMIT 6`
      ).all();

      res.json({
        counts,
        financials: {
          range,
          totalOrders: activeOrdersCount,
          completedOrders: completedOrdersCount,
          pendingOrders: pendingOrdersCount,
          totalSaleValueMinor,
          totalPaymentsReceivedMinor,
          totalOutstandingBalanceMinor,
          totalPurchaseCostMinor,
          estimatedGrossProfitMinor
        },
        recentCustomers,
        recentOrders
      });
    } catch (e) { next(e); }
  });

  // ORDER REGISTER: Centralized Ledger
  app.get('/api/register', (req         , res          , next              ) => {
    try {
      const { search, status, payment_status, category, has_balance, missing_cost, sort } = req.query                          ;
      const limit = Math.min(parseInt((req.query.limit          ) || '50', 10) || 50, 500);
      const offset = Math.max(parseInt((req.query.offset          ) || '0', 10) || 0, 0);

      const where           = [];
      const params        = [];

      if (status === 'progress') {
        where.push("o.status IN ('draft','pending','confirmed','processing','ready','dispatched')");
      } else if (status) {
        where.push('o.status = ?');
        params.push(status);
      }

      if (category) {
        where.push(`EXISTS (SELECT 1 FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id AND g.name = ?)`);
        params.push(category);
      }

      if (search) {
        where.push(`(o.tracking_id LIKE ? OR CAST(o.id AS TEXT) LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR c.phone_normalized LIKE ? OR c.whatsapp LIKE ? OR c.city LIKE ? OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.product_name LIKE ?))`);
        const q = `%${search}%`;
        params.push(q, q, q, q, q, q, q, q);
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

      // Fetch base order candidate rows
      const querySql = `
        SELECT o.id, o.tracking_id, o.status, o.delivery_status, o.payment_status AS raw_payment_status,
               o.currency, o.subtotal_minor, o.discount_minor, o.extra_charges_minor, o.final_price_minor,
               o.created_at, o.finalized_at,
               c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
               c.whatsapp AS customer_whatsapp, c.address AS customer_address, c.city AS customer_city,
               (SELECT GROUP_CONCAT(oi.product_name || ' (' || oi.quantity || ' ' || COALESCE(oi.size_variant, 'pcs') || ')', ', ')
                FROM order_items oi WHERE oi.order_id = o.id) AS product_summary
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        ${whereSql}
      `;

      const allMatchingOrders = db.prepare(querySql).all(...params);

      // Compute exact financial metrics for each row
      const processedRows = allMatchingOrders.map((ord     ) => {
        const fin = calculateOrderFinancials(ord.id, db);
        return {
          order_id: ord.id,
          customer_id: ord.customer_id,
          name: ord.customer_name || null,
          phone: ord.customer_phone,
          whatsapp: ord.customer_whatsapp,
          status: ord.status,
          tracking_id: ord.tracking_id || null,
          payment_status: fin ? fin.calculatedPaymentStatus : ord.raw_payment_status,
          product_summary: ord.product_summary || '—',
          amount_received_minor: fin ? fin.netAmountReceived : 0,
          total_sale_amount_minor: fin ? fin.totalSaleAmount : (ord.final_price_minor || ord.subtotal_minor || 0),
          remaining_balance_minor: fin ? fin.remainingBalance : 0,
          purchase_cost_minor: fin ? fin.totalPurchaseCost : null,
          has_missing_purchase_cost: fin ? fin.hasMissingItemCost : true,
          estimated_gross_profit_minor: fin ? fin.estimatedGrossProfit : null,
          profit_margin_percent: fin ? fin.profitMarginPercent : null,
          address: ord.customer_address || ord.customer_city || '—',
          city: ord.customer_city || null,
          currency: ord.currency || 'PKR',
          created_at: ord.created_at,
          finalized_at: ord.finalized_at
        };
      });

      // In-memory filters for calculated fields
      let filtered = processedRows;
      if (payment_status) {
        filtered = filtered.filter(r => r.payment_status === payment_status);
      }
      if (has_balance === '1') {
        filtered = filtered.filter(r => r.remaining_balance_minor > 0 && r.status !== 'cancelled');
      }
      if (missing_cost === '1') {
        filtered = filtered.filter(r => r.purchase_cost_minor === null);
      }

      // Sort
      if (sort === 'oldest') {
        filtered.sort((a, b) => a.created_at.localeCompare(b.created_at));
      } else if (sort === 'highest_sale') {
        filtered.sort((a, b) => b.total_sale_amount_minor - a.total_sale_amount_minor);
      } else if (sort === 'lowest_sale') {
        filtered.sort((a, b) => a.total_sale_amount_minor - b.total_sale_amount_minor);
      } else if (sort === 'highest_balance') {
        filtered.sort((a, b) => b.remaining_balance_minor - a.remaining_balance_minor);
      } else if (sort === 'highest_profit') {
        filtered.sort((a, b) => (b.estimated_gross_profit_minor || -Infinity) - (a.estimated_gross_profit_minor || -Infinity));
      } else {
        // Default newest
        filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
      }

      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);

      res.json({ rows: paginated, total, limit, offset });
    } catch (e) { next(e); }
  });

  // Orders: Single with Full Financials, Payments & History
  app.get('/api/orders/:id', (req         , res          , next              ) => {
    try {
      const order = getOrderFull(Number(req.params.id));
      if (!order) throw httpError(404, 'Order not found');
      res.json(order);
    } catch (e) { next(e); }
  });

  // Orders: List
  app.get('/api/orders', (req         , res          , next              ) => {
    try {
      const { status, finalized, progress, search } = req.query                          ;
      const limit = Math.min(parseInt((req.query.limit          ) || '50', 10) || 50, 500);
      const offset = Math.max(parseInt((req.query.offset          ) || '0', 10) || 0, 0);

      const where           = [];
      const params        = [];
      if (status) { where.push('o.status = ?'); params.push(status); }
      if (finalized === '1') where.push("o.status = 'completed'");
      if (progress === '1') where.push("o.status IN ('draft','pending','confirmed','processing','ready','dispatched')");
      if (search) {
        where.push(`(o.tracking_id LIKE ? OR CAST(o.id AS TEXT) LIKE ? OR c.phone LIKE ? OR c.name LIKE ?)`);
        const q = `%${search}%`;
        params.push(q, q, q, q);
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const countRow = db.prepare(
        `SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id ${whereSql}`
      ).get(...params);
      const total = countRow ? Number(countRow.n) : 0;

      const rows = db.prepare(
        `SELECT o.*, c.phone AS customer_phone, c.name AS customer_name,
          c.whatsapp AS customer_whatsapp,
          (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
          (SELECT GROUP_CONCAT(oi.product_name, ', ')
           FROM order_items oi WHERE oi.order_id = o.id) AS product_summary
         FROM orders o JOIN customers c ON c.id = o.customer_id
         ${whereSql}
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);

      // Attach financial summary to each row
      const processed = rows.map((r     ) => {
        const fin = calculateOrderFinancials(r.id, db);
        return {
          ...r,
          financials: fin
        };
      });

      res.json({ rows: processed, total, limit, offset });
    } catch (e) { next(e); }
  });

  // Orders: Create
  app.post('/api/customers/:id/orders', (req         , res          , next              ) => {
    try {
      const cid = Number(req.params.id);
      const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(cid);
      if (!customer) throw httpError(404, 'Customer not found');
      const b = req.body || {};
      const now = nowIso();
      const trackingId = generateTrackingId();

      const info = db.prepare(
        `INSERT INTO orders
         (customer_id, tracking_id, status, currency, discount_minor, extra_charges_minor,
          payment_notes, order_notes, product_requirements, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        cid, trackingId, b.currency || 'PKR',
        b.discount_minor || 0, b.extra_charges_minor || 0,
        b.payment_notes || null, b.order_notes || null,
        b.product_requirements || null, now, now
      );

      const orderId = Number(info.lastInsertRowid);
      db.prepare(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, reason)
         VALUES (?, NULL, 'draft', ?, 'Initial order draft created')`
      ).run(orderId, now);

      logActivity({ customerId: cid, orderId, actionType: 'order_created', details: { trackingId } });
      res.status(201).json(getOrderFull(orderId));
    } catch (e) { next(e); }
  });

  // Orders: Update Details & Pricing
  app.patch('/api/orders/:id', (req         , res          , next              ) => {
    try {
      const id = Number(req.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) throw httpError(404, 'Order not found');

      const b = req.body || {};
      const updates                      = {};
      for (const f of ['currency', 'payment_notes', 'order_notes', 'product_requirements', 'delivery_status', 'courier_tracking_no']) {
        if (b[f] !== undefined) updates[f] = b[f];
      }
      for (const f of ['discount_minor', 'extra_charges_minor']) {
        if (b[f] !== undefined) {
          const v = parseInt(b[f], 10);
          if (isNaN(v) || v < 0) throw httpError(400, `Invalid ${f}`);
          updates[f] = v;
        }
      }
      if (Object.keys(updates).length === 0) return res.json(getOrderFull(id));
      updates.updated_at = nowIso();
      const setSql = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE orders SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
      logActivity({ customerId: order.customer_id, orderId: id, actionType: 'order_updated', details: { fields: Object.keys(updates) } });
      res.json(getOrderFull(id));
    } catch (e) { next(e); }
  });

  // Orders: Change Status with Dedicated Audit History
  app.post('/api/orders/:id/status', (req         , res          , next              ) => {
    try {
      const id = Number(req.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) throw httpError(404, 'Order not found');

      const b = req.body || {};
      const newStatus = b.status;
      const reason = b.reason || null;
      const allowed = ['draft','pending','confirmed','processing','ready','dispatched','delivered','completed','cancelled','returned'];
      if (!allowed.includes(newStatus)) {
        throw httpError(400, `Invalid order status. Allowed: ${allowed.join(', ')}`);
      }

      const now = nowIso();
      const oldStatus = order.status;

      const extraUpdates           = [];
      const extraParams        = [];

      if (newStatus === 'confirmed' && !order.confirmed_at) {
        extraUpdates.push('confirmed_at = ?');
        extraParams.push(now);
      } else if (newStatus === 'delivered' && !order.delivered_at) {
        extraUpdates.push('delivered_at = ?');
        extraParams.push(now);
      } else if (newStatus === 'completed' && !order.finalized_at) {
        extraUpdates.push('finalized_at = ?');
        extraParams.push(now);
      } else if (newStatus === 'cancelled') {
        extraUpdates.push('cancelled_at = ?');
        extraParams.push(now);
      } else if (newStatus === 'returned') {
        extraUpdates.push('returned_at = ?');
        extraParams.push(now);
      }

      const setSql = ['status = ?', 'updated_at = ?', ...extraUpdates].join(', ');
      db.prepare(`UPDATE orders SET ${setSql} WHERE id = ?`).run(newStatus, now, ...extraParams, id);

      db.prepare(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, reason)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, oldStatus, newStatus, now, reason);

      logActivity({
        customerId: order.customer_id,
        orderId: id,
        actionType: 'status_changed',
        details: { oldStatus, newStatus, reason }
      });

      res.json(getOrderFull(id));
    } catch (e) { next(e); }
  });

  // Orders: Record Payment
  app.post('/api/orders/:id/payments', (req         , res          , next              ) => {
    try {
      const orderId = Number(req.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw httpError(404, 'Order not found');

      const b = req.body || {};
      const amountMinor = parseInt(b.amount_minor, 10);
      if (isNaN(amountMinor) || amountMinor <= 0) {
        throw httpError(400, 'Payment amount must be greater than zero');
      }

      const method = b.payment_method || 'cash';
      const allowedMethods = ['cash', 'bank_transfer', 'easypaisa', 'jazzcash', 'other'];
      if (!allowedMethods.includes(method)) {
        throw httpError(400, `Invalid payment method. Allowed: ${allowedMethods.join(', ')}`);
      }

      const paymentDate = b.payment_date || nowIso();
      const now = nowIso();

      const info = db.prepare(
        `INSERT INTO payments
         (order_id, amount_minor, currency, payment_method, payment_status, payment_reference, payment_date, created_at, notes)
         VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`
      ).run(
        orderId, amountMinor, order.currency || 'PKR', method,
        b.payment_reference || null, paymentDate, now, b.notes || null
      );

      const fin = calculateOrderFinancials(orderId, db);
      if (fin) {
        db.prepare('UPDATE orders SET payment_status = ?, amount_received_minor = ?, updated_at = ? WHERE id = ?')
          .run(fin.calculatedPaymentStatus, fin.netAmountReceived, now, orderId);
      }

      logActivity({
        customerId: order.customer_id,
        orderId,
        actionType: 'payment_received',
        details: { amountMinor, method, reference: b.payment_reference }
      });

      res.status(201).json({
        payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid),
        order: getOrderFull(orderId)
      });
    } catch (e) { next(e); }
  });

  // Orders: Record Refund
  app.post('/api/orders/:id/refunds', (req         , res          , next              ) => {
    try {
      const orderId = Number(req.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw httpError(404, 'Order not found');

      const b = req.body || {};
      const amountMinor = parseInt(b.amount_minor, 10);
      if (isNaN(amountMinor) || amountMinor <= 0) {
        throw httpError(400, 'Refund amount must be greater than zero');
      }

      const finCurrent = calculateOrderFinancials(orderId, db);
      if (finCurrent && amountMinor > finCurrent.netAmountReceived) {
        throw httpError(400, `Refund cannot exceed net received amount (${finCurrent.netAmountReceived / 100} ${order.currency})`);
      }

      const now = nowIso();
      const info = db.prepare(
        `INSERT INTO refunds
         (order_id, payment_id, amount_minor, currency, refund_date, status, reason, created_at)
         VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`
      ).run(
        orderId, b.payment_id || null, amountMinor, order.currency || 'PKR',
        b.refund_date || now, b.reason || null, now
      );

      const fin = calculateOrderFinancials(orderId, db);
      if (fin) {
        db.prepare('UPDATE orders SET payment_status = ?, amount_received_minor = ?, updated_at = ? WHERE id = ?')
          .run(fin.calculatedPaymentStatus, fin.netAmountReceived, now, orderId);
      }

      logActivity({
        customerId: order.customer_id,
        orderId,
        actionType: 'refund_issued',
        details: { amountMinor, reason: b.reason }
      });

      res.status(201).json({
        refund: db.prepare('SELECT * FROM refunds WHERE id = ?').get(info.lastInsertRowid),
        order: getOrderFull(orderId)
      });
    } catch (e) { next(e); }
  });

  // Orders: Add Direct Expense
  app.post('/api/orders/:id/expenses', (req         , res          , next              ) => {
    try {
      const orderId = Number(req.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw httpError(404, 'Order not found');

      const b = req.body || {};
      const amountMinor = parseInt(b.amount_minor, 10);
      if (isNaN(amountMinor) || amountMinor < 0) {
        throw httpError(400, 'Expense amount cannot be negative');
      }

      const now = nowIso();
      const info = db.prepare(
        `INSERT INTO order_expenses
         (order_id, expense_type, description, amount_minor, currency, expense_date, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        orderId, b.expense_type || 'other', b.description || null,
        amountMinor, order.currency || 'PKR', b.expense_date || now,
        b.notes || null, now
      );

      logActivity({
        customerId: order.customer_id,
        orderId,
        actionType: 'expense_added',
        details: { expenseType: b.expense_type, amountMinor }
      });

      res.status(201).json({
        expense: db.prepare('SELECT * FROM order_expenses WHERE id = ?').get(info.lastInsertRowid),
        order: getOrderFull(orderId)
      });
    } catch (e) { next(e); }
  });

  // Order Items: Add with Unit Sale Price & Unit Purchase Cost
  app.post('/api/orders/:id/items', (req         , res          , next              ) => {
    try {
      const orderId = Number(req.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw httpError(404, 'Order not found');

      const b = req.body || {};
      if (!b.product_name || !String(b.product_name).trim()) {
        throw httpError(400, 'Product name is required');
      }
      const qty = Math.max(1, parseInt(b.quantity || 1, 10) || 1);
      const unitSale = Math.max(0, parseInt(b.unit_sale_price_minor ?? b.unit_price_minor ?? 0, 10) || 0);
      const unitCost = b.unit_purchase_cost_minor !== undefined && b.unit_purchase_cost_minor !== null && b.unit_purchase_cost_minor !== ''
        ? Math.max(0, parseInt(b.unit_purchase_cost_minor, 10))
        : null;
      const disc = Math.max(0, parseInt(b.discount_minor || 0, 10) || 0);
      const lineSale = Math.max(0, qty * unitSale - disc);
      const lineCost = unitCost !== null ? qty * unitCost : null;

      const now = nowIso();
      const info = db.prepare(
        `INSERT INTO order_items
         (order_id, product_name, product_sku, description, size_variant,
          quantity, unit_price_minor, unit_sale_price_minor, unit_purchase_cost_minor,
          discount_minor, line_total_minor, line_sale_total_minor, line_purchase_total_minor,
          created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        orderId, String(b.product_name).trim(), b.product_sku || null,
        b.description || null, b.size_variant || null,
        qty, unitSale, unitSale, unitCost,
        disc, lineSale, lineSale, lineCost,
        now, now
      );

      recalcSubtotal(orderId);
      res.status(201).json(db.prepare('SELECT * FROM order_items WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) { next(e); }
  });

  // Order Items: Update (including Cost & Prices)
  app.patch('/api/orders/:id/items/:itemId', (req         , res          , next              ) => {
    try {
      const orderId = Number(req.params.id);
      const itemId = Number(req.params.itemId);
      const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
      if (!item) throw httpError(404, 'Order item not found');

      const b = req.body || {};
      const qty = b.quantity !== undefined ? Math.max(1, parseInt(b.quantity, 10)) : item.quantity;
      const unitSale = b.unit_sale_price_minor !== undefined
        ? Math.max(0, parseInt(b.unit_sale_price_minor, 10))
        : (item.unit_sale_price_minor || item.unit_price_minor);
      const unitCost = b.unit_purchase_cost_minor !== undefined
        ? (b.unit_purchase_cost_minor !== null && b.unit_purchase_cost_minor !== '' ? Math.max(0, parseInt(b.unit_purchase_cost_minor, 10)) : null)
        : item.unit_purchase_cost_minor;
      const disc = b.discount_minor !== undefined ? Math.max(0, parseInt(b.discount_minor, 10)) : item.discount_minor;

      const lineSale = Math.max(0, qty * unitSale - disc);
      const lineCost = unitCost !== null ? qty * unitCost : null;
      const now = nowIso();

      db.prepare(
        `UPDATE order_items
         SET product_name = COALESCE(?, product_name),
             size_variant = COALESCE(?, size_variant),
             quantity = ?,
             unit_price_minor = ?,
             unit_sale_price_minor = ?,
             unit_purchase_cost_minor = ?,
             discount_minor = ?,
             line_total_minor = ?,
             line_sale_total_minor = ?,
             line_purchase_total_minor = ?,
             updated_at = ?
         WHERE id = ? AND order_id = ?`
      ).run(
        b.product_name || null, b.size_variant || null,
        qty, unitSale, unitSale, unitCost, disc,
        lineSale, lineSale, lineCost, now,
        itemId, orderId
      );

      recalcSubtotal(orderId);
      logActivity({
        orderId,
        actionType: 'item_updated',
        details: { itemId, unitPurchaseCostMinor: unitCost, unitSalePriceMinor: unitSale }
      });

      res.json(db.prepare('SELECT * FROM order_items WHERE id = ?').get(itemId));
    } catch (e) { next(e); }
  });

  // Order Items: Delete
  app.delete('/api/orders/:id/items/:itemId', (req         , res          , next              ) => {
    try {
      const orderId = Number(req.params.id);
      const itemId = Number(req.params.itemId);
      db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(itemId, orderId);
      recalcSubtotal(orderId);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Orders: Finalize (Atomic Lock & Snapshot)
  app.post('/api/orders/:id/finalize', (req         , res          , next              ) => {
    try {
      const id = Number(req.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) throw httpError(404, 'Order not found');
      if (order.status === 'completed') throw httpError(400, 'Order already finalized');

      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
      if (!items.length) throw httpError(400, 'Order must have at least one product line item to finalize');

      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
      if (!customer) throw httpError(400, 'Associated customer not found');

      const fin = calculateOrderFinancials(id, db);
      const finalPrice = fin ? fin.totalSaleAmount : order.subtotal_minor;

      const tx = db.transaction(() => {
        let trackingId = order.tracking_id;
        if (!trackingId) trackingId = generateTrackingId();
        const now = nowIso();
        db.prepare(
          `UPDATE orders SET
            status = 'completed',
            tracking_id = ?,
            finalized_at = ?,
            final_price_minor = ?,
            total_sale_amount_minor = ?,
            updated_at = ?,
            customer_name_snapshot     = COALESCE(customer_name_snapshot, ?),
            customer_phone_snapshot    = COALESCE(customer_phone_snapshot, ?),
            customer_whatsapp_snapshot = COALESCE(customer_whatsapp_snapshot, ?),
            shipping_address_snapshot  = COALESCE(shipping_address_snapshot, ?)
           WHERE id = ?`
        ).run(
          trackingId, now, finalPrice, finalPrice, now,
          customer.name, customer.phone, customer.whatsapp, customer.address,
          id
        );

        db.prepare(
          `INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, reason)
           VALUES (?, ?, 'completed', ?, 'Order finalized with locked price and tracking ID')`
        ).run(id, order.status, now);

        logActivity({
          customerId: order.customer_id,
          orderId: id,
          actionType: 'order_finalized',
          details: { trackingId, finalPriceMinor: finalPrice }
        });
        return trackingId;
      });

      const trackingId = tx();
      res.json({ order: getOrderFull(id), trackingId });
    } catch (e) { next(e); }
  });

  // Tracking Lookup
  app.get('/api/tracking/:trackingId', (req         , res          , next              ) => {
    try {
      const row = db.prepare('SELECT id FROM orders WHERE tracking_id = ?').get(req.params.trackingId);
      if (!row) throw httpError(404, 'Tracking ID not found');
      res.json(getOrderFull(row.id));
    } catch (e) { next(e); }
  });

  // Customers: List
  app.get('/api/customers', (req         , res          , next              ) => {
    try {
      const { category, filter, search, status } = req.query                          ;
      const limit = Math.min(parseInt((req.query.limit          ) || '50', 10) || 50, 500);
      const offset = Math.max(parseInt((req.query.offset          ) || '0', 10) || 0, 0);

      const where           = [];
      const params        = [];

      if (status) {
        where.push('c.status = ?');
        params.push(status);
      } else {
        where.push("c.status <> 'archived'");
      }

      if (category) {
        where.push(`EXISTS (SELECT 1 FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id AND g.name = ?)`);
        params.push(category);
      }

      if (filter === 'previous') {
        where.push(`EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed')`);
      } else if (filter === 'hardware') {
        where.push(`EXISTS (SELECT 1 FROM hardware_requirements h WHERE h.customer_id = c.id)`);
      } else if (filter === 'uncategorized') {
        where.push(`NOT EXISTS (SELECT 1 FROM customer_categories cc WHERE cc.customer_id = c.id)`);
      }

      if (search) {
        where.push(`(c.phone LIKE ? OR c.phone_normalized LIKE ? OR c.whatsapp LIKE ? OR c.name LIKE ? OR c.city LIKE ?)`);
        const q = `%${search}%`;
        params.push(q, q, q, q, q);
      }

      const whereSql = 'WHERE ' + where.join(' AND ');
      const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM customers c ${whereSql}`).get(...params);
      const total = totalRow ? Number(totalRow.n) : 0;

      const rows = db.prepare(
        `SELECT c.*,
          (SELECT GROUP_CONCAT(g.name, ',') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id) AS category_list,
          (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS completed_order_count,
          (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count
         FROM customers c ${whereSql}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);

      res.json({ rows, total, limit, offset });
    } catch (e) { next(e); }
  });

  // Customers: Create
  app.post('/api/customers', (req         , res          , next              ) => {
    try {
      const b = req.body || {};
      const phone = (b.phone || '').trim();
      if (!phone) throw httpError(400, 'Phone number is required');
      const norm = normalizePhone(phone);
      if (!norm) throw httpError(400, 'Invalid phone number format');

      const existing = db.prepare('SELECT * FROM customers WHERE phone_normalized = ?').get(norm);
      if (existing) {
        return res.status(200).json({ customer: existing, duplicate: true });
      }

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
      ).run(
        phone, norm, b.name || null, whatsapp, whatsappNorm,
        b.alternate_phone || null, b.email || null,
        b.address || null, b.city || null, b.province || null,
        b.country || null,
        b.status || 'active',
        b.lead_status || null, b.lead_source || null,
        b.preferred_contact || null, b.notes || null,
        now, now
      );

      const id = Number(info.lastInsertRowid);
      logActivity({ customerId: id, actionType: 'customer_created', details: { phone: norm } });
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      res.status(201).json({ customer, duplicate: false });
    } catch (e) { next(e); }
  });

  // Customer: Single
  app.get('/api/customers/:id', (req         , res          , next              ) => {
    try {
      const id = Number(req.params.id);
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      if (!customer) throw httpError(404, 'Customer not found');
      customer.categories = db.prepare(
        `SELECT c.id, c.name FROM customer_categories cc JOIN categories c ON c.id = cc.category_id WHERE cc.customer_id = ?`
      ).all(id);
      res.json(customer);
    } catch (e) { next(e); }
  });

  // Customer: Update
  app.patch('/api/customers/:id', (req         , res          , next              ) => {
    try {
      const id = Number(req.params.id);
      const current = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      if (!current) throw httpError(404, 'Customer not found');

      const b = req.body || {};
      const allowed = ['name', 'whatsapp', 'alternate_phone', 'email', 'address', 'city', 'province', 'country', 'status', 'lead_status', 'lead_source', 'preferred_contact', 'notes'];
      const updates                      = {};
      for (const f of allowed) {
        if (b[f] !== undefined) updates[f] = b[f] === '' ? null : b[f];
      }
      if (b.whatsapp !== undefined) updates.whatsapp_normalized = b.whatsapp ? normalizePhone(b.whatsapp) : null;
      if (b.phone !== undefined && b.phone !== current.phone) {
        const norm = normalizePhone(b.phone);
        if (!norm) throw httpError(400, 'Invalid phone number');
        const clash = db.prepare('SELECT id FROM customers WHERE phone_normalized = ? AND id <> ?').get(norm, id);
        if (clash) throw httpError(409, 'Phone already used by another customer');
        updates.phone = b.phone;
        updates.phone_normalized = norm;
      }
      if (Object.keys(updates).length === 0) return res.json(current);
      updates.updated_at = nowIso();
      const setSql = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE customers SET ${setSql} WHERE id = ?`).run(...Object.values(updates), id);
      logActivity({ customerId: id, actionType: 'customer_updated', details: { fields: Object.keys(updates) } });
      res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
    } catch (e) { next(e); }
  });

  // Customer: Categories
  app.put('/api/customers/:id/categories', (req         , res          , next              ) => {
    try {
      const id = Number(req.params.id);
      const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
      if (!customer) throw httpError(404, 'Customer not found');
      const names           = Array.isArray(req.body?.categories) ? req.body.categories : [];
      const getCat = db.prepare('SELECT id FROM categories WHERE name = ?');

      const tx = db.transaction(() => {
        db.prepare('DELETE FROM customer_categories WHERE customer_id = ?').run(id);
        const ins = db.prepare('INSERT INTO customer_categories (customer_id, category_id) VALUES (?, ?)');
        for (const n of names) {
          const cat = getCat.get(n);
          if (cat) ins.run(id, cat.id);
        }
      });
      tx();

      logActivity({ customerId: id, actionType: 'categories_updated', details: { categories: names } });
      const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) || {};
      c.categories = db.prepare(`SELECT c.id, c.name FROM customer_categories cc JOIN categories c ON c.id = cc.category_id WHERE cc.customer_id = ?`).all(id);
      res.json(c);
    } catch (e) { next(e); }
  });

  // Categories
  app.get('/api/categories', (req         , res          , next              ) => {
    try {
      res.json(db.prepare('SELECT * FROM categories ORDER BY name ASC').all());
    } catch (e) { next(e); }
  });

  // Customer Activity Log
  app.get('/api/customers/:id/activity', (req         , res          , next              ) => {
    try {
      res.json(db.prepare('SELECT * FROM activity_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100').all(Number(req.params.id)));
    } catch (e) { next(e); }
  });

  // Hardware Requirements
  app.get('/api/customers/:id/hardware', (req         , res          , next              ) => {
    try {
      res.json(db.prepare('SELECT * FROM hardware_requirements WHERE customer_id = ? ORDER BY created_at DESC').all(Number(req.params.id)));
    } catch (e) { next(e); }
  });

  app.post('/api/customers/:id/hardware', (req         , res          , next              ) => {
    try {
      const cid = Number(req.params.id);
      const b = req.body || {};
      const now = nowIso();
      const info = db.prepare(
        `INSERT INTO hardware_requirements
         (customer_id, product_name, brand, model, specifications, quantity, budget_minor, currency, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        cid, b.product_name || null, b.brand || null, b.model || null,
        b.specifications || null,
        b.quantity ? parseInt(b.quantity, 10) : null,
        b.budget_minor != null ? parseInt(b.budget_minor, 10) : null,
        b.currency || 'PKR',
        b.notes || null, now, now
      );
      res.status(201).json(db.prepare('SELECT * FROM hardware_requirements WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) { next(e); }
  });

  app.get('/api/hardware', (req         , res          , next              ) => {
    try {
      res.json(db.prepare(
        `SELECT h.*, c.phone, c.name AS customer_name, c.whatsapp
         FROM hardware_requirements h JOIN customers c ON c.id = h.customer_id
         ORDER BY h.created_at DESC`
      ).all());
    } catch (e) { next(e); }
  });

  // Messages
  app.post('/api/customers/:id/messages', (req         , res          , next              ) => {
    try {
      const cid = Number(req.params.id);
      const b = req.body || {};
      const now = nowIso();
      const info = db.prepare(
        `INSERT INTO customer_messages (customer_id, order_id, source, message_text, message_at, notes, created_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(cid, b.order_id || null, b.source || 'whatsapp', b.message_text, b.message_at || null, b.notes || null, now);
      res.status(201).json(db.prepare('SELECT * FROM customer_messages WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) { next(e); }
  });

  app.get('/api/customers/:id/messages', (req         , res          , next              ) => {
    try {
      res.json(db.prepare('SELECT * FROM customer_messages WHERE customer_id = ? ORDER BY created_at DESC').all(Number(req.params.id)));
    } catch (e) { next(e); }
  });

  // Global Multi-field Search
  app.get('/api/search', (req         , res          , next              ) => {
    try {
      const q = ((req.query.q          ) || '').trim();
      if (!q) return res.json({ customers: [], orders: [] });
      const like = `%${q}%`;
      const customers = db.prepare(
        `SELECT id, phone, phone_normalized, whatsapp, name, city, created_at
         FROM customers
         WHERE phone LIKE ? OR phone_normalized LIKE ? OR whatsapp LIKE ? OR name LIKE ? OR city LIKE ?
         ORDER BY created_at DESC LIMIT 20`
      ).all(like, like, like, like, like);
      const orders = db.prepare(
        `SELECT o.id, o.tracking_id, o.status, o.final_price_minor, o.subtotal_minor, o.currency,
                o.created_at, o.finalized_at, c.phone, c.name AS customer_name
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE o.tracking_id LIKE ? OR CAST(o.id AS TEXT) LIKE ? OR c.phone LIKE ? OR c.name LIKE ?
         ORDER BY o.created_at DESC LIMIT 20`
      ).all(like, like, like, like);
      res.json({ customers, orders });
    } catch (e) { next(e); }
  });

  // Backups
  app.get('/api/backups', (req         , res          , next              ) => {
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith('.sqlite'))
        .map((f) => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { filename: f, size: st.size, modified: st.mtime.toISOString() };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
      res.json(files);
    } catch (e) { next(e); }
  });

  app.post('/api/backup', (req         , res          , next              ) => {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `backup-${ts}.sqlite`;
      const dest = path.join(BACKUP_DIR, filename);
      const data = db.getRawDb().export();
      fs.writeFileSync(dest, Buffer.from(data));
      res.json({ filename, path: dest, size: data.byteLength });
    } catch (e) { next(e); }
  });

  app.post('/api/restore', (req         , res          , next              ) => {
    try {
      const filename = req.body?.filename;
      if (!filename) throw httpError(400, 'Filename required');
      const safe = path.basename(filename);
      const src = path.join(BACKUP_DIR, safe);
      if (!fs.existsSync(src)) throw httpError(404, 'Backup file not found');

      const filebuffer = fs.readFileSync(src);
      const testDb = new SQL.Database(filebuffer);
      const testRes = testDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='customers';");
      if (!testRes || testRes.length === 0) throw httpError(400, 'Invalid backup database format');

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safetyDest = path.join(BACKUP_DIR, `pre-restore-safety-${ts}.sqlite`);
      fs.writeFileSync(safetyDest, Buffer.from(db.getRawDb().export()));

      // Swap the live in-memory database so later saves do not overwrite the restored data
      db.replaceDb(testDb);
      db.exec(SCHEMA);
      runMigrations(db);
      res.json({ ok: true, message: 'Database restored successfully! Reloading view.' });
    } catch (e) { next(e); }
  });

  /* ---------------- v1.3: settings, categories, lists, reports, CSV ---------------- */
  const pageOf = (req) => ({
    limit: Math.min(parseInt(req.query.limit || '50', 10) || 50, 500),
    offset: Math.max(parseInt(req.query.offset || '0', 10) || 0, 0),
  });
  const like = (v) => `%${String(v).replace(/[%_]/g, '')}%`;
  const kfmt = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
  const kday = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  const money = (m) => (m === null || m === undefined) ? '' : (Number(m) / 100).toFixed(2);

  app.get('/api/settings', (req, res, next) => {
    try {
      const out = {};
      for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
      res.json(out);
    } catch (e) { next(e); }
  });

  app.put('/api/settings', (req, res, next) => {
    try {
      const b = req.body || {};
      const upd = {};
      if (b.business_name !== undefined) {
        const v = String(b.business_name).trim();
        if (!v || v.length > 80) throw httpError(400, 'Business name must be 1-80 characters');
        upd.business_name = v;
      }
      if (b.tracking_prefix !== undefined) {
        const v = String(b.tracking_prefix).trim().toUpperCase();
        if (!/^[A-Z0-9]{1,6}$/.test(v)) throw httpError(400, 'Tracking prefix must be 1-6 letters or digits');
        upd.tracking_prefix = v;
      }
      if (b.default_currency !== undefined) {
        const v = String(b.default_currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(v)) throw httpError(400, 'Currency must be a 3-letter code such as PKR');
        upd.default_currency = v;
      }
      for (const [k, v] of Object.entries(upd)) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);
      logActivity({ actionType: 'settings_updated', details: upd });
      res.json({ ok: true, updated: upd });
    } catch (e) { next(e); }
  });

  app.get('/api/categories/summary', (req, res, next) => {
    try {
      const rows = db.prepare(`SELECT g.id, g.name, (SELECT COUNT(*) FROM customer_categories cc JOIN customers c ON c.id = cc.customer_id WHERE cc.category_id = g.id AND c.status <> 'archived') AS customers FROM categories g ORDER BY g.name`).all();
      const c = db.prepare('SELECT * FROM v_dashboard_counts').get() || {};
      res.json({ categories: rows, derived: { previous_customers: c.previous_customers || 0, hardware_requirements: c.hardware_requirements || 0, uncategorized: c.uncategorized || 0 } });
    } catch (e) { next(e); }
  });

  app.post('/api/categories', (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name || name.length > 40) throw httpError(400, 'Category name must be 1-40 characters');
      if (db.prepare('SELECT 1 AS x FROM categories WHERE lower(name) = lower(?)').get(name)) throw httpError(409, 'A category with this name already exists');
      const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
      logActivity({ actionType: 'category_created', details: { name } });
      res.status(201).json({ id: r.lastInsertRowid, name });
    } catch (e) { next(e); }
  });

  app.patch('/api/categories/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const name = String(req.body?.name || '').trim();
      if (!name || name.length > 40) throw httpError(400, 'Category name must be 1-40 characters');
      if (!db.prepare('SELECT 1 AS x FROM categories WHERE id = ?').get(id)) throw httpError(404, 'Category not found');
      if (db.prepare('SELECT 1 AS x FROM categories WHERE lower(name) = lower(?) AND id <> ?').get(name, id)) throw httpError(409, 'A category with this name already exists');
      db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
      logActivity({ actionType: 'category_renamed', details: { id, name } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.delete('/api/categories/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const n = db.prepare('SELECT COUNT(*) AS n FROM customer_categories WHERE category_id = ?').get(id);
      if (n && Number(n.n) > 0) throw httpError(409, `Category is assigned to ${n.n} customer(s). Remove it from them first.`);
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      logActivity({ actionType: 'category_deleted', details: { id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get('/api/payments', (req, res, next) => {
    try {
      const { search, method, from, to } = req.query;
      const { limit, offset } = pageOf(req);
      const w = []; const p = [];
      if (search) { w.push('(o.tracking_id LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR p.payment_reference LIKE ?)'); const q = like(search); p.push(q, q, q, q); }
      if (method) { w.push('p.payment_method = ?'); p.push(method); }
      if (from) { w.push('substr(p.payment_date,1,10) >= ?'); p.push(from); }
      if (to) { w.push('substr(p.payment_date,1,10) <= ?'); p.push(to); }
      const ws = w.length ? 'WHERE ' + w.join(' AND ') : '';
      const base = `FROM payments p JOIN orders o ON o.id = p.order_id JOIN customers c ON c.id = o.customer_id ${ws}`;
      const total = Number(db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...p).n);
      const rows = db.prepare(`SELECT p.id, p.order_id, o.tracking_id, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, p.amount_minor, p.currency, p.payment_method, p.payment_status, p.payment_reference, p.payment_date, p.notes ${base} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset);
      res.json({ rows, total, limit, offset });
    } catch (e) { next(e); }
  });

  app.get('/api/expenses', (req, res, next) => {
    try {
      const { search, from, to } = req.query;
      const { limit, offset } = pageOf(req);
      const w = []; const p = [];
      if (search) { w.push('(o.tracking_id LIKE ? OR c.name LIKE ? OR e.expense_type LIKE ? OR e.description LIKE ?)'); const q = like(search); p.push(q, q, q, q); }
      if (from) { w.push('substr(e.expense_date,1,10) >= ?'); p.push(from); }
      if (to) { w.push('substr(e.expense_date,1,10) <= ?'); p.push(to); }
      const ws = w.length ? 'WHERE ' + w.join(' AND ') : '';
      const base = `FROM order_expenses e JOIN orders o ON o.id = e.order_id JOIN customers c ON c.id = o.customer_id ${ws}`;
      const total = Number(db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...p).n);
      const rows = db.prepare(`SELECT e.id, e.order_id, o.tracking_id, c.name AS customer_name, c.phone AS customer_phone, e.expense_type, e.description, e.amount_minor, e.currency, e.expense_date ${base} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset);
      res.json({ rows, total, limit, offset });
    } catch (e) { next(e); }
  });

  app.get('/api/activity', (req, res, next) => {
    try {
      const { search, from, to } = req.query;
      const { limit, offset } = pageOf(req);
      const w = []; const p = [];
      if (search) { w.push('(a.action_type LIKE ? OR a.details_json LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR o.tracking_id LIKE ?)'); const q = like(search); p.push(q, q, q, q, q); }
      if (from) { w.push('substr(a.created_at,1,10) >= ?'); p.push(from); }
      if (to) { w.push('substr(a.created_at,1,10) <= ?'); p.push(to); }
      const ws = w.length ? 'WHERE ' + w.join(' AND ') : '';
      const base = `FROM activity_logs a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN orders o ON o.id = a.order_id ${ws}`;
      const total = Number(db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...p).n);
      const rows = db.prepare(`SELECT a.id, a.action_type, a.details_json, a.created_at, a.customer_id, a.order_id, c.name AS customer_name, c.phone AS customer_phone, o.tracking_id ${base} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset);
      res.json({ rows, total, limit, offset });
    } catch (e) { next(e); }
  });

  const REPORTS = {
    customers: 'Customer report', orders: 'Orders report', completed: 'Completed orders report',
    payments: 'Payment report', outstanding: 'Outstanding balance report', costs: 'Product purchase cost report',
    expenses: 'Business expenses report', profit: 'Estimated profit report',
    categories: 'Category-wise customer report', sales_by_date: 'Date-wise sales report',
  };
  const NOCOST = 'Cost not entered';
  const NOPROFIT = 'Profit unavailable (incomplete cost data)';

  function buildReport(type, from, to) {
    const inR = (iso) => { if (!iso) return false; const d = kday(iso); return (!from || d >= from) && (!to || d <= to); };
    const orderRows = (useFinal) => db.prepare(`SELECT o.id, o.tracking_id, o.status, o.created_at, o.finalized_at, c.name, c.phone FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.created_at DESC`).all()
      .filter((o) => inR(useFinal ? o.finalized_at : o.created_at)).map((o) => ({ o, f: calculateOrderFinancials(o.id, db) }));
    let columns = []; let rows = [];
    switch (type) {
      case 'customers':
        columns = ['Customer ID', 'Name', 'Phone', 'WhatsApp', 'City', 'Categories', 'Added (Karachi)'];
        rows = db.prepare(`SELECT c.id, c.name, c.phone, c.whatsapp, c.city, c.created_at, (SELECT GROUP_CONCAT(g.name, ' / ') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = c.id) AS cats FROM customers c ORDER BY c.created_at DESC`).all()
          .filter((c) => inR(c.created_at)).map((c) => ['C-' + String(c.id).padStart(4, '0'), c.name || '', c.phone, c.whatsapp || '', c.city || '', c.cats || 'Uncategorized', kfmt(c.created_at)]);
        break;
      case 'orders':
        columns = ['Tracking ID', 'Customer', 'Phone', 'Status', 'Payment status', 'Sale amount', 'Received', 'Remaining', 'Purchase cost', 'Created (Karachi)'];
        rows = orderRows(false).map(({ o, f }) => [o.tracking_id || '', o.name || '', o.phone, o.status, f.calculatedPaymentStatus, money(f.totalSaleAmount), money(f.netAmountReceived), money(f.remainingBalance), f.totalPurchaseCost === null ? NOCOST : money(f.totalPurchaseCost), kfmt(o.created_at)]);
        break;
      case 'completed':
        columns = ['Tracking ID', 'Customer', 'Phone', 'Final payable', 'Received', 'Purchase cost', 'Estimated profit', 'Completed (Karachi, with day)'];
        rows = orderRows(true).filter(({ o }) => o.status === 'completed').map(({ o, f }) => [o.tracking_id, o.name || '', o.phone, money(f.totalSaleAmount), money(f.netAmountReceived), f.totalPurchaseCost === null ? NOCOST : money(f.totalPurchaseCost), f.estimatedNetProfit === null || f.estimatedNetProfit === undefined ? NOPROFIT : money(f.estimatedNetProfit), kfmt(o.finalized_at)]);
        break;
      case 'payments':
        columns = ['Date (Karachi)', 'Tracking ID', 'Customer', 'Method', 'Amount', 'Status', 'Reference'];
        rows = db.prepare(`SELECT p.*, o.tracking_id, c.name FROM payments p JOIN orders o ON o.id = p.order_id JOIN customers c ON c.id = o.customer_id ORDER BY p.payment_date DESC`).all()
          .filter((p) => inR(p.payment_date)).map((p) => [kfmt(p.payment_date), p.tracking_id || '', p.name || '', p.payment_method, money(p.amount_minor), p.payment_status, p.payment_reference || '']);
        break;
      case 'outstanding':
        columns = ['Tracking ID', 'Customer', 'Phone', 'Status', 'Final payable', 'Received', 'Remaining balance'];
        rows = orderRows(false).filter(({ o, f }) => o.status !== 'cancelled' && f.remainingBalance > 0).map(({ o, f }) => [o.tracking_id || '', o.name || '', o.phone, o.status, money(f.totalSaleAmount), money(f.netAmountReceived), money(f.remainingBalance)]);
        break;
      case 'costs':
        columns = ['Tracking ID', 'Product', 'Qty', 'Unit cost', 'Total cost'];
        rows = db.prepare(`SELECT i.product_name, i.quantity, i.unit_purchase_cost_minor, o.tracking_id, o.created_at FROM order_items i JOIN orders o ON o.id = i.order_id ORDER BY o.created_at DESC`).all()
          .filter((i) => inR(i.created_at)).map((i) => [i.tracking_id || '', i.product_name, i.quantity, i.unit_purchase_cost_minor === null ? NOCOST : money(i.unit_purchase_cost_minor), i.unit_purchase_cost_minor === null ? NOCOST : money(i.unit_purchase_cost_minor * i.quantity)]);
        break;
      case 'expenses':
        columns = ['Date (Karachi)', 'Tracking ID', 'Type', 'Description', 'Amount'];
        rows = db.prepare(`SELECT e.*, o.tracking_id FROM order_expenses e JOIN orders o ON o.id = e.order_id ORDER BY e.expense_date DESC`).all()
          .filter((e) => inR(e.expense_date)).map((e) => [kfmt(e.expense_date), e.tracking_id || '', e.expense_type, e.description || '', money(e.amount_minor)]);
        break;
      case 'profit':
        columns = ['Tracking ID', 'Customer', 'Sale amount', 'Product cost', 'Direct expenses', 'Gross profit', 'Net profit', 'Margin %'];
        rows = orderRows(false).filter(({ o }) => !['cancelled', 'returned'].includes(o.status)).map(({ o, f }) => {
          const ok = f.totalPurchaseCost !== null && !f.hasMissingItemCost;
          return [o.tracking_id || '', o.name || '', money(f.totalSaleAmount), ok ? money(f.itemsPurchaseCostTotal) : NOCOST, money(f.directExpenses), ok ? money(f.estimatedGrossProfit) : NOPROFIT, ok ? money(f.estimatedNetProfit) : NOPROFIT, ok && f.profitMarginPercent !== null && f.profitMarginPercent !== undefined ? String(f.profitMarginPercent) : ''];
        });
        break;
      case 'categories': {
        columns = ['Category', 'Customers'];
        const cs = db.prepare(`SELECT g.name, (SELECT COUNT(*) FROM customer_categories cc JOIN customers c ON c.id = cc.customer_id WHERE cc.category_id = g.id AND c.status <> 'archived') AS n FROM categories g ORDER BY g.name`).all();
        const v = db.prepare('SELECT * FROM v_dashboard_counts').get() || {};
        rows = cs.map((r) => [r.name, r.n]).concat([['Previous customers (has a completed order)', v.previous_customers || 0], ['With hardware requirements', v.hardware_requirements || 0], ['Uncategorized', v.uncategorized || 0]]);
        break;
      }
      case 'sales_by_date': {
        columns = ['Date (Karachi)', 'Orders', 'Sale value', 'Cash received'];
        const m = new Map();
        for (const { o, f } of orderRows(false)) {
          if (['cancelled', 'returned'].includes(o.status)) continue;
          const d = kday(o.created_at);
          const e = m.get(d) || { n: 0, sale: 0, rec: 0 };
          e.n++; e.sale += f.totalSaleAmount; e.rec += f.netAmountReceived; m.set(d, e);
        }
        rows = [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, e]) => [d, e.n, money(e.sale), money(e.rec)]);
        break;
      }
      default: throw httpError(404, 'Unknown report');
    }
    return { type, title: REPORTS[type], from: from || null, to: to || null, note: 'Cancelled and returned orders are excluded from sales and profit reports. Amounts are in major currency units.', columns, rows };
  }

  function csvCell(v) {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t; // block spreadsheet formula injection
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  app.get('/api/reports', (req, res) => res.json({ reports: Object.entries(REPORTS).map(([id, title]) => ({ id, title })) }));

  app.get('/api/reports/:type', (req, res, next) => {
    try {
      const { from, to, format } = req.query;
      for (const d of [from, to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw httpError(400, 'Dates must be YYYY-MM-DD');
      const rep = buildReport(req.params.type, from, to);
      if (format === 'csv') {
        const lines = [rep.columns, ...rep.rows].map((r) => r.map(csvCell).join(','));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${kday(new Date().toISOString())}.csv"`);
        return res.send('\uFEFF' + lines.join('\r\n'));
      }
      res.json(rep);
    } catch (e) { next(e); }
  });

  // Block sensitive directory access
  app.use('/data', (req         , res          ) => res.status(403).send('Forbidden'));
  app.use('/backups', (req         , res          ) => res.status(403).send('Forbidden'));

  /* ---------------------------- SPA / Frontend ---------------------------- */

  app.get('*', (req         , res          ) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(ROOT, 'index.html'));
  });

  // Error Handler
  app.use((err     , req         , res          , next              ) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[server error]', err);
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  const httpServer = app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  ⚡ Customer CRM & Order Register active at http://localhost:${PORT}`);
    console.log(`  📁 SQLite Database: ${DB_PATH}`);
    console.log(`  📦 Backups Directory: ${BACKUP_DIR}\n`);
  });
  httpServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n  [ERROR] Port ${PORT} is already in use. Another copy of the app (or another program) is running there.\n  Close it, or start with a different port:  set PORT=3001 && npm start\n`);
    else console.error('[server] listen error:', e.message);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
