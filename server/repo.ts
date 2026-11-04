import { db, getSettings } from './db.ts';
import type { TradeRow } from './metrics.ts';
import { buildPatterns, toPositions, type DayFacts, type TradeExtras } from './analysis.ts';
import { dayContext, entryContext, feedFor, sessionBars } from './market.ts';
import { zonedTs } from './time.ts';

export interface Filters {
  accounts?: number[];
  from?: string;
  to?: string;
  symbol?: string;
  side?: string;
  status?: string;
  tagId?: number;
  strategyId?: number;
}

export function filtersFromQuery(q: Record<string, unknown>): Filters {
  const str = (k: string) => (typeof q[k] === 'string' && q[k] ? (q[k] as string) : undefined);
  return {
    accounts: str('accounts')?.split(',').map(Number).filter(Boolean),
    from: str('from'),
    to: str('to'),
    symbol: str('symbol'),
    side: str('side'),
    status: str('status'),
    tagId: str('tag') ? Number(str('tag')) : undefined,
    strategyId: str('strategy') ? Number(str('strategy')) : undefined,
  };
}

export const beThreshold = () => Number(getSettings().be_threshold) || 0;

/** When the journal groups by Topstep's trading day, overnight sessions roll into the next date. */
export function loadTrades(f: Filters = {}): TradeRow[] {
  const dayCol = getSettings().day_mode === 'session' ? 'session_date' : 'date';
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.accounts?.length) {
    where.push(`t.account_id IN (${f.accounts.map(() => '?').join(',')})`);
    args.push(...f.accounts);
  }
  if (f.from) { where.push(`t.${dayCol} >= ?`); args.push(f.from); }
  if (f.to) { where.push(`t.${dayCol} <= ?`); args.push(f.to); }
  if (f.symbol) { where.push('t.symbol = ?'); args.push(f.symbol); }
  if (f.side) { where.push('t.side = ?'); args.push(f.side); }
  if (f.strategyId) { where.push('t.strategy_id = ?'); args.push(f.strategyId); }
  if (f.tagId) { where.push('t.id IN (SELECT trade_id FROM trade_tags WHERE tag_id = ?)'); args.push(f.tagId); }
  if (f.status) {
    const be = beThreshold();
    if (f.status === 'win') where.push(`t.net_pnl > ${be}`);
    else if (f.status === 'loss') where.push(`t.net_pnl < ${-be}`);
    else if (f.status === 'be') where.push(`t.net_pnl BETWEEN ${-be} AND ${be}`);
  }
  const sql = `SELECT t.* FROM trades t ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.entered_ts ASC, t.id ASC`;
  const rows = db.prepare(sql).all(...args) as TradeRow[];
  if (dayCol === 'session_date') for (const r of rows) r.date = r.session_date;
  return rows;
}

export function tagsByTrade() {
  const rows = db
    .prepare('SELECT tt.trade_id, g.id, g.name, g.category FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id')
    .all() as { trade_id: number; id: number; name: string; category: string }[];
  const map = new Map<number, { id: number; name: string; category: string }[]>();
  for (const r of rows) (map.get(r.trade_id) ?? map.set(r.trade_id, []).get(r.trade_id)!).push({ id: r.id, name: r.name, category: r.category });
  return map;
}

export function strategyNames() {
  const rows = db.prepare('SELECT id, name FROM strategies').all() as { id: number; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function dayFacts(dates: string[], primarySymbol: Map<string, string>): Map<string, DayFacts> {
  const meta = new Map(
    (db.prepare('SELECT date, mood, mood_note FROM day_meta').all() as { date: string; mood: number | null; mood_note: string }[]).map((r) => [r.date, r]),
  );
  const notes = new Map(
    (db.prepare("SELECT date, body_text FROM notes WHERE type = 'day'").all() as { date: string; body_text: string }[]).map((r) => [r.date, r.body_text]),
  );
  const total = (db.prepare('SELECT COUNT(*) c FROM checklist_items WHERE active = 1').get() as { c: number }).c;
  const done = new Map(
    (db.prepare('SELECT date, SUM(done) c FROM checklist_log GROUP BY date').all() as { date: string; c: number }[]).map((r) => [r.date, r.c]),
  );
  const out = new Map<string, DayFacts>();
  for (const date of dates) {
    const sym = primarySymbol.get(date);
    const ctx = sym ? dayContext(sym, date) : null;
    const m = meta.get(date);
    out.set(date, {
      date,
      mood: m?.mood ?? null,
      moodNote: m?.mood_note ?? '',
      checklistDone: done.get(date) ?? 0,
      checklistTotal: total,
      dayType: ctx?.dayType === 'In progress' ? null : (ctx?.dayType ?? null),
      gap: ctx?.gap ?? null,
      relativeRange: ctx?.relativeRange ?? null,
      noteText: notes.get(date) ?? '',
    });
  }
  return out;
}

export function primarySymbols(trades: TradeRow[]) {
  const map = new Map<string, string>();
  for (const t of trades) {
    if (!map.has(t.date) || (feedFor(t.symbol) && !feedFor(map.get(t.date)!))) map.set(t.date, t.symbol);
  }
  return map;
}

export function entryContexts(trades: TradeRow[]) {
  const tz = getSettings().timezone;
  const map: NonNullable<TradeExtras['entry']> = new Map();
  for (const t of trades) {
    const { bars, interval } = sessionBars(t.symbol, t.date);
    if (!bars.length) continue;
    map.set(t.id, entryContext(t, bars, interval, zonedTs(t.date, 570, tz)));
  }
  return map;
}

export function analyze(trades: TradeRow[]) {
  const be = beThreshold();
  const tags = tagsByTrade();
  const strategies = strategyNames();
  const positions = toPositions(trades, be, { tags, strategies, entry: entryContexts(trades) });
  const primary = primarySymbols(trades);
  const facts = dayFacts([...primary.keys()], primary);
  return { positions, facts, patterns: buildPatterns(positions, facts) };
}

export function checklistFor(date: string) {
  const items = db.prepare('SELECT id, label FROM checklist_items WHERE active = 1 ORDER BY sort, id').all() as { id: number; label: string }[];
  const done = new Set(
    (db.prepare('SELECT item_id FROM checklist_log WHERE date = ? AND done = 1').all(date) as { item_id: number }[]).map((r) => r.item_id),
  );
  return items.map((i) => ({ ...i, done: done.has(i.id) }));
}

export function attachmentsFor(ownerType: string, ownerKey: string) {
  return db.prepare('SELECT * FROM attachments WHERE owner_type = ? AND owner_key = ? ORDER BY id').all(ownerType, ownerKey) as Attachment[];
}

export interface Attachment {
  id: number;
  owner_type: string;
  owner_key: string;
  kind: string;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  caption: string;
  created_at: string;
}
