import { addDays } from './time.ts';

export interface TradeRow {
  id: number;
  account_id: number;
  import_id: number | null;
  external_id: string;
  symbol: string;
  contract: string;
  side: 'Long' | 'Short';
  qty: number;
  entry_price: number;
  exit_price: number;
  entered_at: string;
  exited_at: string;
  entered_ts: number;
  exited_ts: number;
  date: string;
  open_time: string;
  close_date: string;
  close_time: string;
  session_date: string;
  duration_sec: number;
  gross_pnl: number;
  fees: number;
  commissions: number;
  net_pnl: number;
  point_value: number;
  strategy_id: number | null;
  risk_amount: number | null;
  rating: number | null;
  entry_type: string | null;
  exit_type: string | null;
  stop_price: number | null;
  /** Set on a merged trade: how many accounts took it, and the rows it was built from. */
  copies?: number;
  member_ids?: number[];
}

export type Outcome = 'win' | 'loss' | 'be';

/** A result inside the break-even band is neither a win nor a loss. */
export function outcome(net: number, beThreshold: number): Outcome {
  if (net > beThreshold) return 'win';
  if (net < -beThreshold) return 'loss';
  return 'be';
}

/** The break-even band is per account, so a merged trade is judged on what each account made. */
export const tradeOutcome = (t: Pick<TradeRow, 'net_pnl' | 'copies'>, beThreshold: number) => outcome(t.net_pnl / (t.copies ?? 1), beThreshold);

export const memberIds = (t: Pick<TradeRow, 'id' | 'member_ids'>) => t.member_ids ?? [t.id];

export function netRoi(t: Pick<TradeRow, 'net_pnl' | 'entry_price' | 'point_value' | 'qty'>) {
  const notional = t.entry_price * t.point_value * t.qty;
  return notional ? (t.net_pnl / notional) * 100 : 0;
}

export function rMultiple(t: Pick<TradeRow, 'net_pnl' | 'risk_amount'>) {
  return t.risk_amount ? t.net_pnl / t.risk_amount : null;
}

export interface Summary {
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgWinLoss: number;
  net: number;
  gross: number;
  costs: number;
  volume: number;
  largestWin: number;
  largestLoss: number;
  avgHoldWin: number;
  avgHoldLoss: number;
  avgHold: number;
  expectancy: number;
  longNet: number;
  shortNet: number;
  longCount: number;
  shortCount: number;
  days: number;
  dayWins: number;
  dayLosses: number;
  dayBreakevens: number;
  dayWinRate: number;
  bestDay: { date: string; net: number } | null;
  worstDay: { date: string; net: number } | null;
  avgDayNet: number;
  maxWinStreak: number;
  maxLossStreak: number;
  maxDayWinStreak: number;
  maxDayLossStreak: number;
}

