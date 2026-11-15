-- Roastery social media planner — initial schema (Cloudflare D1 / SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE team_members (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE campaigns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  start_date TEXT,
  end_date   TEXT,
  goal       TEXT,
  color      TEXT NOT NULL DEFAULT '#8b5a2b',
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'done', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- المحاصيل
CREATE TABLE products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  origin     TEXT,
  process    TEXT,
  status     TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold_out', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- أدوات التحضير
CREATE TABLE tools (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  caption      TEXT,
  platform     TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'snapchat')),
  format       TEXT NOT NULL,
  planned_at   TEXT,            -- 'YYYY-MM-DDTHH:MM' (Riyadh local time)
  campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  owner_email  TEXT,
  asset_url    TEXT,
  status       TEXT NOT NULL DEFAULT 'idea'
               CHECK (status IN ('idea', 'writing', 'design', 'review', 'scheduled', 'published', 'cancelled')),
  published_at TEXT,            -- set when status becomes 'published'
  post_url     TEXT,
  notes        TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE post_products (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, product_id)
);

CREATE TABLE post_tools (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tool_id)
);

CREATE TABLE activity_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  details   TEXT
);

CREATE INDEX idx_posts_planned   ON posts(planned_at);
CREATE INDEX idx_posts_published ON posts(published_at);
CREATE INDEX idx_posts_campaign  ON posts(campaign_id);
CREATE INDEX idx_post_products_product ON post_products(product_id);
CREATE INDEX idx_post_tools_tool ON post_tools(tool_id);
CREATE INDEX idx_activity_at ON activity_log(at);
