-- Readable copy of the schema the server applies automatically on every start (CREATE ... IF NOT EXISTS).
-- Source of truth: SCHEMA in server.js and FOLLOWUP_SCHEMA in followups.js. Do not run against a live database by hand.

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


-- v1.3 follow-ups
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
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (2, 'follow-ups and purchase history');
