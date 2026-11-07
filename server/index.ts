import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { DATA_DIR, ROOT, UPLOAD_DIR, db, folderId, getSettings, setSetting } from './db.ts';
import { parseTopstepCsv, pointValue, rootSymbol, round2, type ParsedTrade } from './csv.ts';
import { balanceSeries, dailyStats, edgeScore, memberIds, netRoi, rMultiple, summarize, tradeInsights, tradeOutcome, type TradeRow } from './metrics.ts';
import { analyze, attachmentsFor, beThreshold, checklistFor, filtersFromQuery, findJournalTrade, loadJournal, loadTrades, primarySymbols, strategyNames, tagsByTrade } from './repo.ts';
import { dayContext, ensureBars, entryContext, feedFor, sessionBars } from './market.ts';
import { today, wallClock, weekday, zonedTs, addDays } from './time.ts';
import { explainError, failInterruptedReports, hasAiKey, startReport, streamChat, testKey } from './ai.ts';
import { authEnabled, authRoutes, requireAuth } from './auth.ts';
import { allocateCosts, detectFormat, isFunding, isTradeProceeds, isTradingCost, parseTradovateCash, parseTradovateOrders, type CashRow } from './tradovate.ts';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '25mb' }));

// Reachable before login: only the health check and the login endpoints.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
authRoutes(app);
app.use('/api', requireAuth);
app.use('/uploads', requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const PORT = Number(process.env.PORT) || 4310;
const HOST = process.env.HOST || '127.0.0.1';

const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number));
const param = (req: Request, name: string) => String(req.params[name]);

function tradeView(t: TradeRow, be: number, flags: string[], tags: { id: number; name: string; category: string }[]) {
  return {
    ...t,
    status: tradeOutcome(t, be),
    net_roi: netRoi(t),
    r_multiple: rMultiple(t),
    insights: flags,
    tags,
  };
}

/** A merged trade shows the tags from every account it came from. */
function tagsOf(t: TradeRow, tags: ReturnType<typeof tagsByTrade>) {
  const found = memberIds(t).flatMap((id) => tags.get(id) ?? []);
  return [...new Map(found.map((tag) => [tag.id, tag])).values()];
}

/* ---------- meta & settings ---------- */

app.get('/api/meta', (_req, res) => {
  const s = getSettings();
  const lastImport = db.prepare('SELECT created_at FROM imports ORDER BY id DESC LIMIT 1').get() as { created_at: string } | undefined;
  res.json({
    accounts: db.prepare('SELECT * FROM accounts ORDER BY archived, name').all(),
    tags: db.prepare('SELECT * FROM tags ORDER BY category, name').all(),
    strategies: db.prepare('SELECT * FROM strategies ORDER BY name').all(),
    symbols: (db.prepare('SELECT DISTINCT symbol FROM trades ORDER BY symbol').all() as { symbol: string }[]).map((r) => r.symbol),
    lastImport: lastImport?.created_at ?? null,
    today: today(s.timezone),
    settings: {
      be_threshold: Number(s.be_threshold),
      merge_copies: s.merge_copies !== '0',
      timezone: s.timezone,
      day_mode: s.day_mode,
      ai_model: s.ai_model,
      ai_effort: s.ai_effort,
      has_ai_key: hasAiKey(),
      ai_key_from_env: !s.ai_api_key && Boolean(process.env.ANTHROPIC_API_KEY),
    },
  });
});

app.put('/api/settings', (req, res) => {
  const allowed = ['be_threshold', 'merge_copies', 'timezone', 'day_mode', 'ai_model', 'ai_effort', 'ai_api_key'];
  for (const key of allowed) if (key in req.body) setSetting(key, String(req.body[key]).trim());
  res.json({ ok: true });
});

app.post('/api/settings/test-ai', async (_req, res) => {
  try {
    res.json({ ok: true, model: await testKey() });
  } catch (err) {
    res.status(400).json({ error: explainError(err) });
  }
});

/* ---------- accounts ---------- */

app.post('/api/accounts', (req, res) => {
  const { name, broker = 'Topstep', account_type = 'Funded', initial_balance = 0 } = req.body;
  if (!name?.trim()) return void res.status(400).json({ error: 'Give the account a name.' });
  const info = db.prepare('INSERT INTO accounts (name, broker, account_type, initial_balance) VALUES (?, ?, ?, ?)').run(name.trim(), broker, account_type, num(initial_balance) || 0);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/accounts/:id', (req, res) => {
  const { name, broker, account_type, initial_balance, archived } = req.body;
  db.prepare(
    'UPDATE accounts SET name = COALESCE(?, name), broker = COALESCE(?, broker), account_type = COALESCE(?, account_type), initial_balance = COALESCE(?, initial_balance), archived = COALESCE(?, archived) WHERE id = ?',
  ).run(name ?? null, broker ?? null, account_type ?? null, initial_balance ?? null, archived ?? null, param(req, 'id'));
  res.json({ ok: true });
});

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

app.get('/api/accounts/overview', (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY archived, name').all() as { id: number; initial_balance: number }[];
  const be = beThreshold();
  res.json(
    accounts.map((a) => {
      const trades = loadTrades({ accounts: [a.id] });
      const s = summarize(trades, be);
      const txns = db.prepare('SELECT * FROM account_txns WHERE account_id = ? ORDER BY date').all(a.id) as { id: number; date: string; amount: number; note: string }[];
      const flows = txns.reduce((t, x) => t + x.amount, 0);
      return { ...a, net: s.net, trades: s.count, days: s.days, balance: a.initial_balance + s.net + flows, txns, lastTrade: trades[trades.length - 1]?.date ?? null };
    }),
  );
});

app.post('/api/accounts/:id/txns', (req, res) => {
  const { date, amount, note = '' } = req.body;
  if (!date || !Number(amount)) return void res.status(400).json({ error: 'Enter a date and an amount.' });
  db.prepare('INSERT INTO account_txns (account_id, date, amount, note) VALUES (?, ?, ?, ?)').run(param(req, 'id'), date, Number(amount), note);
  res.json({ ok: true });
});

