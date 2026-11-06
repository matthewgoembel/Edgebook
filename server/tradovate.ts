import { pointValue, round2, splitLine, type ParsedTrade } from './csv.ts';
import { wallClock, zonedTs } from './time.ts';

export type FileFormat = 'topstep' | 'tradovate-orders' | 'tradovate-cash' | 'tradovate-other' | 'unknown';

export function detectFormat(text: string): FileFormat {
  const header = splitLine(text.replace(/^﻿/, '').split(/\r?\n/, 1)[0]).map((h) => h.trim());
  const has = (...cols: string[]) => cols.every((c) => header.includes(c));
  if (has('Id', 'ContractName', 'EnteredAt')) return 'topstep';
  if (has('Order ID', 'B/S', 'Avg Fill Price', 'Fill Time')) return 'tradovate-orders';
  if (has('Transaction ID', 'Cash Change Type')) return 'tradovate-cash';
  if (has('B/S') || has('boughtTimestamp') || has('Position ID')) return 'tradovate-other';
  return 'unknown';
}

function table(text: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const number = (raw: string) => {
  const v = Number(raw.replace(/,/g, ''));
  return Number.isNaN(v) ? 0 : v;
};

/** Tradovate writes plain wall-clock times with no offset, in Eastern for this account. */
function wallTime(raw: string, tz: string) {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  const [, mo, d, y, h, mi, s] = m;
  return zonedTs(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, Number(h) * 60 + Number(mi) + Number(s) / 60, tz);
}

/** `11/3/26` -> 2026-11-03 */
function shortDate(raw: string) {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  return m ? `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

interface Order {
  id: string;
  account: string;
  side: 'Buy' | 'Sell';
  contract: string;
  product: string;
  qty: number;
  price: number;
  filledTs: number;
  placedTs: number;
  type: string;
  tradeDate: string | null;
  notional: number;
}

interface StopOrder {
  account: string;
  contract: string;
  side: 'Buy' | 'Sell';
  stopPrice: number;
  placedTs: number;
  tickSize: number;
}

function parseOrders(text: string, tz: string) {
  const orders: Order[] = [];
  const stops: StopOrder[] = [];
  for (const row of table(text)) {
    const side = row['B/S'];
    if (side !== 'Buy' && side !== 'Sell') continue;
    const placedTs = wallTime(row.Timestamp, tz);
    const stopPrice = number(row['Stop Price'] ?? '');
    if (stopPrice && /stop/i.test(row.Type) && row.Status !== 'Rejected') {
      stops.push({ account: row.Account, contract: row.Contract, side, stopPrice, placedTs, tickSize: number(row._tickSize) || 0.25 });
    }
    // A canceled order can still have partial fills, so go by filled size rather than status.
    const qty = number(row['Filled Qty'] || row.filledQty || '');
    if (qty <= 0) continue;
    const filledTs = wallTime(row['Fill Time'], tz);
    if (Number.isNaN(filledTs)) throw new Error(`Order ${row['Order ID']} has an unreadable fill time.`);
    orders.push({
      id: row['Order ID'],
      account: row.Account,
      side,
      contract: row.Contract,
      product: row.Product,
      qty,
      price: number(row['Avg Fill Price'] || row.avgPrice),
      filledTs,
      placedTs,
      type: row.Type,
      tradeDate: shortDate(row.Date),
      notional: number(row['Notional Value'] ?? ''),
    });
  }
  orders.sort((a, b) => a.filledTs - b.filledTs || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { orders, stops };
}

export interface BrokerTrade extends ParsedTrade {
  accountRef: string;
  entry_type: string;
  exit_type: string;
  stop_price: number | null;
  risk_amount: number | null;
}

/** The first stop on the far side of the entry, placed while this trade was being worked. */
function originalStop(entry: Order, exit: Order, stops: StopOrder[]) {
  const long = entry.side === 'Buy';
  const found = stops
    .filter(
      (s) =>
        s.account === entry.account &&
        s.contract === entry.contract &&
        s.side === exit.side &&
        s.placedTs >= entry.placedTs - 5000 &&
        s.placedTs <= exit.filledTs &&
        (long ? s.stopPrice < entry.price : s.stopPrice > entry.price),
    )
    .sort((a, b) => a.placedTs - b.placedTs)[0];
  // A stop this tight is almost certainly one that was moved to break-even.
  return found && Math.abs(entry.price - found.stopPrice) >= found.tickSize * 4 ? found.stopPrice : null;
}

function toTrade(entry: Order, exit: Order, qty: number, stops: StopOrder[], tz: string): BrokerTrade {
  const long = entry.side === 'Buy';
  const points = long ? exit.price - entry.price : entry.price - exit.price;
  const fromNotional = entry.notional && entry.price ? entry.notional / (entry.price * entry.qty) : 0;
  const pv = pointValue(entry.product, fromNotional ? { gross: fromNotional, qty: 1, move: 1 } : undefined);
  const gross = round2(points * pv * qty);
  const open = wallClock(entry.filledTs, tz);
  const close = wallClock(exit.filledTs, tz);
  const stop = originalStop(entry, exit, stops);
  return {
    accountRef: entry.account,
    external_id: `tv:${entry.id}:${exit.id}`,
    symbol: entry.product,
    contract: entry.contract,
    side: long ? 'Long' : 'Short',
    qty,
    entry_price: entry.price,
    exit_price: exit.price,
    entered_at: new Date(entry.filledTs).toISOString(),
    exited_at: new Date(exit.filledTs).toISOString(),
    entered_ts: entry.filledTs,
    exited_ts: exit.filledTs,
    date: open.date,
    open_time: open.time,
    close_date: close.date,
    close_time: close.time,
    session_date: entry.tradeDate ?? open.date,
    duration_sec: (exit.filledTs - entry.filledTs) / 1000,
    gross_pnl: gross,
    fees: 0,
    commissions: 0,
    net_pnl: gross,
    point_value: pv,
    entry_type: entry.type,
    exit_type: exit.type,
    stop_price: stop,
    risk_amount: stop === null ? null : round2(Math.abs(entry.price - stop) * pv * qty),
  };
}

/** Pairs fills first-in-first-out, the way Tradovate itself pairs them, into one row per matched size. */
export function parseTradovateOrders(text: string, tz: string) {
  const { orders, stops } = parseOrders(text, tz);
  const trades: BrokerTrade[] = [];
  const open = new Map<string, { order: Order; left: number }[]>();
  for (const order of orders) {
    const key = `${order.account}|${order.contract}`;
    const lots = open.get(key) ?? open.set(key, []).get(key)!;
    let left = order.qty;
    while (left > 0 && lots.length && lots[0].order.side !== order.side) {
      const lot = lots[0];
      const size = Math.min(left, lot.left);
      trades.push(toTrade(lot.order, order, size, stops, tz));
      left -= size;
      lot.left -= size;
      if (lot.left === 0) lots.shift();
    }
    if (left > 0) lots.push({ order, left });
  }
  const unmatched = [...open.values()].flat().reduce((total, lot) => total + lot.left, 0);
  return { trades, unmatched };
}

export interface CashRow {
  id: string;
  account: string;
  ts: number;
  date: string;
  type: string;
  amount: number;
  contract: string;
}

export function parseTradovateCash(text: string, tz: string): CashRow[] {
  return table(text).map((row) => ({
    id: row['Transaction ID'],
    account: row.Account,
    ts: wallTime(row.Timestamp, tz),
    date: row.Date,
    type: row['Cash Change Type'],
    amount: number(row.Delta),
    contract: row.Contract ?? '',
  }));
}

export const isTradeProceeds = (type: string) => type === 'Trade Paired';
export const isFunding = (type: string) => type === 'Fund Transaction';
/** Commissions and any other charge tied to a contract. */
export const isTradingCost = (row: { type: string; contract: string }) => row.contract !== '' && !isTradeProceeds(row.type) && !isFunding(row.type);

export interface CostTrade {
  id: number;
  contract: string;
  qty: number;
  entered_ts: number;
  exited_ts: number;
}

/** Each cash charge happens at a fill, so share it across the trades that used that fill by size. */
export function allocateCosts(trades: CostTrade[], cash: { ts: number; amount: number; contract: string }[]) {
  const costs = new Map<number, number>(trades.map((t) => [t.id, 0]));
  let unmatched = 0;
  const atFill = (charge: { ts: number; contract: string }, tolerance: number) =>
    trades.filter(
      (t) => t.contract === charge.contract && (Math.abs(t.entered_ts - charge.ts) <= tolerance || Math.abs(t.exited_ts - charge.ts) <= tolerance),
    );
  for (const charge of cash) {
    const rows = atFill(charge, 0).length ? atFill(charge, 0) : atFill(charge, 2000);
    if (!rows.length) {
      unmatched += 1;
      continue;
    }
    const size = rows.reduce((total, t) => total + t.qty, 0);
    for (const t of rows) costs.set(t.id, costs.get(t.id)! + (-charge.amount * t.qty) / size);
  }
  return { costs, unmatched };
}
