-- ============================================================
-- SmartMart POS & Inventory: PostgreSQL schema
-- Ported from the MySQL database.sql. The installer (POST /api/install)
-- runs this file's contents automatically; you can also run it by hand.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(50)  NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  role        VARCHAR(20)  NOT NULL DEFAULT 'owner',
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id                   SERIAL PRIMARY KEY,
  barcode              VARCHAR(64)   NOT NULL UNIQUE,
  name                 VARCHAR(150)  NOT NULL,
  category             VARCHAR(60)   NOT NULL DEFAULT 'General',
  size_value           NUMERIC(10,3),
  size_unit            VARCHAR(10),
  size_label           VARCHAR(60),
  cost_price           NUMERIC(10,2) NOT NULL DEFAULT 0,
  price                NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock                INT           NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold  INT           NOT NULL DEFAULT 5,
  expiry_date          DATE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),\r\n  image_url            VARCHAR(512)\r\n);
CREATE INDEX IF NOT EXISTS idx_products_name     ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_stock    ON products (stock);
CREATE INDEX IF NOT EXISTS idx_products_expiry   ON products (expiry_date);

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_lower ON categories (lower(name));
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories (active);

-- Per-user dismissals for non-critical notifications. The underlying product
-- and its alert are never deleted; a dismissal only hides a warning until the
-- product is restocked (the API prunes stale keys) or its state escalates.
CREATE TABLE IF NOT EXISTS alert_dismissals (
  user_id      INT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  alert_key    VARCHAR(80)  NOT NULL,
  dismissed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alert_key)
);
CREATE INDEX IF NOT EXISTS idx_alert_dismissals_user ON alert_dismissals (user_id);
ALTER TABLE alert_dismissals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS sales (
  id               SERIAL PRIMARY KEY,
  transaction_id   VARCHAR(40)   NOT NULL UNIQUE,
  client_sale_id   VARCHAR(64),
  total_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit           NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax              NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_tendered  NUMERIC(12,2) NOT NULL DEFAULT 0,
  change_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method   VARCHAR(20)   NOT NULL DEFAULT 'Cash',
  cashier          VARCHAR(50),
  sale_date        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales (sale_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id ON sales (client_sale_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id            SERIAL PRIMARY KEY,
  sale_id       INT           NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  product_id    INT,
  product_name  VARCHAR(150)  NOT NULL,
  size_label    VARCHAR(60),
  quantity      INT           NOT NULL DEFAULT 1,
  price         NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_name ON sale_items (product_name);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            SERIAL PRIMARY KEY,
  product_id    INT,
  product_name  VARCHAR(150) NOT NULL,
  change_qty    INT          NOT NULL,
  reason        VARCHAR(30)  NOT NULL DEFAULT 'adjust',
  note          VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements (created_at);