app.delete('/api/txns/:id', (req, res) => {
  db.prepare('DELETE FROM account_txns WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

/* ---------- import ---------- */

const insertTrade = db.prepare(`
  INSERT OR IGNORE INTO trades (account_id, import_id, external_id, symbol, contract, side, qty, entry_price, exit_price,
    entered_at, exited_at, entered_ts, exited_ts, date, open_time, close_date, close_time, session_date, duration_sec,
    gross_pnl, fees, commissions, net_pnl, point_value, risk_amount, entry_type, exit_type, stop_price)
  VALUES (@account_id, @import_id, @external_id, @symbol, @contract, @side, @qty, @entry_price, @exit_price,
    @entered_at, @exited_at, @entered_ts, @exited_ts, @date, @open_time, @close_date, @close_time, @session_date, @duration_sec,
    @gross_pnl, @fees, @commissions, @net_pnl, @point_value, @risk_amount, @entry_type, @exit_type, @stop_price)
`);

const OPTIONAL_TRADE_FIELDS = { risk_amount: null, entry_type: null, exit_type: null, stop_price: null };

const importRows = db.transaction((accountId: number, filename: string, rows: ParsedTrade[]) => {
  const imp = db.prepare('INSERT INTO imports (account_id, filename, rows_total, rows_added, rows_skipped) VALUES (?, ?, ?, 0, 0)').run(accountId, filename, rows.length);
  const importId = Number(imp.lastInsertRowid);
  let added = 0;
  for (const r of rows) added += insertTrade.run({ ...OPTIONAL_TRADE_FIELDS, ...r, account_id: accountId, import_id: importId }).changes;
  db.prepare('UPDATE imports SET rows_added = ?, rows_skipped = ? WHERE id = ?').run(added, rows.length - added, importId);
  if (!added) db.prepare('DELETE FROM imports WHERE id = ?').run(importId);
  return { added, skipped: rows.length - added };
});

function backfillMarket(trades: { symbol: string; date: string }[]) {
  const bySymbol = new Map<string, Set<string>>();
  for (const t of trades) (bySymbol.get(t.symbol) ?? bySymbol.set(t.symbol, new Set()).get(t.symbol)!).add(t.date);
  const seen = new Set<string>();
  void (async () => {
    for (const [sym, dates] of bySymbol) {
      const feed = feedFor(sym);
      if (!feed || seen.has(feed)) continue;
      seen.add(feed);
      await ensureBars(sym, [...dates]);
    }
  })();
}

interface ImportMeta {
  files: { accountId?: number; newName?: string; balance?: number }[];
  refs: Record<string, { name?: string }>;
}

function parseImportMeta(raw: unknown): ImportMeta {
  try {
    const value = JSON.parse(String(raw ?? '{}')) as Partial<ImportMeta>;
    return { files: Array.isArray(value.files) ? value.files : [], refs: value.refs ?? {} };
  } catch {
    return { files: [], refs: {} };
  }
}

/** Saves Cash History rows once each. Deposits and payouts also go on the account's balance. */
function storeCash(accountId: number, rows: CashRow[]) {
  const insert = db.prepare('INSERT OR IGNORE INTO broker_cash (transaction_id, account_id, ts, date, type, amount, contract) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const fundedBefore = (db.prepare("SELECT COUNT(*) c FROM broker_cash WHERE account_id = ? AND type = 'Fund Transaction'").get(accountId) as { c: number }).c > 0;
  let funded = fundedBefore;
  for (const row of [...rows].sort((a, b) => a.ts - b.ts)) {
    if (!insert.run(row.id, accountId, row.ts, row.date, row.type, row.amount, row.contract).changes || !isFunding(row.type)) continue;
    const account = db.prepare('SELECT initial_balance FROM accounts WHERE id = ?').get(accountId) as { initial_balance: number };
    const isOpeningDeposit = !funded;
    funded = true;
    if (isOpeningDeposit && !account.initial_balance) db.prepare('UPDATE accounts SET initial_balance = ? WHERE id = ?').run(row.amount, accountId);
    else if (!(isOpeningDeposit && Math.abs(account.initial_balance - row.amount) < 0.01)) {
      db.prepare('INSERT INTO account_txns (account_id, date, amount, note) VALUES (?, ?, ?, ?)').run(accountId, row.date, row.amount, 'From Cash History');
    }
  }
}

/** Recalculated from everything stored, so Orders and Cash History can arrive in any order. */
function applyBrokerCosts(accountId: number) {
  const trades = db
    .prepare("SELECT id, contract, qty, entered_ts, exited_ts, gross_pnl, fees FROM trades WHERE account_id = ? AND external_id LIKE 'tv:%'")
    .all(accountId) as { id: number; contract: string; qty: number; entered_ts: number; exited_ts: number; gross_pnl: number; fees: number }[];
  const cash = (db.prepare('SELECT ts, amount, type, contract FROM broker_cash WHERE account_id = ?').all(accountId) as { ts: number; amount: number; type: string; contract: string }[]).filter(isTradingCost);
  const { costs, unmatched } = allocateCosts(trades, cash);
  const update = db.prepare('UPDATE trades SET commissions = ?, net_pnl = ? WHERE id = ?');
  db.transaction(() => {
    for (const t of trades) {
      const cost = costs.get(t.id) ?? 0;
      update.run(cost, round2(t.gross_pnl - t.fees - cost), t.id);
    }
  })();
  return { unmatched, withoutCosts: trades.filter((t) => !costs.get(t.id)).length };
}

/** Compares paired trades with what the broker actually booked, for the dates in this upload. */
function reconcile(accountId: number, tz: string) {
  const dates = [...new Set((db.prepare("SELECT date FROM broker_cash WHERE account_id = ? AND type = 'Trade Paired'").all(accountId) as { date: string }[]).map((r) => r.date))];
  const booked = (db.prepare('SELECT ts, amount, type FROM broker_cash WHERE account_id = ?').all(accountId) as { ts: number; amount: number; type: string }[]).filter((r) => isTradeProceeds(r.type));
  const trades = db.prepare("SELECT exited_ts, gross_pnl FROM trades WHERE account_id = ? AND external_id LIKE 'tv:%'").all(accountId) as { exited_ts: number; gross_pnl: number }[];
  const onDay = (ts: number) => wallClock(ts, tz).date;
  const tradedDays = new Set(trades.map((t) => onDay(t.exited_ts)));
  const covered = dates.filter((d) => tradedDays.has(d));
  const sum = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0);
  const brokerTotal = sum(booked.filter((r) => covered.includes(onDay(r.ts))));
  const ourTotal = trades.filter((t) => covered.includes(onDay(t.exited_ts))).reduce((a, t) => a + t.gross_pnl, 0);
  return { days: covered.length, brokerTotal, ourTotal, matches: Math.abs(brokerTotal - ourTotal) < 0.01 };
}

app.post('/api/import', upload.array('files'), (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) return void res.status(400).json({ error: 'Choose at least one CSV file.' });
  const tz = getSettings().timezone;
  const meta = parseImportMeta(req.body.meta);

  /** Topstep files don't name their account, so the upload says where each one goes. */
  const accountForFile = (index: number) => {
    const choice = meta.files[index];
    if (choice?.accountId) return choice.accountId;
    const name = choice?.newName?.trim();
    if (!name) return 0;
    const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name) as { id: number } | undefined;
    return existing?.id ?? Number(db.prepare('INSERT INTO accounts (name, initial_balance) VALUES (?, ?)').run(name, choice?.balance || 0).lastInsertRowid);
  };

  // Tradovate files name their account, so they can't land on the wrong one.
  const notes = new Map<number, string[]>();
  const accountForRef = (ref: string) => {
    const known = db.prepare('SELECT id FROM accounts WHERE external_ref = ?').get(ref) as { id: number } | undefined;
    if (known) return known.id;
    const name = meta.refs[ref]?.name?.trim() || ref;
    const sameName = db
      .prepare('SELECT a.id, a.external_ref, (SELECT COUNT(*) FROM trades t WHERE t.account_id = a.id) trades FROM accounts a WHERE a.name = ?')
      .get(name) as { id: number; external_ref: string | null; trades: number } | undefined;
    if (sameName && !sameName.external_ref && !sameName.trades) {
      db.prepare("UPDATE accounts SET external_ref = ?, broker = 'Tradovate' WHERE id = ?").run(ref, sameName.id);
      return sameName.id;
    }
    return Number(db.prepare("INSERT INTO accounts (name, broker, external_ref) VALUES (?, 'Tradovate', ?)").run(sameName ? `${name} (${ref})` : name, ref).lastInsertRowid);
  };

  const loaded = files.map((file, index) => {
    const text = file.buffer.toString('utf8');
    return { file, text, index, format: detectFormat(text) };
  });
  const touched = new Set<number>();
  // Cash first, so a new account's opening deposit sets its balance before trades arrive.
  const order = [...loaded].sort((a, b) => Number(b.format === 'tradovate-cash') - Number(a.format === 'tradovate-cash'));
  const results = order.map(({ file, text, index, format }) => {
    const base = { file: file.originalname, total: 0, added: 0, skipped: 0, dates: [] as string[], notes: [] as string[] };
    try {
      if (format === 'topstep' || format === 'unknown') {
        const rows = parseTopstepCsv(text, tz);
        const accountId = accountForFile(index);
        if (!accountId) throw new Error('Pick the account these trades belong to.');
        const { added, skipped } = importRows(accountId, file.originalname, rows);
        backfillMarket(rows);
        return { ...base, accountId, total: rows.length, added, skipped, dates: [...new Set(rows.map((r) => r.date))].sort() };
      }
      if (format === 'tradovate-other') {
        throw new Error('This is a different Tradovate report. Download the Orders tab and the Cash History tab instead.');
      }
      if (format === 'tradovate-cash') {
        const rows = parseTradovateCash(text, tz);
        const refs = [...new Set(rows.map((r) => r.account))];
        let accountId = 0;
        for (const ref of refs) {
          accountId = accountForRef(ref);
          storeCash(accountId, rows.filter((r) => r.account === ref));
          touched.add(accountId);
        }
        return { ...base, accountId, kind: 'cash', total: rows.length };
      }
      const { trades, unmatched } = parseTradovateOrders(text, tz);
      if (!trades.length) throw new Error('No completed trades in this file.');
      if (unmatched) base.notes.push(`${unmatched} contract(s) had no matching entry or exit, so they were left out. Export a date range that covers the whole position.`);
      let added = 0;
      let skipped = 0;
      let accountId = 0;
      for (const ref of new Set(trades.map((t) => t.accountRef))) {
        accountId = accountForRef(ref);
        const result = importRows(accountId, file.originalname, trades.filter((t) => t.accountRef === ref));
        added += result.added;
        skipped += result.skipped;
        touched.add(accountId);
      }
      backfillMarket(trades);
      return { ...base, accountId, total: trades.length, added, skipped, dates: [...new Set(trades.map((t) => t.date))].sort() };
    } catch (err) {
      return { ...base, error: (err as Error).message };
    }
  });

  for (const accountId of touched) {
    const list: string[] = [];
    const { unmatched, withoutCosts } = applyBrokerCosts(accountId);
    if (withoutCosts) list.push(`${withoutCosts} trade(s) have no fees yet. Upload Cash History for the same dates to add them.`);
    if (unmatched) list.push(`${unmatched} fee line(s) in Cash History have no trade yet. Upload Orders for those dates.`);
    const check = reconcile(accountId, tz);
    if (check.days) {
      list.push(
        check.matches
          ? `Checked against Tradovate: gross P&L matches to the cent over ${check.days} day(s).`
          : `Check this: trades total $${check.ourTotal.toFixed(2)} gross, but Tradovate booked $${check.brokerTotal.toFixed(2)}.`,
      );
    }
    notes.set(accountId, list);
  }
  for (const result of results) {
    const id = (result as { accountId?: number }).accountId;
    if (id && notes.has(id)) {
      result.notes.push(...notes.get(id)!);
      notes.delete(id);
    }
  }
  const last = results.map((r) => (r as { accountId?: number }).accountId).filter(Boolean).pop();
  res.json({ accountId: last ?? null, results });
});

app.get('/api/imports', (_req, res) => {
  res.json(db.prepare('SELECT i.*, a.name account FROM imports i JOIN accounts a ON a.id = i.account_id ORDER BY i.id DESC LIMIT 100').all());
});

app.delete('/api/imports/:id', (req, res) => {
  db.prepare('DELETE FROM imports WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

/* ---------- dashboard ---------- */

app.get('/api/dashboard', (req, res) => {
  const filters = filtersFromQuery(req.query as Record<string, unknown>);
  const trades = loadJournal(filters);
  const be = beThreshold();
  const summary = summarize(trades, be);
  const days = dailyStats(trades, be);
  const flagged = new Set([
    ...(db.prepare("SELECT date FROM notes WHERE type = 'day' AND body_text != ''").all() as { date: string }[]).map((r) => r.date),
  ]);
  const progress = progressMap();
  const tags = tagsByTrade();
  const flags = tradeInsights(trades, summary, be);

  const accountRows = db.prepare('SELECT id, initial_balance FROM accounts').all() as { id: number; initial_balance: number }[];
  const chosen = filters.accounts?.length ? accountRows.filter((a) => filters.accounts!.includes(a.id)) : accountRows;
  const start = chosen.reduce((t, a) => t + a.initial_balance, 0);
  const txns = (db.prepare('SELECT account_id, date, amount FROM account_txns').all() as { account_id: number; date: string; amount: number }[]).filter((t) =>
    chosen.some((a) => a.id === t.account_id),
  );

  res.json({
    summary,
    days: days.map((d) => ({ ...d, hasNote: flagged.has(d.date) })),
    edge: edgeScore(summary, days),
    progress,
    balance: balanceSeries(days, start, txns),
    recent: [...trades].reverse().slice(0, 20).map((t) => tradeView(t, be, flags.get(t.id) ?? [], tagsOf(t, tags))),
    scatter: trades.map((t) => ({
      id: t.id,
      net: t.net_pnl,
      status: tradeOutcome(t, be),
      duration: t.duration_sec,
      minutes: Number(t.open_time.slice(0, 2)) * 60 + Number(t.open_time.slice(3, 5)),
    })),
  });
});

function progressMap() {
  const tz = getSettings().timezone;
  const end = today(tz);
  const start = addDays(end, -7 * 18);
  const items = (db.prepare('SELECT COUNT(*) c FROM checklist_items WHERE active = 1').get() as { c: number }).c;
  const logs = new Map((db.prepare('SELECT date, SUM(done) c FROM checklist_log GROUP BY date').all() as { date: string; c: number }[]).map((r) => [r.date, r.c]));
  const traded = new Set((db.prepare('SELECT DISTINCT date FROM trades').all() as { date: string }[]).map((r) => r.date));
  const noted = new Set((db.prepare("SELECT date FROM notes WHERE type = 'day' AND body_text != ''").all() as { date: string }[]).map((r) => r.date));
  const cells: { date: string; level: number }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const done = logs.get(d) ?? 0;
    const ratio = items ? done / items : 0;
    let level = 0;
    if (traded.has(d) || done) level = 1;
    if (noted.has(d)) level = Math.max(level, 2);
    if (ratio >= 0.5) level = Math.max(level, 3);
    if (ratio >= 1) level = 4;
    cells.push({ date: d, level });
  }
  return { cells, todayDone: logs.get(end) ?? 0, todayTotal: items, today: end };
}

/* ---------- trades ---------- */

app.get('/api/trades', (req, res) => {
  const q = req.query as Record<string, string>;
  const trades = loadJournal(filtersFromQuery(q));
  const be = beThreshold();
  const summary = summarize(trades, be);
  const tags = tagsByTrade();
  const flags = tradeInsights(trades, summary, be);
  const days = dailyStats(trades, be);
  const notes = new Set((db.prepare("SELECT trade_id FROM notes WHERE type = 'trade' AND body_text != ''").all() as { trade_id: number }[]).map((r) => r.trade_id));
  const views = trades.map((t) => ({ ...tradeView(t, be, flags.get(t.id) ?? [], tagsOf(t, tags)), has_note: memberIds(t).some((id) => notes.has(id)) }));
  const sortKey = (q.sort || 'entered_ts') as keyof (typeof views)[number];
  const dir = q.dir === 'asc' ? 1 : -1;
  views.sort((a, b) => {
    const x = a[sortKey] ?? 0;
    const y = b[sortKey] ?? 0;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(500, Number(q.size) || 50);
  res.json({
    summary,
    days,
    total: views.length,
    page,
    size,
    trades: views.slice((page - 1) * size, page * size),
  });
});

app.post('/api/trades', (req, res) => {
  const b = req.body;
  const tz = getSettings().timezone;
  const contract = String(b.symbol ?? '').trim().toUpperCase();
  if (!contract || !b.account_id) return void res.status(400).json({ error: 'Pick an account and a symbol.' });
  const symbol = rootSymbol(contract);
  const entered = zonedTs(b.date, timeToMinutes(b.open_time), tz);
  const exited = zonedTs(b.close_date || b.date, timeToMinutes(b.close_time), tz);
  const qty = Number(b.qty);
  const pv = pointValue(symbol);
  const entry = Number(b.entry_price);
  const exit = Number(b.exit_price);
  if (!(qty > 0) || !entry || !exit || exited < entered) return void res.status(400).json({ error: 'Check the size, prices and times.' });
  const gross = round2((b.side === 'Short' ? entry - exit : exit - entry) * qty * pv);
  const fees = Number(b.fees) || 0;
  const open = wallClock(entered, tz);
  const close = wallClock(exited, tz);
  const info = insertTrade.run({
    account_id: b.account_id,
    import_id: null,
    external_id: `manual-${crypto.randomUUID()}`,
    symbol,
    contract,
    side: b.side === 'Short' ? 'Short' : 'Long',
    qty,
    entry_price: entry,
    exit_price: exit,
    entered_at: new Date(entered).toISOString(),
    exited_at: new Date(exited).toISOString(),
    entered_ts: entered,
    exited_ts: exited,
    date: open.date,
    open_time: open.time,
    close_date: close.date,
    close_time: close.time,
    session_date: open.date,
    duration_sec: (exited - entered) / 1000,
    gross_pnl: gross,
    fees,
    commissions: 0,
    net_pnl: round2(gross - fees),
    point_value: pv,
    ...OPTIONAL_TRADE_FIELDS,
  });
  res.json({ id: info.lastInsertRowid });
});

function timeToMinutes(t: string) {
  const [h, m, s] = String(t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0) + (s || 0) / 60;
}

app.get('/api/trades/:id', async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as TradeRow | undefined;
  if (!row) return void res.status(404).json({ error: 'Trade not found.' });
  const be = beThreshold();
  await ensureBars(row.symbol, [row.date]);
  const all = loadJournal();
  const summary = summarize(all, be);
  const trade = all.find((t) => memberIds(t).includes(id)) ?? row;
  const dayTrades = all.filter((t) => t.date === trade.date).sort((a, b) => a.entered_ts - b.entered_ts);
  const flags = tradeInsights(all, summary, be);
  const tags = tagsByTrade();
  const members = memberIds(trade);
  const note = db.prepare(`SELECT * FROM notes WHERE type = 'trade' AND trade_id IN (${members.map(() => '?').join(',')}) ORDER BY trade_id = ? DESC LIMIT 1`).get(...members, id) as { trade_id: number } | undefined;
  const accountRows = (trade.copies ?? 1) > 1
    ? (db
        .prepare(`SELECT a.id, a.name, SUM(t.qty) qty, SUM(t.net_pnl) net FROM trades t JOIN accounts a ON a.id = t.account_id WHERE t.id IN (${members.map(() => '?').join(',')}) GROUP BY a.id ORDER BY a.id`)
        .all(...members) as { id: number; name: string; qty: number; net: number }[])
    : [];
  const { bars, interval } = sessionBars(row.symbol, row.date);
  const tz = getSettings().timezone;
  const idx = dayTrades.findIndex((t) => t.id === trade.id);
  res.json({
    trade: tradeView(trade, be, flags.get(trade.id) ?? [], tagsOf(trade, tags)),
    accounts: accountRows,
    ownRisk: row.risk_amount,
    note: note ?? null,
    noteTradeId: note?.trade_id ?? trade.id,
    attachments: attachmentsFor('trade', String(id)),
    market: { bars, interval, entry: bars.length ? entryContext(row, bars, interval, zonedTs(row.date, 570, tz)) : null },
    siblings: dayTrades.map((t) => ({ id: t.id, side: t.side, symbol: t.symbol, qty: t.qty, entered_ts: t.entered_ts, exited_ts: t.exited_ts, entry_price: t.entry_price, exit_price: t.exit_price, net_pnl: t.net_pnl })),
    prevId: dayTrades[idx - 1]?.id ?? null,
    nextId: dayTrades[idx + 1]?.id ?? null,
    tradeNumber: idx + 1,
    tradesThatDay: dayTrades.length,
  });
});

app.patch('/api/trades/:id', (req, res) => {
  const id = param(req, 'id');
  const b = req.body;
  if ('strategy_id' in b) db.prepare('UPDATE trades SET strategy_id = ? WHERE id = ?').run(b.strategy_id || null, id);
  if ('risk_amount' in b) db.prepare('UPDATE trades SET risk_amount = ? WHERE id = ?').run(b.risk_amount === '' || b.risk_amount == null ? null : Number(b.risk_amount), id);
  if ('rating' in b) db.prepare('UPDATE trades SET rating = ? WHERE id = ?').run(b.rating || null, id);
  if (Array.isArray(b.tag_ids)) setTradeTags(findJournalTrade(Number(id)) ?? { id: Number(id) }, b.tag_ids);
  res.json({ ok: true });
});

const setTradeTags = db.transaction((trade: Pick<TradeRow, 'id' | 'member_ids'>, tagIds: number[]) => {
  const clear = db.prepare('DELETE FROM trade_tags WHERE trade_id = ?');
  for (const id of memberIds(trade)) clear.run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)');
  for (const t of tagIds) ins.run(trade.id, t);
});

app.post('/api/trades/bulk', (req, res) => {
  const { ids, action, tag_id, strategy_id } = req.body as { ids: number[]; action: string; tag_id?: number; strategy_id?: number };
  // Acting on a merged trade acts on it in every account.
  const journal = loadJournal();
  const rows = ids.flatMap((id) => memberIds(journal.find((t) => memberIds(t).includes(id)) ?? { id }));
  const run = db.transaction(() => {
    for (const id of rows) {
      if (action === 'delete') db.prepare('DELETE FROM trades WHERE id = ?').run(id);
      if (action === 'tag' && tag_id) db.prepare('INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)').run(id, tag_id);
      if (action === 'strategy') db.prepare('UPDATE trades SET strategy_id = ? WHERE id = ?').run(strategy_id || null, id);
    }
  });
  run();
  res.json({ ok: true });
});

/* ---------- tags & strategies ---------- */

app.post('/api/tags', (req, res) => {
  const { name, category = 'custom' } = req.body;
  if (!name?.trim()) return void res.status(400).json({ error: 'Tag name is required.' });
  db.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)').run(name.trim(), category);
  res.json(db.prepare('SELECT * FROM tags WHERE name = ? AND category = ?').get(name.trim(), category));
});

app.delete('/api/tags/:id', (req, res) => {
  db.prepare('DELETE FROM tags WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

app.get('/api/strategies', (_req, res) => {
  const be = beThreshold();
  const list = db.prepare('SELECT * FROM strategies ORDER BY name').all() as { id: number }[];
  res.json(list.map((s) => ({ ...s, stats: summarize(loadJournal({ strategyId: s.id }), be) })));
});

app.post('/api/strategies', (req, res) => {
  const { name, description = '', rules = '' } = req.body;
  if (!name?.trim()) return void res.status(400).json({ error: 'Strategy name is required.' });
  res.json({ id: db.prepare('INSERT INTO strategies (name, description, rules) VALUES (?, ?, ?)').run(name.trim(), description, rules).lastInsertRowid });
});

app.put('/api/strategies/:id', (req, res) => {
  const { name, description, rules } = req.body;
  db.prepare('UPDATE strategies SET name = ?, description = ?, rules = ? WHERE id = ?').run(name, description, rules, param(req, 'id'));
  res.json({ ok: true });
});

app.delete('/api/strategies/:id', (req, res) => {
  db.prepare('DELETE FROM strategies WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

/* ---------- day view ---------- */

function tradingDays(accounts?: number[]) {
  const trades = loadTrades({ accounts });
  return [...new Set(trades.map((t) => t.date))].sort();
}

app.get('/api/day/:date', async (req, res) => {
  const date = param(req, 'date');
  const filters = filtersFromQuery(req.query as Record<string, unknown>);
  const trades = loadJournal({ ...filters, from: date, to: date });
  const be = beThreshold();
  const summary = summarize(trades, be);
  const all = loadJournal(filters);
  const flags = tradeInsights(all, summarize(all, be), be);
  const tags = tagsByTrade();
  const symbol = primarySymbols(trades).get(date);
  if (symbol) await ensureBars(symbol, [date]);

  let cum = 0;
  const intraday = [{ t: trades[0]?.exited_ts ?? 0, cum: 0 }];
  for (const t of [...trades].sort((a, b) => a.exited_ts - b.exited_ts)) {
    cum += t.net_pnl;
    intraday.push({ t: t.exited_ts, cum });
  }

  const dates = tradingDays(filters.accounts);
  const i = dates.indexOf(date);
  const meta = db.prepare('SELECT mood, mood_note FROM day_meta WHERE date = ?').get(date) as { mood: number | null; mood_note: string } | undefined;
  const market = symbol ? sessionBars(symbol, date) : { bars: [], interval: 'none' };
  res.json({
    date,
    weekday: weekday(date),
    summary,
    intraday,
    trades: [...trades].reverse().map((t) => tradeView(t, be, flags.get(t.id) ?? [], tagsOf(t, tags))),
    mood: meta?.mood ?? null,
    mood_note: meta?.mood_note ?? '',
    note: db.prepare("SELECT * FROM notes WHERE type = 'day' AND date = ?").get(date) ?? null,
    attachments: attachmentsFor('day', date),
    checklist: checklistFor(date),
    context: symbol ? dayContext(symbol, date) : null,
    strategies: Object.fromEntries(strategyNames()),
    market,
    reports: db.prepare("SELECT id, kind, title, status, error, created_at, result FROM ai_reports WHERE kind = 'daily' AND scope_from = ? ORDER BY id DESC").all(date),
    prev: i > 0 ? dates[i - 1] : (dates.filter((d) => d < date).pop() ?? null),
    next: i >= 0 && i < dates.length - 1 ? dates[i + 1] : (dates.find((d) => d > date) ?? null),
  });
});

app.put('/api/day/:date', (req, res) => {
  const date = param(req, 'date');
  const { mood, mood_note } = req.body;
  db.prepare(
    `INSERT INTO day_meta (date, mood, mood_note) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, mood_note = excluded.mood_note`,
  ).run(date, mood ?? null, mood_note ?? '');
  res.json({ ok: true });
});

/* ---------- checklist ---------- */

app.get('/api/checklist/items', (_req, res) => {
  res.json(db.prepare('SELECT * FROM checklist_items WHERE active = 1 ORDER BY sort, id').all());
});

app.put('/api/checklist/items', (req, res) => {
  const items = req.body.items as { id?: number; label: string }[];
  const run = db.transaction(() => {
    const keep = items.filter((i) => i.id).map((i) => i.id);
    db.prepare(`UPDATE checklist_items SET active = 0 ${keep.length ? `WHERE id NOT IN (${keep.join(',')})` : ''}`).run();
    items.forEach((item, sort) => {
      if (!item.label.trim()) return;
      if (item.id) db.prepare('UPDATE checklist_items SET label = ?, sort = ?, active = 1 WHERE id = ?').run(item.label.trim(), sort, item.id);
      else db.prepare('INSERT INTO checklist_items (label, sort) VALUES (?, ?)').run(item.label.trim(), sort);
    });
  });
  run();
  res.json({ ok: true });
});

app.get('/api/checklist/:date', (req, res) => {
  res.json(checklistFor(param(req, 'date')));
});

app.put('/api/checklist/:date/:itemId', (req, res) => {
  db.prepare(
    `INSERT INTO checklist_log (date, item_id, done) VALUES (?, ?, ?)
     ON CONFLICT(date, item_id) DO UPDATE SET done = excluded.done`,
  ).run(param(req, 'date'), param(req, 'itemId'), req.body.done ? 1 : 0);
  res.json({ ok: true });
});

/* ---------- notebook ---------- */

app.get('/api/folders', (_req, res) => {
  res.json(
    db
      .prepare('SELECT f.*, (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id) count FROM folders f ORDER BY f.sort, f.name')
      .all(),
  );
});

app.post('/api/folders', (req, res) => {
  if (!req.body.name?.trim()) return void res.status(400).json({ error: 'Folder name is required.' });
  res.json({ id: db.prepare('INSERT INTO folders (name) VALUES (?)').run(req.body.name.trim()).lastInsertRowid });
});

app.delete('/api/folders/:id', (req, res) => {
  db.prepare("DELETE FROM folders WHERE id = ? AND kind = 'custom'").run(param(req, 'id'));
  res.json({ ok: true });
});

app.get('/api/notes', (req, res) => {
  const { folder, q, pinned } = req.query as Record<string, string>;
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (folder) { where.push('n.folder_id = ?'); args.push(Number(folder)); }
  if (pinned) where.push('n.pinned = 1');
  if (q) { where.push('(n.title LIKE ? OR n.body_text LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db
    .prepare(
      `SELECT n.id, n.folder_id, n.type, n.date, n.trade_id, n.title, substr(n.body_text, 1, 180) preview, n.tags, n.pinned, n.created_at, n.updated_at,
        t.symbol, t.side, t.net_pnl
       FROM notes n LEFT JOIN trades t ON t.id = n.trade_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY n.pinned DESC, COALESCE(n.date, substr(n.updated_at, 1, 10)) DESC, n.updated_at DESC LIMIT 500`,
    )
    .all(...args) as (Record<string, unknown> & { date: string | null; net_pnl: number | null })[];
  const dayNets = new Map(dailyStats(loadTrades(), beThreshold()).map((d) => [d.date, d.net]));
  res.json(rows.map((r) => ({ ...r, net: r.net_pnl ?? (r.date ? (dayNets.get(r.date) ?? null) : null) })));
});

app.get('/api/notes/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(param(req, 'id'));
  if (!note) return void res.status(404).json({ error: 'Note not found.' });
  res.json(note);
});

/** Day and trade notes are found by their date or trade, so the Notebook and day pages edit the same note. */
app.put('/api/notes/day/:date', (req, res) => {
  const date = param(req, 'date');
  const { body_html = '', body_text = '' } = req.body;
  const existing = db.prepare("SELECT id FROM notes WHERE type = 'day' AND date = ?").get(date) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE notes SET body_html = ?, body_text = ?, updated_at = datetime('now') WHERE id = ?").run(body_html, body_text, existing.id);
    return void res.json({ id: existing.id });
  }
  const info = db
    .prepare("INSERT INTO notes (folder_id, type, date, title, body_html, body_text) VALUES (?, 'day', ?, ?, ?, ?)")
    .run(folderId('Daily Journal'), date, `${weekday(date)}, ${date}`, body_html, body_text);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/notes/trade/:tradeId', (req, res) => {
  const id = Number(req.params.tradeId);
  const { body_html = '', body_text = '' } = req.body;
  const existing = db.prepare("SELECT id FROM notes WHERE type = 'trade' AND trade_id = ?").get(id) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE notes SET body_html = ?, body_text = ?, updated_at = datetime('now') WHERE id = ?").run(body_html, body_text, existing.id);
    return void res.json({ id: existing.id });
  }
  const t = db.prepare('SELECT symbol, side, date, open_time FROM trades WHERE id = ?').get(id) as { symbol: string; side: string; date: string; open_time: string };
  const info = db
    .prepare("INSERT INTO notes (folder_id, type, date, trade_id, title, body_html, body_text) VALUES (?, 'trade', ?, ?, ?, ?, ?)")
    .run(folderId('Trade Notes'), t.date, id, `${t.symbol} ${t.side} · ${t.date} ${t.open_time.slice(0, 5)}`, body_html, body_text);
  res.json({ id: info.lastInsertRowid });
});

app.post('/api/notes', (req, res) => {
  const { folder_id, title = 'Untitled note', body_html = '', body_text = '' } = req.body;
  res.json({ id: db.prepare('INSERT INTO notes (folder_id, title, body_html, body_text) VALUES (?, ?, ?, ?)').run(folder_id ?? folderId('My Notes'), title, body_html, body_text).lastInsertRowid });
});

app.put('/api/notes/:id', (req, res) => {
  const { title, body_html, body_text, folder_id, tags, pinned } = req.body;
  db.prepare(
    `UPDATE notes SET title = COALESCE(?, title), body_html = COALESCE(?, body_html), body_text = COALESCE(?, body_text),
       folder_id = COALESCE(?, folder_id), tags = COALESCE(?, tags), pinned = COALESCE(?, pinned), updated_at = datetime('now') WHERE id = ?`,
  ).run(title ?? null, body_html ?? null, body_text ?? null, folder_id ?? null, tags ? JSON.stringify(tags) : null, pinned === undefined ? null : pinned ? 1 : 0, param(req, 'id'));
  res.json({ ok: true });
});

app.delete('/api/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

app.get('/api/templates', (_req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY name').all());
});

app.post('/api/templates', (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) return void res.status(400).json({ error: 'Give the template a name.' });
  res.json({ id: db.prepare('INSERT INTO templates (name, body_html) VALUES (?, ?)').run(name, req.body.body_html ?? '').lastInsertRowid });
});

app.put('/api/templates/:id', (req, res) => {
  const { name, body_html } = req.body;
  db.prepare('UPDATE templates SET name = COALESCE(?, name), body_html = COALESCE(?, body_html) WHERE id = ?').run(name ?? null, body_html ?? null, param(req, 'id'));
  res.json({ ok: true });
});

app.delete('/api/templates/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

/* ---------- attachments ---------- */

// An allowlist, because an uploaded SVG or HTML file could run scripts when opened from this site.
const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

app.post('/api/attachments', upload.array('files'), (req, res) => {
  const { owner_type, owner_key, kind = 'other', caption = '' } = req.body;
  if (!owner_type || !owner_key) return void res.status(400).json({ error: 'Missing attachment owner.' });
  const saved = ((req.files as Express.Multer.File[]) ?? []).map((file) => {
    const ext = EXT[file.mimetype];
    if (!ext) throw new Error('Attach a PNG, JPEG, WebP or GIF image.');
    const stored = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), file.buffer);
    const info = db
      .prepare('INSERT INTO attachments (owner_type, owner_key, kind, filename, stored_name, mime, size, caption) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(owner_type, owner_key, kind, file.originalname, stored, file.mimetype, file.size, caption);
    return db.prepare('SELECT * FROM attachments WHERE id = ?').get(info.lastInsertRowid);
  });
  res.json(saved);
});

app.patch('/api/attachments/:id', (req, res) => {
  db.prepare('UPDATE attachments SET caption = COALESCE(?, caption), kind = COALESCE(?, kind) WHERE id = ?').run(req.body.caption ?? null, req.body.kind ?? null, param(req, 'id'));
  res.json({ ok: true });
});

app.delete('/api/attachments/:id', (req, res) => {
  const att = db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(param(req, 'id')) as { stored_name: string } | undefined;
  if (att) {
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(att.stored_name)), { force: true });
    db.prepare('DELETE FROM attachments WHERE id = ?').run(param(req, 'id'));
  }
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

/* ---------- reports & insights ---------- */

app.get('/api/reports', (req, res) => {
  const filters = filtersFromQuery(req.query as Record<string, unknown>);
  const trades = loadJournal(filters);
  const be = beThreshold();
  const { patterns } = analyze(trades);
  res.json({ summary: summarize(trades, be), days: dailyStats(trades, be), groups: patterns.groups, dayGroups: patterns.days, behavior: patterns.behavior, ranked: patterns.ranked });
});

app.get('/api/backup', async (_req, res) => {
  const file = path.join(DATA_DIR, `download-${crypto.randomUUID()}.db`);
  await db.backup(file);
  res.download(file, `edgebook-${today(getSettings().timezone)}.db`, () => fs.rmSync(file, { force: true }));
});

/* ---------- AI ---------- */

app.get('/api/ai/reports', (_req, res) => {
  res.json(
    db
      .prepare('SELECT id, kind, scope_from, scope_to, title, status, error, model, images_used, input_tokens, output_tokens, cost_usd, created_at, result FROM ai_reports ORDER BY id DESC LIMIT 200')
      .all(),
  );
});

app.get('/api/ai/reports/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(param(req, 'id'));
  if (!row) return void res.status(404).json({ error: 'Report not found.' });
  res.json(row);
});

app.post('/api/ai/reports', (req, res) => {
  const { kind, from, to } = req.body;
  if (!hasAiKey()) return void res.status(400).json({ error: 'Add your Claude API key in Settings first.' });
  if (!['daily', 'weekly', 'monthly', 'patterns', 'custom'].includes(kind) || !from) return void res.status(400).json({ error: 'Pick a report and dates.' });
  res.json({ id: startReport(kind, from, to || from) });
});

app.delete('/api/ai/reports/:id', (req, res) => {
  db.prepare('DELETE FROM ai_reports WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

app.get('/api/ai/rules', (_req, res) => {
  res.json(db.prepare('SELECT * FROM ai_rules ORDER BY status, id DESC').all());
});

app.post('/api/ai/rules', (req, res) => {
  const { text, why = '', source_report_id = null } = req.body;
  if (!text?.trim()) return void res.status(400).json({ error: 'Write the rule first.' });
  res.json({ id: db.prepare('INSERT INTO ai_rules (text, why, source_report_id) VALUES (?, ?, ?)').run(text.trim(), why, source_report_id).lastInsertRowid });
});

app.patch('/api/ai/rules/:id', (req, res) => {
  db.prepare('UPDATE ai_rules SET status = ? WHERE id = ?').run(req.body.status, param(req, 'id'));
  res.json({ ok: true });
});

app.delete('/api/ai/rules/:id', (req, res) => {
  db.prepare('DELETE FROM ai_rules WHERE id = ?').run(param(req, 'id'));
  res.json({ ok: true });
});

app.get('/api/ai/chat', (_req, res) => {
  res.json(db.prepare('SELECT * FROM ai_chat ORDER BY id').all());
});

app.delete('/api/ai/chat', (_req, res) => {
  db.prepare('DELETE FROM ai_chat').run();
  res.json({ ok: true });
});

app.post('/api/ai/chat', async (req, res: Response) => {
  const question = String(req.body.message ?? '').trim();
  if (!question) return void res.status(400).json({ error: 'Ask a question first.' });
  if (!hasAiKey()) return void res.status(400).json({ error: 'Add your Claude API key in Settings first.' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  try {
    await streamChat(question, (delta) => res.write(delta));
  } catch (err) {
    console.error('AI chat failed:', err);
    res.write(`\n\n[${explainError(err)}]`);
  }
  res.end();
});

/* ---------- static client ---------- */

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile(path.join(dist, 'index.html'));
    else next();
  });
}

app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

/** One database copy per day, keeping the last 14. */
async function backupDatabase() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `journal-${today(getSettings().timezone)}.db`);
  if (fs.existsSync(target)) return;
  await db.backup(target);
  const old = fs.readdirSync(dir).filter((f) => /^journal-.*\.db$/.test(f)).sort().slice(0, -14);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
}

const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
if (!loopback && !authEnabled) {
  console.error('Refusing to start on a public address without a password. Set EDGEBOOK_PASSWORD.');
  process.exit(1);
}

const runBackup = () => backupDatabase().catch((err) => console.warn(`Backup failed: ${err.message}`));
failInterruptedReports();
void runBackup();
// A hosted server never restarts on its own, so check for a new day's backup every few hours.
setInterval(() => void runBackup(), 6 * 60 * 60 * 1000).unref();

app.listen(PORT, HOST, (err?: Error) => {
  if (err) {
    const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
    console.error(inUse ? `Port ${PORT} is already in use. Edgebook is probably already running at http://localhost:${PORT}` : err);
    process.exit(1);
  }
  console.log(`Edgebook is running on ${HOST}:${PORT}${authEnabled ? ' (login required)' : ''}`);
});
