import { outcome, type Outcome, type TradeRow } from './metrics.ts';
import { weekday } from './time.ts';

/**
 * Topstep writes one CSV row per matched fill, so a single 5-lot can be three "trades".
 * For pattern-finding we merge overlapping rows into the position you actually held.
 */
export interface Position {
  key: string;
  ids: number[];
  date: string;
  symbol: string;
  side: 'Long' | 'Short';
  qty: number;
  avgEntry: number;
  avgExit: number;
  openTs: number;
  closeTs: number;
  openTime: string;
  openMinutes: number;
  holdSec: number;
  net: number;
  gross: number;
  points: number;
  outcome: Outcome;
  seq: number;
  prev: Outcome | null;
  minutesSincePrev: number | null;
  tags: string[];
  mistakes: string[];
  setups: string[];
  strategy: string | null;
  entryType: string | null;
  plannedRisk: number | null;
  withVwap: boolean | null;
  rangeLocation: number | null;
  mfePoints: number | null;
  maePoints: number | null;
}

export interface DayFacts {
  date: string;
  mood: number | null;
  moodNote: string;
  checklistDone: number;
  checklistTotal: number;
  dayType: string | null;
  gap: number | null;
  relativeRange: number | null;
  noteText: string;
}

export interface TradeExtras {
  tags: Map<number, { name: string; category: string }[]>;
  strategies: Map<number, string>;
  entry?: Map<number, { withVwap: boolean | null; rangeLocation: number | null; mfePoints: number | null; maePoints: number | null }>;
}

export function toPositions(trades: TradeRow[], be: number, extras?: TradeExtras): Position[] {
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

  const lastByDay = new Map<string, Position>();
  const seqByDay = new Map<string, number>();
  return groups.map((rows) => {
    const first = rows[0];
    const qty = rows.reduce((a, r) => a + r.qty, 0);
    const weighted = (f: (r: TradeRow) => number) => rows.reduce((a, r) => a + f(r) * r.qty, 0) / qty;
    const net = rows.reduce((a, r) => a + r.net_pnl, 0);
    const avgEntry = weighted((r) => r.entry_price);
    const avgExit = weighted((r) => r.exit_price);
    const openTs = Math.min(...rows.map((r) => r.entered_ts));
    const closeTs = Math.max(...rows.map((r) => r.exited_ts));
    const [h, m, s] = first.open_time.split(':').map(Number);
    const seq = (seqByDay.get(first.date) ?? 0) + 1;
    seqByDay.set(first.date, seq);
    const prior = lastByDay.get(first.date) ?? null;
    const allTags = rows.flatMap((r) => extras?.tags.get(r.id) ?? []);
    const unique = (cat?: string) => [...new Set(allTags.filter((x) => !cat || x.category === cat).map((x) => x.name))];
    const entry = extras?.entry?.get(first.id);
    const position: Position = {
      key: rows.map((r) => r.id).join('-'),
      ids: rows.map((r) => r.id),
      date: first.date,
      symbol: first.symbol,
      side: first.side,
      qty,
      avgEntry,
      avgExit,
      openTs,
      closeTs,
      openTime: first.open_time,
      openMinutes: h * 60 + m + s / 60,
      holdSec: (closeTs - openTs) / 1000,
      net,
      gross: rows.reduce((a, r) => a + r.gross_pnl, 0),
      points: first.side === 'Long' ? avgExit - avgEntry : avgEntry - avgExit,
      outcome: outcome(net, be),
      seq,
      prev: prior?.outcome ?? null,
      minutesSincePrev: prior ? (openTs - prior.closeTs) / 60000 : null,
      tags: unique(),
      mistakes: unique('mistake'),
      setups: unique('setup'),
      strategy: first.strategy_id ? (extras?.strategies.get(first.strategy_id) ?? null) : null,
      entryType: first.entry_type,
      plannedRisk: rows.every((r) => r.risk_amount !== null) ? rows.reduce((a, r) => a + r.risk_amount!, 0) : null,
      withVwap: entry?.withVwap ?? null,
      rangeLocation: entry?.rangeLocation ?? null,
      mfePoints: entry?.mfePoints ?? null,
      maePoints: entry?.maePoints ?? null,
    };
    lastByDay.set(first.date, position);
    return position;
  });
}