export interface DayStat {
  date: string;
  net: number;
  gross: number;
  costs: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  profitFactor: number;
  volume: number;
  cum: number;
  drawdown: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

function streaks<T>(items: T[], pred: (t: T) => boolean | null) {
  let best = 0;
  let cur = 0;
  for (const it of items) {
    const r = pred(it);
    if (r === null) continue;
    if (r) best = Math.max(best, ++cur);
    else cur = 0;
  }
  return best;
}

export function dailyStats(trades: TradeRow[], be: number): DayStat[] {
  const byDay = new Map<string, TradeRow[]>();
  for (const t of trades) {
    const list = byDay.get(t.date);
    if (list) list.push(t);
    else byDay.set(t.date, [t]);
  }
  let cum = 0;
  let peak = 0;
  return [...byDay.keys()].sort().map((date) => {
    const rows = byDay.get(date)!;
    const s = summarizeRows(rows, be);
    cum += s.net;
    peak = Math.max(peak, cum);
    return {
      date,
      net: s.net,
      gross: s.gross,
      costs: s.costs,
      trades: rows.length,
      wins: s.wins,
      losses: s.losses,
      breakevens: s.breakevens,
      winRate: s.winRate,
      profitFactor: s.profitFactor,
      volume: s.volume,
      cum,
      drawdown: cum - peak,
    };
  });
}

function summarizeRows(trades: TradeRow[], be: number) {
  const winners = trades.filter((t) => tradeOutcome(t, be) === 'win');
  const losers = trades.filter((t) => tradeOutcome(t, be) === 'loss');
  const grossWin = sum(winners.map((t) => t.net_pnl));
  const grossLoss = Math.abs(sum(losers.map((t) => t.net_pnl)));
  const decided = winners.length + losers.length;
  return {
    wins: winners.length,
    losses: losers.length,
    breakevens: trades.length - decided,
    winRate: decided ? (winners.length / decided) * 100 : 0,
    grossWin,
    grossLoss,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    net: sum(trades.map((t) => t.net_pnl)),
    gross: sum(trades.map((t) => t.gross_pnl)),
    costs: sum(trades.map((t) => t.fees + t.commissions)),
    volume: sum(trades.map((t) => t.qty)),
    winners,
    losers,
  };
}

export function summarize(trades: TradeRow[], be: number): Summary {
  const s = summarizeRows(trades, be);
  const days = dailyStats(trades, be);
  const dayOutcomes = days.map((d) => outcome(d.net, be));
  const dayWins = dayOutcomes.filter((o) => o === 'win').length;
  const dayLosses = dayOutcomes.filter((o) => o === 'loss').length;
  const avgWin = s.wins ? s.grossWin / s.wins : 0;
  const avgLoss = s.losses ? s.grossLoss / s.losses : 0;
  const sorted = [...trades].sort((a, b) => a.entered_ts - b.entered_ts);
  const best = days.reduce<DayStat | null>((b, d) => (!b || d.net > b.net ? d : b), null);
  const worst = days.reduce<DayStat | null>((b, d) => (!b || d.net < b.net ? d : b), null);
  const longs = trades.filter((t) => t.side === 'Long');
  const shorts = trades.filter((t) => t.side === 'Short');
  const toOutcome = (o: Outcome) => (o === 'be' ? null : o === 'win');
  const toLoss = (o: Outcome) => (o === 'be' ? null : o === 'loss');

  return {
    count: trades.length,
    wins: s.wins,
    losses: s.losses,
    breakevens: s.breakevens,
    winRate: s.winRate,
    grossWin: s.grossWin,
    grossLoss: s.grossLoss,
    profitFactor: s.profitFactor,
    avgWin,
    avgLoss,
    avgWinLoss: avgLoss ? avgWin / avgLoss : 0,
    net: s.net,
    gross: s.gross,
    costs: s.costs,
    volume: s.volume,
    largestWin: Math.max(0, ...trades.map((t) => t.net_pnl)),
    largestLoss: Math.min(0, ...trades.map((t) => t.net_pnl)),
    avgHoldWin: avg(s.winners.map((t) => t.duration_sec)),
    avgHoldLoss: avg(s.losers.map((t) => t.duration_sec)),
    avgHold: avg(trades.map((t) => t.duration_sec)),
    expectancy: trades.length ? s.net / trades.length : 0,
    longNet: sum(longs.map((t) => t.net_pnl)),
    shortNet: sum(shorts.map((t) => t.net_pnl)),
    longCount: longs.length,
    shortCount: shorts.length,
    days: days.length,
    dayWins,
    dayLosses,
    dayBreakevens: days.length - dayWins - dayLosses,
    dayWinRate: dayWins + dayLosses ? (dayWins / (dayWins + dayLosses)) * 100 : 0,
    bestDay: best ? { date: best.date, net: best.net } : null,
    worstDay: worst ? { date: worst.date, net: worst.net } : null,
    avgDayNet: days.length ? s.net / days.length : 0,
    maxWinStreak: streaks(sorted, (t) => toOutcome(tradeOutcome(t, be))),
    maxLossStreak: streaks(sorted, (t) => toLoss(tradeOutcome(t, be))),
    maxDayWinStreak: streaks(dayOutcomes, toOutcome),
    maxDayLossStreak: streaks(dayOutcomes, toLoss),
  };
}

/** Rows that overlap in one account are one position: a single trade split across partial fills. */
export function groupIntoPositions(trades: TradeRow[]) {
  const sorted = [...trades].sort((a, b) => a.entered_ts - b.entered_ts || a.id - b.id);
  const groups: TradeRow[][] = [];
  for (const t of sorted) {
    const open = groups.findLast(
      (g) =>
        g[0].account_id === t.account_id &&
        g[0].date === t.date &&
        g[0].symbol === t.symbol &&
        g[0].side === t.side &&
        t.entered_ts <= Math.max(...g.map((r) => r.exited_ts)),
    );
    if (open) open.push(t);
    else groups.push([t]);
  }
  return groups;
}

// Copiers fill within moments of the lead, on the same side, at nearly the same price.
const COPY_WINDOW_MS = 10_000;
const COPY_PRICE_TOLERANCE = 0.0005;
const FULL_SIZE: Record<string, string> = { MNQ: 'NQ', MES: 'ES', MYM: 'YM', M2K: 'RTY', MGC: 'GC', MCL: 'CL' };

interface CopyCluster {
  accounts: Set<number>;
  key: string;
  openTs: number;
  closeTs: number;
  entry: number;
  groups: TradeRow[][];
}

function combine(groups: TradeRow[][]): TradeRow {
  const lead = [...groups].sort((a, b) => a[0].account_id - b[0].account_id)[0];
  const rows = groups.flat();
  const add = (pick: (r: TradeRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  const qty = add((r) => r.qty);
  const planned = lead.filter((r) => r.risk_amount !== null);
  const riskPerContract = planned.length ? planned.reduce((a, r) => a + r.risk_amount!, 0) / planned.reduce((a, r) => a + r.qty, 0) : null;
  return {
    ...lead[0],
    qty,
    entry_price: add((r) => r.entry_price * r.qty) / qty,
    exit_price: add((r) => r.exit_price * r.qty) / qty,
    entered_ts: Math.min(...lead.map((r) => r.entered_ts)),
    exited_ts: Math.max(...lead.map((r) => r.exited_ts)),
    gross_pnl: Math.round(add((r) => r.gross_pnl) * 100) / 100,
    fees: add((r) => r.fees),
    commissions: add((r) => r.commissions),
    net_pnl: Math.round(add((r) => r.net_pnl) * 100) / 100,
    risk_amount: riskPerContract === null ? null : riskPerContract * qty,
    strategy_id: rows.find((r) => r.strategy_id)?.strategy_id ?? null,
    copies: groups.length,
    member_ids: rows.map((r) => r.id),
  };
}

/**
 * The same trade in several accounts becomes one trade carrying the combined size and P&L.
 * Matching compares whole positions, so accounts can split the same fills into different rows.
 * A trade only one account took stays as it is.
 */
export function mergeCopies(trades: TradeRow[]) {
  if (new Set(trades.map((t) => t.account_id)).size < 2) return trades;
  const clusters: CopyCluster[] = [];
  const startOf = (g: TradeRow[]) => Math.min(...g.map((r) => r.entered_ts));
  const positions = groupIntoPositions(trades).sort((a, b) => startOf(a) - startOf(b));
  for (const rows of positions) {
    const first = rows[0];
    const size = rows.reduce((a, r) => a + r.qty, 0);
    const entry = rows.reduce((a, r) => a + r.entry_price * r.qty, 0) / size;
    const openTs = startOf(rows);
    const closeTs = Math.max(...rows.map((r) => r.exited_ts));
    const key = `${first.date}|${first.side}|${FULL_SIZE[first.symbol] ?? first.symbol}`;
    const match = clusters.findLast(
      (c) =>
        c.key === key &&
        !c.accounts.has(first.account_id) &&
        Math.abs(c.openTs - openTs) <= COPY_WINDOW_MS &&
        Math.abs(c.closeTs - closeTs) <= COPY_WINDOW_MS &&
        Math.abs(c.entry - entry) / c.entry <= COPY_PRICE_TOLERANCE,
    );
    if (match) {
      match.accounts.add(first.account_id);
      match.groups.push(rows);
    } else clusters.push({ accounts: new Set([first.account_id]), key, openTs, closeTs, entry, groups: [rows] });
  }
  return clusters.flatMap((c) => (c.groups.length > 1 ? [combine(c.groups)] : c.groups[0])).sort((a, b) => a.entered_ts - b.entered_ts || a.id - b.id);
}

function interpolate(value: number, points: [number, number][]) {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (value <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

const RATIO_SCALE: [number, number][] = [[0, 0], [1.8, 50], [1.9, 60], [2, 70], [2.2, 80], [2.4, 90], [2.6, 100]];
const RECOVERY_SCALE: [number, number][] = [[0, 0], [1, 1], [1.5, 30], [2, 50], [2.5, 60], [3, 70], [3.49, 89], [3.5, 100]];

export interface EdgeScore {
  score: number;
  parts: { key: string; label: string; value: number; display: string; weight: number }[];
}

export function edgeScore(summary: Summary, days: DayStat[]): EdgeScore {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const nets = days.map((d) => d.net);
  const mean = avg(nets);
  const stdev = Math.sqrt(avg(nets.map((n) => (n - mean) ** 2)));

  let largestDrop = 0;
  let peakAtDrop = 0;
  let peak = 0;
  for (const d of days) {
    peak = Math.max(peak, d.cum);
    if (peak - d.cum > largestDrop) {
      largestDrop = peak - d.cum;
      peakAtDrop = peak;
    }
  }
  const ddPct = peakAtDrop > 0 ? (largestDrop / peakAtDrop) * 100 : largestDrop > 0 ? 100 : 0;
  const recovery = largestDrop ? summary.net / largestDrop : summary.net > 0 ? 99 : 0;
  const profitFactor = Number.isFinite(summary.profitFactor) ? summary.profitFactor : 99;

  const parts = [
    { key: 'win', label: 'Win %', value: clamp((summary.winRate / 60) * 100), display: `${summary.winRate.toFixed(1)}%`, weight: 0.15 },
    { key: 'pf', label: 'Profit factor', value: interpolate(profitFactor, RATIO_SCALE), display: profitFactor.toFixed(2), weight: 0.25 },
    { key: 'awl', label: 'Avg win/loss', value: interpolate(summary.avgWinLoss, RATIO_SCALE), display: summary.avgWinLoss.toFixed(2), weight: 0.2 },
    { key: 'rec', label: 'Recovery factor', value: interpolate(recovery, RECOVERY_SCALE), display: recovery.toFixed(2), weight: 0.1 },
    { key: 'dd', label: 'Max drawdown', value: clamp(100 - ddPct), display: `${ddPct.toFixed(1)}%`, weight: 0.2 },
    { key: 'con', label: 'Consistency', value: mean <= 0 || summary.net <= 0 ? 0 : clamp(100 - (stdev / summary.net) * 100), display: `$${stdev.toFixed(0)} σ`, weight: 0.1 },
  ];
  const score = days.length ? parts.reduce((total, p) => total + p.value * p.weight, 0) : 0;
  return { score, parts };
}

/** Trade-by-trade flags shown in the "Insights" column and on the trade page. */
export function tradeInsights(trades: TradeRow[], summary: Summary, be: number) {
  const result = new Map<number, string[]>();
  const avgQty = new Map<string, number>();
  const sizePerAccount = (t: TradeRow) => t.qty / (t.copies ?? 1);
  for (const sym of new Set(trades.map((t) => t.symbol))) {
    avgQty.set(sym, avg(trades.filter((t) => t.symbol === sym).map(sizePerAccount)));
  }
  const byDay = new Map<string, TradeRow[]>();
  for (const t of trades) (byDay.get(t.date) ?? byDay.set(t.date, []).get(t.date)!).push(t);

  for (const rows of byDay.values()) {
    const sorted = [...rows].sort((a, b) => a.entered_ts - b.entered_ts);
    sorted.forEach((t, i) => {
      const flags: string[] = [];
      const o = tradeOutcome(t, be);
      const prior = sorted.slice(0, i).filter((p) => p.exited_ts <= t.entered_ts).sort((a, b) => b.exited_ts - a.exited_ts)[0];
      if (prior && tradeOutcome(prior, be) === 'loss') {
        const gap = (t.entered_ts - prior.exited_ts) / 60000;
        if (gap <= 3) flags.push(`Re-entered ${gap < 1 ? 'under a minute' : `${gap.toFixed(0)} min`} after a loss`);
      }
      if (o === 'loss' && summary.avgLoss && Math.abs(t.net_pnl) > summary.avgLoss * 1.5) {
        flags.push(`Loss was ${(Math.abs(t.net_pnl) / summary.avgLoss).toFixed(1)}× your average loss`);
      }
      if (o === 'win' && summary.avgWin && t.net_pnl < summary.avgWin * 0.25) flags.push('Winner far below your average win');
      if (o === 'win' && summary.avgWin && t.net_pnl > summary.avgWin * 2) flags.push(`Winner was ${(t.net_pnl / summary.avgWin).toFixed(1)}× your average win`);
      const q = avgQty.get(t.symbol) ?? 0;
      if (q && sizePerAccount(t) > q * 1.5) flags.push(`Size ${sizePerAccount(t)} vs your usual ${q.toFixed(1)} on ${t.symbol}`);
      if (o === 'loss' && summary.avgHoldWin && t.duration_sec > summary.avgHoldWin * 2) {
        flags.push(`Held this loser ${(t.duration_sec / summary.avgHoldWin).toFixed(1)}× as long as your average winner`);
      }
      if (i >= 8) flags.push(`Trade #${i + 1} of the day`);
      result.set(t.id, flags);
    });
  }
  return result;
}

/** Equity by calendar day for one set of trades plus deposits/withdrawals. */
export function balanceSeries(days: DayStat[], startBalance: number, txns: { date: string; amount: number }[]) {
  const dates = [...new Set([...days.map((d) => d.date), ...txns.map((t) => t.date)])].sort();
  if (!dates.length) return [];
  const dayNet = new Map(days.map((d) => [d.date, d.net]));
  let balance = startBalance;
  return dates.map((date) => {
    const flow = txns.filter((t) => t.date === date).reduce((a, t) => a + t.amount, 0);
    balance += (dayNet.get(date) ?? 0) + flow;
    return { date, balance, flow };
  });
}

export { addDays };
