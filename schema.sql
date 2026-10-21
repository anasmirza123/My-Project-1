-- Customer & Order Tracking — SQLite schema
-- All timestamps are stored in UTC (ISO 8601). The app converts to Asia/Karachi for display.
-- Run with foreign keys ON for every connection: PRAGMA foreign_keys = ON;

PRAGMA foreign_keys = ON;

-- ───────── settings ─────────
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('timezone', 'Asia/Karachi'),
  ('tracking_prefix', 'NT'),
  ('default_currency', 'PKR');

-- ───────── customers ─────────
-- Only the phone is required. Customer code is shown in the UI as 'C-' + zero-padded id.
CREATE TABLE customers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  phone               TEXT NOT NULL,                 -- as typed
  phone_normalized    TEXT NOT NULL UNIQUE,          -- E.164, e.g. +923001234567
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
CREATE INDEX idx_customers_whatsapp ON customers(whatsapp_normalized);
CREATE INDEX idx_customers_name     ON customers(name);
CREATE INDEX idx_customers_created  ON customers(created_at);

-- creation time can never change after insert
CREATE TRIGGER trg_customers_created_immutable
BEFORE UPDATE OF created_at ON customers
WHEN NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'created_at is immutable');
END;

-- ───────── categories (manual tags only) ─────────
-- 'Uncategorized', 'Hardware Requirements' and 'Previous Customer' are NOT stored as tags:
-- they are derived (no tag / has hardware rows / has a completed order). See v_dashboard_counts.
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO categories (name) VALUES ('Wholesale'), ('Retail'), ('Lead'), ('Other');

CREATE TABLE customer_categories (
  customer_id INTEGER NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (customer_id, category_id)
);
CREATE INDEX idx_cc_category ON customer_categories(category_id);

-- ───────── hardware requirements ─────────
CREATE TABLE hardware_requirements (
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
CREATE INDEX idx_hw_customer ON hardware_requirements(customer_id);

-- ───────── orders ─────────
-- status = sale lifecycle. delivery_status = physical fulfilment (separate on purpose).
-- tracking_id is assigned at finalization (see tracking_counters).
CREATE TABLE orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id           TEXT UNIQUE,
  customer_id           INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','confirmed','completed','cancelled')),
  delivery_status       TEXT NOT NULL DEFAULT 'pending'
                        CHECK (delivery_status IN ('pending','dispatched','delivered')),
  payment_status        TEXT NOT NULL DEFAULT 'unpaid'
                        CHECK (payment_status IN ('unpaid','partial','paid')),
  currency              TEXT NOT NULL DEFAULT 'PKR',
  subtotal_minor        INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  extra_charges_minor   INTEGER NOT NULL DEFAULT 0 CHECK (extra_charges_minor >= 0),
  final_price_minor     INTEGER CHECK (final_price_minor IS NULL OR final_price_minor >= 0),
  payment_notes         TEXT,
  order_notes           TEXT,
  product_requirements  TEXT,
  customer_name_snapshot      TEXT,
  customer_phone_snapshot     TEXT,
  customer_whatsapp_snapshot  TEXT,
  shipping_address_snapshot   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at          TEXT,
  finalized_at          TEXT,
  -- a completed order must be fully formed
  CHECK (status <> 'completed' OR
         (final_price_minor IS NOT NULL AND finalized_at IS NOT NULL AND tracking_id IS NOT NULL))
);
CREATE INDEX idx_orders_customer  ON orders(customer_id);
CREATE INDEX idx_orders_status    ON orders(status);
CREATE INDEX idx_orders_finalized ON orders(finalized_at);

-- once completed, price / tracking id / timestamp / snapshots cannot be altered
CREATE TRIGGER trg_orders_locked_after_completion
BEFORE UPDATE ON orders
WHEN OLD.status = 'completed' AND (
     NEW.final_price_minor            IS NOT OLD.final_price_minor
  OR NEW.tracking_id                  IS NOT OLD.tracking_id
  OR NEW.finalized_at                 IS NOT OLD.finalized_at
  OR NEW.customer_name_snapshot       IS NOT OLD.customer_name_snapshot
  OR NEW.customer_phone_snapshot      IS NOT OLD.customer_phone_snapshot
  OR NEW.customer_whatsapp_snapshot   IS NOT OLD.customer_whatsapp_snapshot
  OR NEW.shipping_address_snapshot    IS NOT OLD.shipping_address_snapshot)
BEGIN
  SELECT RAISE(ABORT, 'completed order is locked; use a correction workflow');
END;

-- one row per day; incremented inside the finalize transaction. Never MAX()+1, never reused.
CREATE TABLE tracking_counters (
  day      TEXT PRIMARY KEY,          -- YYYYMMDD in Asia/Karachi
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- ───────── order items ─────────
CREATE TABLE order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name     TEXT NOT NULL,
  product_sku      TEXT,
  description      TEXT,
  size_variant     TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  discount_minor   INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (line_total_minor = quantity * unit_price_minor - discount_minor),
  CHECK (line_total_minor >= 0)
);
CREATE INDEX idx_items_order   ON order_items(order_id);
CREATE INDEX idx_items_product ON order_items(product_name);

-- ───────── customer messages (manual paste) ─────────
CREATE TABLE customer_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id     INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  source       TEXT CHECK (source IS NULL OR source IN ('whatsapp','call','other')),
  message_text TEXT NOT NULL,
  message_at   TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_msg_customer ON customer_messages(customer_id);
CREATE INDEX idx_msg_order    ON customer_messages(order_id);

-- ───────── activity log ─────────
CREATE TABLE activity_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  order_id    INTEGER REFERENCES orders(id)    ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  details_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_log_customer ON activity_logs(customer_id);
CREATE INDEX idx_log_order    ON activity_logs(order_id);

-- ───────── dashboard counts (always live, nothing hardcoded) ─────────
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
  (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') AS orders_in_progress,
  (SELECT COUNT(*) FROM orders WHERE status = 'completed') AS completed_orders,
  (SELECT COUNT(DISTINCT customer_id) FROM hardware_requirements) AS hardware_requirements,
  (SELECT COUNT(*) FROM customers c
   WHERE c.status <> 'archived'
     AND NOT EXISTS (SELECT 1 FROM customer_categories cc WHERE cc.customer_id = c.id)) AS uncategorized;
