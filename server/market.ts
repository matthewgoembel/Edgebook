import { db, getSettings } from './db.ts';
import { addDays, today, wallClock, zonedTs } from './time.ts';

/** [unix seconds, open, high, low, close, volume] */
export type Bar = [number, number, number, number, number, number];

const FEEDS: Record<string, string> = {
  NQ: 'NQ=F', MNQ: 'NQ=F', ES: 'ES=F', MES: 'ES=F', YM: 'YM=F', MYM: 'YM=F', RTY: 'RTY=F', M2K: 'RTY=F',
  GC: 'GC=F', MGC: 'GC=F', SI: 'SI=F', CL: 'CL=F', MCL: 'CL=F', NG: 'NG=F',
};

export const feedFor = (symbol: string) => FEEDS[symbol] ?? null;

async function download(feed: string, from: number, to: number, interval: string): Promise<Bar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(feed)}?interval=${interval}&period1=${Math.floor(from / 1000)}&period2=${Math.floor(to / 1000)}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  const stamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  if (!q) return [];
  const bars: Bar[] = [];
  stamps.forEach((t, i) => {
    if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) return;
    bars.push([t, q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] ?? 0]);
  });
  return bars;
}

const upsertBars = db.prepare(`
  INSERT INTO market_bars (symbol, date, interval, bars, fetched_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(symbol, date) DO UPDATE SET interval = excluded.interval, bars = excluded.bars, fetched_at = excluded.fetched_at
`);

const parsedBars = new Map<string, { interval: string; bars: Bar[] }>();
const rthMemo = new Map<string, Bar[]>();
const contextMemo = new Map<string, DayContext | null>();

function clearMemos() {
  parsedBars.clear();
  rthMemo.clear();
  contextMemo.clear();
}

function stored(feed: string, date: string) {
  return db.prepare('SELECT interval, bars, fetched_at FROM market_bars WHERE symbol = ? AND date = ?').get(feed, date) as
    | { interval: string; bars: string; fetched_at: number }
    | undefined;
}

