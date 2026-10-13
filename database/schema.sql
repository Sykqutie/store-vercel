-- ============================================================
-- SmartMart POS & Inventory: PostgreSQL schema
-- Ported from the MySQL database.sql. The installer (POST /api/install)
-- runs this file's contents automatically; you can also run it by hand.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(50)  NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id                   SERIAL PRIMARY KEY,
  barcode              VARCHAR(64)   NOT NULL UNIQUE,
  name                 VARCHAR(150)  NOT NULL,
  category             VARCHAR(60)   NOT NULL DEFAULT 'General',
  cost_price           NUMERIC(10,2) NOT NULL DEFAULT 0,
  price                NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock                INT           NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold  INT           NOT NULL DEFAULT 5,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_name     ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_stock    ON products (stock);

CREATE TABLE IF NOT EXISTS sales (
  id               SERIAL PRIMARY KEY,
  transaction_id   VARCHAR(40)   NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS sale_items (
  id            SERIAL PRIMARY KEY,
  sale_id       INT           NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  product_id    INT,
  product_name  VARCHAR(150)  NOT NULL,
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
