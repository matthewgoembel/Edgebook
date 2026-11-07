import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.EDGEBOOK_DATA ? path.resolve(process.env.EDGEBOOK_DATA) : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'journal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  broker TEXT NOT NULL DEFAULT 'Topstep',
  account_type TEXT NOT NULL DEFAULT 'Funded',
  initial_balance REAL NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_txns (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  rows_total INTEGER NOT NULL,
  rows_added INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  contract TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('Long','Short')),
  qty REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  entered_at TEXT NOT NULL,
  exited_at TEXT NOT NULL,
  entered_ts INTEGER NOT NULL,
  exited_ts INTEGER NOT NULL,
  date TEXT NOT NULL,
  open_time TEXT NOT NULL,
  close_date TEXT NOT NULL,
  close_time TEXT NOT NULL,
  session_date TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  gross_pnl REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  commissions REAL NOT NULL DEFAULT 0,
  net_pnl REAL NOT NULL,
  point_value REAL NOT NULL,
  strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
  risk_amount REAL,
  rating INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);
CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_date);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom' CHECK (category IN ('setup','mistake','custom')),
  UNIQUE (name, category)
);

CREATE TABLE IF NOT EXISTS trade_tags (
  trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (trade_id, tag_id)
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'free' CHECK (type IN ('day','trade','free')),
  date TEXT,
  trade_id INTEGER REFERENCES trades(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_day ON notes(date) WHERE type = 'day';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_trade ON notes(trade_id) WHERE type = 'trade';

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS day_meta (
  date TEXT PRIMARY KEY,
  mood INTEGER,
  mood_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('day','trade','note')),
  owner_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('chart','executions','other')),
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attach_owner ON attachments(owner_type, owner_key);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS checklist_log (
  date TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  done INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (date, item_id)
);

CREATE TABLE IF NOT EXISTS market_bars (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  interval TEXT NOT NULL,
  bars TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS ai_reports (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  scope_from TEXT NOT NULL,
  scope_to TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL DEFAULT '',
  result TEXT,
  error TEXT,
  images_used INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_rules (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  source_report_id INTEGER REFERENCES ai_reports(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_chat (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Adds new columns to a database created by an older version, so existing journals keep working. */
function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('accounts', 'external_ref', 'TEXT');
addColumn('trades', 'entry_type', 'TEXT');
addColumn('trades', 'exit_type', 'TEXT');
addColumn('trades', 'stop_price', 'REAL');

db.exec(`
CREATE TABLE IF NOT EXISTS broker_cash (
  transaction_id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  contract TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_broker_cash_account ON broker_cash(account_id);
`);

const DEFAULT_SETTINGS: Record<string, string> = {
  be_threshold: '75',
  timezone: 'America/New_York',
  day_mode: 'calendar',
  ai_model: 'claude-opus-5-5',
  ai_effort: 'high',
  ai_api_key: '',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

export function getSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

if ((db.prepare('SELECT COUNT(*) c FROM folders').get() as { c: number }).c === 0) {
  const ins = db.prepare("INSERT INTO folders (name, kind, sort) VALUES (?, 'system', ?)");
  ins.run('Daily Journal', 1);
  ins.run('Trade Notes', 2);
  ins.run('Sessions Recap', 3);
  ins.run('My Notes', 4);
}

if ((db.prepare('SELECT COUNT(*) c FROM checklist_items').get() as { c: number }).c === 0) {
  const ins = db.prepare('INSERT INTO checklist_items (label, sort) VALUES (?, ?)');
  ins.run('Marked my levels and wrote a plan before the open', 1);
  ins.run('Stuck to my max loss and max trades for the day', 2);
  ins.run('Uploaded trades and journaled the session', 3);
}

// Only seed once, so deleting every template doesn't bring the starters back.
const templatesSeeded = db.prepare("SELECT 1 FROM settings WHERE key = 'templates_seeded'").get();
const templateCount = (db.prepare('SELECT COUNT(*) c FROM templates').get() as { c: number }).c;
setSetting('templates_seeded', '1');
if (!templatesSeeded && templateCount === 0) {
  const ins = db.prepare('INSERT INTO templates (name, body_html) VALUES (?, ?)');
  ins.run(
    'Pre-market plan',
    '<h3>Market context</h3><p></p><h3>Key levels</h3><ul><li><p></p></li></ul><h3>A+ setups I am looking for</h3><ul><li><p></p></li></ul><h3>Max loss / max trades today</h3><p></p>',
  );
  ins.run(
    'Daily recap',
    '<h3>What did I do well?</h3><p></p><h3>What did I do badly?</h3><p></p><h3>What was the market doing?</h3><p></p><h3>One thing to change tomorrow</h3><p></p>',
  );
  ins.run(
    'Trade review',
    '<h3>Why I took it</h3><p></p><h3>Where was my invalidation?</h3><p></p><h3>How I managed it</h3><p></p><h3>Would I take it again?</h3><p></p>',
  );
}

export function folderId(name: string): number | null {
  const row = db.prepare('SELECT id FROM folders WHERE name = ?').get(name) as { id: number } | undefined;
  return row?.id ?? null;
}