async function fetchDay(feed: string, date: string, tz: string) {
  const existing = stored(feed, date);
  const now = today(tz);
  const final = (fetchedAt: number) => wallClock(fetchedAt, tz).date > date;
  // Finished days are permanent; today can be refreshed every few minutes.
  if (existing && existing.interval === '1m' && final(existing.fetched_at)) return;
  if (existing && date === now && Date.now() - existing.fetched_at < 5 * 60_000) return;
  if (existing && existing.interval === '5m' && final(existing.fetched_at)) return;

  const ageDays = (Date.parse(`${now}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  if (ageDays < 0 || ageDays > 58) return;
  const from = zonedTs(date, 0, tz);
  const to = zonedTs(addDays(date, 1), 0, tz);
  try {
    if (ageDays <= 27) {
      const bars = await download(feed, from, to, '1m');
      if (bars && bars.length) {
        upsertBars.run(feed, date, '1m', JSON.stringify(bars), Date.now());
        clearMemos();
        return;
      }
    }
    const bars = await download(feed, from, to, '5m');
    if (bars) {
      upsertBars.run(feed, date, '5m', JSON.stringify(bars), Date.now());
      clearMemos();
    }
  } catch (err) {
    console.warn(`market data: ${feed} ${date} failed: ${(err as Error).message}`);
  }
}

/** Stores bars for each trading date plus the days before it (needed for the prior close / overnight). */
export async function ensureBars(symbol: string, dates: string[]) {
  const feed = feedFor(symbol);
  if (!feed) return;
  const tz = getSettings().timezone;
  const wanted = new Set<string>();
  for (const d of dates) for (let i = 0; i <= 3; i++) wanted.add(addDays(d, -i));
  for (const d of [...wanted].sort()) await fetchDay(feed, d, tz);
}

export function barsForDate(feed: string, date: string): { interval: string; bars: Bar[] } {
  const key = `${feed}|${date}`;
  const cached = parsedBars.get(key);
  if (cached) return cached;
  const row = stored(feed, date);
  const value = row ? { interval: row.interval, bars: JSON.parse(row.bars) as Bar[] } : { interval: 'none', bars: [] };
  parsedBars.set(key, value);
  return value;
}

/** Regular-hours bars (9:30-16:00 ET) for one date. */
function rthBars(feed: string, date: string, tz: string) {
  const key = `${feed}|${date}`;
  const cached = rthMemo.get(key);
  if (cached) return cached;
  const rows = barsForDate(feed, date).bars.filter((b) => {
    const m = wallClock(b[0] * 1000, tz).minutes;
    return m >= 570 && m < 960;
  });
  rthMemo.set(key, rows);
  return rows;
}

/** The Globex session for a date: 18:00 the evening before through the end of that date. */
export function sessionBars(symbol: string, date: string) {
  const feed = feedFor(symbol);
  if (!feed) return { interval: 'none', bars: [] as Bar[], feed: null };
  const tz = getSettings().timezone;
  const prev = barsForDate(feed, addDays(date, -1));
  const cur = barsForDate(feed, date);
  const start = zonedTs(addDays(date, -1), 18 * 60, tz) / 1000;
  const bars = [...prev.bars, ...cur.bars].filter((b) => b[0] >= start);
  return { interval: cur.interval, bars, feed };
}

export interface DayContext {
  date: string;
  feed: string;
  interval: string;
  dayType: string;
  complete: boolean;
  prevClose: number | null;
  overnightHigh: number | null;
  overnightLow: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  range: number;
  gap: number | null;
  firstHourHigh: number;
  firstHourLow: number;
  firstHourDirection: 'up' | 'down' | 'flat';
  closeLocation: number;
  vwap: number;
  pctAboveVwap: number;
  relativeRange: number | null;
}

function priorClose(feed: string, date: string, tz: string) {
  for (let i = 1; i <= 4; i++) {
    const rth = rthBars(feed, addDays(date, -i), tz);
    if (rth.length) return rth[rth.length - 1][4];
  }
  return null;
}

function averageRecentRange(feed: string, date: string, tz: string) {
  const ranges: number[] = [];
  for (let i = 1; i <= 21 && ranges.length < 10; i++) {
    const rth = rthBars(feed, addDays(date, -i), tz);
    if (rth.length > 30) ranges.push(Math.max(...rth.map((b) => b[2])) - Math.min(...rth.map((b) => b[3])));
  }
  return ranges.length >= 3 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : null;
}

export function dayContext(symbol: string, date: string): DayContext | null {
  const feed = feedFor(symbol);
  if (!feed) return null;
  const key = `${feed}|${date}`;
  if (contextMemo.has(key)) return contextMemo.get(key)!;
  const value = computeDayContext(feed, symbol, date);
  contextMemo.set(key, value);
  return value;
}

function computeDayContext(feed: string, symbol: string, date: string): DayContext | null {
  const tz = getSettings().timezone;
  const { bars, interval } = sessionBars(symbol, date);
  const stamped = bars.map((b) => ({ b, ...wallClock(b[0] * 1000, tz) }));
  const rth = stamped.filter((s) => s.date === date && s.minutes >= 570 && s.minutes < 960).map((s) => s.b);
  if (rth.length < 5) return null;

  const overnight = stamped.filter((s) => s.date < date || s.minutes < 570).map((s) => s.b);
  const firstHour = stamped.filter((s) => s.date === date && s.minutes >= 570 && s.minutes < 630).map((s) => s.b);
  const open = rth[0][1];
  const close = rth[rth.length - 1][4];
  const high = Math.max(...rth.map((b) => b[2]));
  const low = Math.min(...rth.map((b) => b[3]));
  const range = high - low;
  const prevClose = priorClose(feed, date, tz);

  let pv = 0;
  let vol = 0;
  let above = 0;
  let vwap = open;
  for (const b of rth) {
    const volume = b[5] || 1;
    pv += ((b[2] + b[3] + b[4]) / 3) * volume;
    vol += volume;
    vwap = pv / vol;
    if (b[4] >= vwap) above++;
  }

  const fhClose = firstHour[firstHour.length - 1]?.[4] ?? close;
  const fhMove = fhClose - open;
  const flat = Math.abs(fhMove) < range * 0.1;
  const firstHourDirection = flat ? 'flat' : fhMove > 0 ? 'up' : 'down';
  const body = close - open;
  const bodyRatio = range ? Math.abs(body) / range : 0;
  const direction = body >= 0 ? 'up' : 'down';
  const lastBarMinutes = wallClock(rth[rth.length - 1][0] * 1000, tz).minutes;
  const complete = lastBarMinutes >= 955;

  let dayType: string;
  if (!complete) dayType = 'In progress';
  else if (bodyRatio >= 0.6) dayType = `Trend ${direction}`;
  else if (bodyRatio < 0.25) dayType = 'Balance / chop';
  else if (firstHourDirection !== 'flat' && firstHourDirection !== direction) dayType = `Reversal ${direction}`;
  else dayType = `Rotation ${direction}`;

  const recent = averageRecentRange(feed, date, tz);
  return {
    date,
    feed,
    interval,
    dayType,
    complete,
    prevClose,
    overnightHigh: overnight.length ? Math.max(...overnight.map((b) => b[2])) : null,
    overnightLow: overnight.length ? Math.min(...overnight.map((b) => b[3])) : null,
    open,
    high,
    low,
    close,
    range,
    gap: prevClose == null ? null : open - prevClose,
    firstHourHigh: firstHour.length ? Math.max(...firstHour.map((b) => b[2])) : open,
    firstHourLow: firstHour.length ? Math.min(...firstHour.map((b) => b[3])) : open,
    firstHourDirection,
    closeLocation: range ? (close - low) / range : 0.5,
    vwap,
    pctAboveVwap: (above / rth.length) * 100,
    relativeRange: recent ? range / recent : null,
  };
}

export interface EntryContext {
  mfePoints: number | null;
  maePoints: number | null;
  vwapAtEntry: number | null;
  withVwap: boolean | null;
  rangeLocation: number | null;
}

/** How far price went for and against a trade while it was open, and where it entered within the day. */
export function entryContext(
  t: { side: 'Long' | 'Short'; entry_price: number; entered_ts: number; exited_ts: number },
  bars: Bar[],
  interval: string,
  sessionOpenTs: number,
): EntryContext {
  const empty = { mfePoints: null, maePoints: null, vwapAtEntry: null, withVwap: null, rangeLocation: null };
  const entrySec = t.entered_ts / 1000;
  const exitSec = t.exited_ts / 1000;
  const barSec = interval === '1m' ? 60 : 300;
  const during = bars.filter((b) => b[0] + barSec > entrySec && b[0] <= exitSec);
  if (!during.length) return empty;
  // The free feed is a continuous contract; skip the numbers if it isn't priced like the traded contract.
  const first = during[0];
  if (t.entry_price > first[2] * 1.002 || t.entry_price < first[3] * 0.998) return empty;

  const high = Math.max(...during.map((b) => b[2]));
  const low = Math.min(...during.map((b) => b[3]));
  const long = t.side === 'Long';
  const mfe = Math.max(0, long ? high - t.entry_price : t.entry_price - low);
  const mae = Math.max(0, long ? t.entry_price - low : high - t.entry_price);

  const sinceOpen = bars.filter((b) => b[0] >= sessionOpenTs / 1000 && b[0] <= entrySec);
  let vwapAtEntry: number | null = null;
  let rangeLocation: number | null = null;
  if (sinceOpen.length) {
    let pv = 0;
    let vol = 0;
    for (const b of sinceOpen) {
      const volume = b[5] || 1;
      pv += ((b[2] + b[3] + b[4]) / 3) * volume;
      vol += volume;
    }
    vwapAtEntry = pv / vol;
    const hi = Math.max(...sinceOpen.map((b) => b[2]));
    const lo = Math.min(...sinceOpen.map((b) => b[3]));
    rangeLocation = hi > lo ? (t.entry_price - lo) / (hi - lo) : null;
  }
  return {
    mfePoints: mfe,
    maePoints: mae,
    vwapAtEntry,
    withVwap: vwapAtEntry == null ? null : long ? t.entry_price >= vwapAtEntry : t.entry_price <= vwapAtEntry,
    rangeLocation,
  };
}