export interface BucketRow {
  label: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  net: number;
  avg: number;
  profitFactor: number;
  lowSample: boolean;
}

export const MIN_SAMPLE = 20;

function rowFor(label: string, items: { net: number; outcome: Outcome }[]): BucketRow {
  const wins = items.filter((p) => p.outcome === 'win');
  const losses = items.filter((p) => p.outcome === 'loss');
  const grossWin = wins.reduce((a, p) => a + p.net, 0);
  const grossLoss = Math.abs(losses.reduce((a, p) => a + p.net, 0));
  const net = items.reduce((a, p) => a + p.net, 0);
  const decided = wins.length + losses.length;
  return {
    label,
    n: items.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decided ? (wins.length / decided) * 100 : 0,
    net,
    avg: items.length ? net / items.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? 99 : 0,
    lowSample: items.length < MIN_SAMPLE,
  };
}

function bucket<T extends { net: number; outcome: Outcome }>(items: T[], key: (t: T) => string | string[] | null, order?: string[]) {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k == null) continue;
    for (const label of Array.isArray(k) ? k : [k]) {
      (groups.get(label) ?? groups.set(label, []).get(label)!).push(it);
    }
  }
  const rows = [...groups.entries()].map(([label, g]) => rowFor(label, g));
  if (order) rows.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  else rows.sort((a, b) => b.net - a.net);
  return rows;
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const SESSIONS = ['Overnight', 'Pre-open (8:00–9:30)', 'Open drive (9:30–10:00)', 'Morning (10:00–11:30)', 'Lunch (11:30–13:30)', 'Afternoon (13:30–16:00)', 'Evening (after 16:00)'];
function sessionOf(mins: number) {
  if (mins < 480) return SESSIONS[0];
  if (mins < 570) return SESSIONS[1];
  if (mins < 600) return SESSIONS[2];
  if (mins < 690) return SESSIONS[3];
  if (mins < 810) return SESSIONS[4];
  if (mins < 960) return SESSIONS[5];
  return SESSIONS[6];
}

