-- ============================================================
-- ANAS MANAGEMENT SYSTEM - SCHEMA v1
-- ============================================================

PRAGMA foreign_keys = ON;

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('timezone', 'Asia/Karachi'),
  ('tracking_prefix', 'NT'),
  ('default_currency', 'PKR'),
  ('business_name', 'Anas Management System');

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL UNIQUE,
  name TEXT,
  whatsapp TEXT,
  whatsapp_normalized TEXT,
  alternate_phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','archived')),
  lead_status TEXT,
  lead_source TEXT,
  preferred_contact TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cust_wa ON customers(whatsapp_normalized);
CREATE INDEX IF NOT EXISTS idx_cust_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_cust_created ON customers(created_at);

CREATE TRIGGER IF NOT EXISTS trg_cust_created_immutable
BEFORE UPDATE OF created_at ON customers
WHEN NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'created_at is immutable');
END;

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO categories (name) VALUES
  ('Wholesale'), ('Retail'), ('Lead'), ('Previous'), ('Hardware'), ('Other');

CREATE TABLE IF NOT EXISTS customer_categories (
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (customer_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_cc_cat ON customer_categories(category_id);

-- Hardware requirements
CREATE TABLE IF NOT EXISTS hardware_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_name TEXT, brand TEXT, model TEXT, specifications TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  budget_minor INTEGER CHECK (budget_minor IS NULL OR budget_minor >= 0),
  currency TEXT DEFAULT 'PKR',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_hw_cust ON hardware_requirements(customer_id);

-- Customer messages
CREATE TABLE IF NOT EXISTS customer_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id INTEGER,
  source TEXT CHECK (source IS NULL OR source IN ('whatsapp','call','other')),
  message_text TEXT NOT NULL,
  message_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_cust ON customer_messages(customer_id);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','completed','cancelled')),
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','dispatched','delivered')),
  currency TEXT NOT NULL DEFAULT 'PKR',
  subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  extra_charges_minor INTEGER NOT NULL DEFAULT 0 CHECK (extra_charges_minor >= 0),
  final_price_minor INTEGER CHECK (final_price_minor IS NULL OR final_price_minor >= 0),
  payment_notes TEXT,
  order_notes TEXT,
  product_requirements TEXT,
  customer_name_snapshot TEXT,
  customer_phone_snapshot TEXT,
  customer_whatsapp_snapshot TEXT,
  shipping_address_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at TEXT,
  finalized_at TEXT,
  completed_at TEXT,
  CHECK (status <> 'completed' OR
    (final_price_minor IS NOT NULL AND completed_at IS NOT NULL AND tracking_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_ord_cust ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_ord_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_ord_completed ON orders(completed_at);

CREATE TRIGGER IF NOT EXISTS trg_orders_locked_after_completion
BEFORE UPDATE ON orders
WHEN OLD.status = 'completed' AND (
     NEW.final_price_minor IS NOT OLD.final_price_minor
  OR NEW.tracking_id IS NOT OLD.tracking_id
  OR NEW.completed_at IS NOT OLD.completed_at
  OR NEW.customer_name_snapshot IS NOT OLD.customer_name_snapshot
  OR NEW.customer_phone_snapshot IS NOT OLD.customer_phone_snapshot)
BEGIN
  SELECT RAISE(ABORT, 'completed order is locked');
END;

-- Tracking counters
CREATE TABLE IF NOT EXISTS tracking_counters (
  day TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- Order items
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_sku TEXT,
  description TEXT,
  size_variant TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  cost_minor INTEGER CHECK (cost_minor IS NULL OR cost_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (line_total_minor = quantity * unit_price_minor - discount_minor),
  CHECK (line_total_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash','bank','mobile','card','other')),
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','reversed')),
  paid_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_order ON payments(order_id);

-- Refunds
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash','bank','mobile','card','other')),
  reason TEXT,
  refunded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_order ON refunds(order_id);

-- Order expenses
CREATE TABLE IF NOT EXISTS order_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_exp_order ON order_expenses(order_id);

-- Follow-ups
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  due_date TEXT NOT NULL,
  due_time TEXT,
  type TEXT NOT NULL DEFAULT 'next_visit'
    CHECK (type IN ('next_visit','new_order','payment','product','checkin','delivery','other')),
  purpose TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','completed','rescheduled','cancelled')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fu_customer ON followups(customer_id);
CREATE INDEX IF NOT EXISTS idx_fu_order ON followups(order_id);
CREATE INDEX IF NOT EXISTS idx_fu_due ON followups(due_date);
CREATE INDEX IF NOT EXISTS idx_fu_status ON followups(status);

-- Order status history
CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_osh_order ON order_status_history(order_id);

-- Activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_log_cust ON activity_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_log_order ON activity_logs(order_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