const HOLDS = ['Under 1 min', '1–5 min', '5–15 min', '15–60 min', 'Over 1 hour'];
function holdOf(sec: number) {
  if (sec < 60) return HOLDS[0];
  if (sec < 300) return HOLDS[1];
  if (sec < 900) return HOLDS[2];
  if (sec < 3600) return HOLDS[3];
  return HOLDS[4];
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MOODS = ['', 'Awful', 'Bad', 'Neutral', 'Good', 'Great'];

export interface Group {
  key: string;
  title: string;
  rows: BucketRow[];
}

export function buildPatterns(positions: Position[], facts: Map<string, DayFacts>) {
  const groups: Group[] = [
    { key: 'session', title: 'Time of session', rows: bucket(positions, (p) => sessionOf(p.openMinutes), SESSIONS) },
    {
      key: 'halfhour',
      title: '30-minute windows',
      rows: bucket(positions, (p) => hhmm(Math.floor(p.openMinutes / 30) * 30)).sort((a, b) => a.label.localeCompare(b.label)),
    },
    { key: 'weekday', title: 'Day of week', rows: bucket(positions, (p) => weekday(p.date), WEEKDAYS) },
    { key: 'side', title: 'Direction', rows: bucket(positions, (p) => p.side) },
    { key: 'symbol', title: 'Instrument', rows: bucket(positions, (p) => p.symbol) },
    { key: 'symbolside', title: 'Instrument + direction', rows: bucket(positions, (p) => `${p.symbol} ${p.side}`) },
    {
      key: 'seq',
      title: 'Trade number in the day',
      rows: bucket(positions, (p) => (p.seq >= 5 ? '5th or later' : `Trade ${p.seq}`), ['Trade 1', 'Trade 2', 'Trade 3', 'Trade 4', '5th or later']),
    },
    {
      key: 'after',
      title: 'What came right before',
      rows: bucket(positions, (p) => (p.prev === null ? 'First trade of the day' : p.prev === 'win' ? 'After a win' : p.prev === 'loss' ? 'After a loss' : 'After a scratch')),
    },
    {
      key: 'reentry',
      title: 'Speed of re-entry after a loss',
      rows: bucket(
        positions.filter((p) => p.prev === 'loss' && p.minutesSincePrev !== null),
        (p) => (p.minutesSincePrev! < 2 ? 'Under 2 min' : p.minutesSincePrev! < 10 ? '2–10 min' : p.minutesSincePrev! < 30 ? '10–30 min' : 'Over 30 min'),
        ['Under 2 min', '2–10 min', '10–30 min', 'Over 30 min'],
      ),
    },
    { key: 'hold', title: 'Hold time', rows: bucket(positions, (p) => holdOf(p.holdSec), HOLDS) },
    { key: 'entrytype', title: 'Entry order type', rows: bucket(positions, (p) => p.entryType) },
    {
      key: 'size',
      title: 'Position size',
      rows: bucket(positions, (p) => `${p.symbol} × ${p.qty <= 1 ? '1' : p.qty <= 3 ? '2–3' : p.qty <= 5 ? '4–5' : '6+'}`).sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      key: 'vwap',
      title: 'Entry vs VWAP',
      rows: bucket(positions, (p) => (p.withVwap === null ? null : p.withVwap ? 'With VWAP' : 'Against VWAP')),
    },
    {
      key: 'location',
      title: 'Entry location in the day range',
      rows: bucket(
        positions.filter((p) => p.rangeLocation !== null),
        (p) => {
          const favorable = p.side === 'Long' ? 1 - p.rangeLocation! : p.rangeLocation!;
          return favorable > 0.66 ? 'Good location' : favorable < 0.33 ? 'Chasing' : 'Mid-range';
        },
        ['Good location', 'Mid-range', 'Chasing'],
      ),
    },
    { key: 'daytype', title: 'Day type', rows: bucket(positions, (p) => facts.get(p.date)?.dayType ?? null) },
    {
      key: 'mood',
      title: 'Mood you logged',
      rows: bucket(positions, (p) => {
        const m = facts.get(p.date)?.mood;
        return m ? MOODS[m] : null;
      }, MOODS.slice(1).reverse()),
    },
    {
      key: 'checklist',
      title: 'Daily checklist',
      rows: bucket(positions, (p) => {
        const f = facts.get(p.date);
        if (!f || !f.checklistTotal) return null;
        return f.checklistDone === f.checklistTotal ? 'Checklist complete' : f.checklistDone === 0 ? 'Checklist skipped' : 'Checklist partial';
      }),
    },
    { key: 'setup', title: 'Setups', rows: bucket(positions, (p) => (p.setups.length ? p.setups : null)) },
    { key: 'mistake', title: 'Mistakes', rows: bucket(positions, (p) => (p.mistakes.length ? p.mistakes : null)) },
    { key: 'strategy', title: 'Strategies', rows: bucket(positions, (p) => p.strategy) },
  ].filter((g) => g.rows.length > 0);

  return { groups, ranked: rankEdges(groups, positions), behavior: behavior(positions), days: dayFindings(positions, facts) };
}

/** The strongest conditions in both directions, judged against your overall average per trade. */
function rankEdges(groups: Group[], positions: Position[]) {
  const baseline = positions.length ? positions.reduce((a, p) => a + p.net, 0) / positions.length : 0;
  const skip = new Set(['size', 'symbolside', 'halfhour']);
  const candidates = groups
    .filter((g) => !skip.has(g.key))
    .concat(groups.filter((g) => g.key === 'halfhour'))
    .flatMap((g) => g.rows.filter((r) => r.n >= 5 && r.n < positions.length).map((r) => ({ ...r, group: g.title, lift: r.avg - baseline })));
  const score = (c: (typeof candidates)[number]) => c.lift * Math.sqrt(c.n);
  const best = candidates.filter((c) => c.lift > 0).sort((a, b) => score(b) - score(a)).slice(0, 8);
  const worst = candidates.filter((c) => c.lift < 0).sort((a, b) => score(a) - score(b)).slice(0, 8);
  return { baseline, best, worst };
}

function behavior(positions: Position[]) {
  const revenge = positions.filter((p) => p.prev === 'loss' && (p.minutesSincePrev ?? 99) < 5);
  const sized = positions.filter((p, i) => {
    if (p.prev !== 'loss') return false;
    const before = positions.slice(0, i).findLast((x) => x.date === p.date && x.symbol === p.symbol);
    return !!before && p.qty > before.qty;
  });
  const winners = positions.filter((p) => p.outcome === 'win');
  const losers = positions.filter((p) => p.outcome === 'loss');
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const withMfe = positions.filter((p) => p.mfePoints !== null);
  const tradedWinners = withMfe.filter((p) => p.outcome === 'win' && p.points > 0);
  const captured = mean(tradedWinners.map((p) => (p.mfePoints ? Math.min(1, p.points / p.mfePoints) : 1)));

  const byDay = new Map<string, Position[]>();
  for (const p of positions) (byDay.get(p.date) ?? byDay.set(p.date, []).get(p.date)!).push(p);
  let greenToRed = 0;
  let givenBack = 0;
  for (const rows of byDay.values()) {
    let cum = 0;
    let peak = 0;
    for (const p of rows) {
      cum += p.net;
      peak = Math.max(peak, cum);
    }
    if (peak > 0 && peak - cum > 0) givenBack += peak - cum;
    if (peak > 200 && cum < 0) greenToRed++;
  }
  return {
    positions: positions.length,
    rawFillsMerged: positions.reduce((a, p) => a + p.ids.length, 0) - positions.length,
    revengeCount: revenge.length,
    revengeNet: revenge.reduce((a, p) => a + p.net, 0),
    sizedUpAfterLoss: sized.length,
    sizedUpAfterLossNet: sized.reduce((a, p) => a + p.net, 0),
    avgHoldWinnerMin: mean(winners.map((p) => p.holdSec)) / 60,
    avgHoldLoserMin: mean(losers.map((p) => p.holdSec)) / 60,
    greenToRedDays: greenToRed,
    givenBackFromPeak: givenBack,
    avgMfeCaptured: tradedWinners.length ? captured * 100 : null,
  };
}

function dayFindings(positions: Position[], facts: Map<string, DayFacts>) {
  const byDay = new Map<string, Position[]>();
  for (const p of positions) (byDay.get(p.date) ?? byDay.set(p.date, []).get(p.date)!).push(p);

  const days = [...byDay.entries()].map(([date, rows]) => {
    const net = rows.reduce((a, p) => a + p.net, 0);
    const f = facts.get(date);
    return {
      date,
      net,
      outcome: (net > 0 ? 'win' : net < 0 ? 'loss' : 'be') as Outcome,
      positions: rows.length,
      firstResult: rows[0].outcome,
      dayType: f?.dayType ?? null,
      gap: f?.gap ?? null,
      relativeRange: f?.relativeRange ?? null,
      mood: f?.mood ?? null,
    };
  });

  const groups: Group[] = [
    {
      key: 'count',
      title: 'Number of positions in the day',
      rows: bucket(days, (d) => (d.positions <= 2 ? '1–2 positions' : d.positions <= 4 ? '3–4 positions' : d.positions <= 7 ? '5–7 positions' : '8+ positions'), ['1–2 positions', '3–4 positions', '5–7 positions', '8+ positions']),
    },
    { key: 'first', title: 'First trade of the day', rows: bucket(days, (d) => (d.firstResult === 'win' ? 'First trade won' : d.firstResult === 'loss' ? 'First trade lost' : 'First trade scratched')) },
    { key: 'weekday', title: 'Day of week', rows: bucket(days, (d) => weekday(d.date), WEEKDAYS) },
    { key: 'daytype', title: 'Day type', rows: bucket(days, (d) => d.dayType) },
    {
      key: 'gap',
      title: 'Opening gap',
      rows: bucket(days, (d) => (d.gap === null ? null : d.gap > 75 ? 'Gap up' : d.gap < -75 ? 'Gap down' : 'Flat open')),
    },
    {
      key: 'range',
      title: 'Range vs recent days',
      rows: bucket(days, (d) => (d.relativeRange === null ? null : d.relativeRange > 1.25 ? 'Wide range day' : d.relativeRange < 0.75 ? 'Narrow range day' : 'Normal range')),
    },
    { key: 'mood', title: 'Mood you logged', rows: bucket(days, (d) => (d.mood ? MOODS[d.mood] : null), MOODS.slice(1).reverse()) },
  ].filter((g) => g.rows.length > 0);
  return groups;
}
