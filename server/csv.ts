import { wallClock } from './time.ts';

export interface ParsedTrade {
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
}

const POINT_VALUES: Record<string, number> = {
  NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
  CL: 1000, MCL: 100, QM: 500, NG: 10000, GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000,
  '6E': 125000, '6J': 12500000, '6B': 62500, '6A': 100000, '6C': 100000,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000, UB: 1000,
};

/** MNQZ6 -> MNQ, NQZ26 -> NQ, CON.F.US.ENQ.Z26 stays as-is. */
export function rootSymbol(contract: string) {
  const m = contract.trim().toUpperCase().match(/^([A-Z0-9]{1,4}?)[FGHJKMNQUVXZ]\d{1,2}$/);
  return m ? m[1] : contract.trim().toUpperCase();
}

export function pointValue(symbol: string, fallback?: { gross: number; qty: number; move: number }) {
  if (POINT_VALUES[symbol]) return POINT_VALUES[symbol];
  if (fallback && fallback.qty && fallback.move) return Math.abs(fallback.gross / (fallback.qty * fallback.move));
  return 1;
}

function splitLine(line: string) {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** `11/02/2026 09:36:34 -05:00` -> ISO string + epoch ms (the offset in the file is authoritative). */
export function parseTimestamp(raw: string) {
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?\s*([+-]\d{2}:?\d{2}|Z)?$/);
  let iso = s;
  if (m) {
    const [, mo, d, y, h, mi, sec, off] = m;
    const offset = off ? (off === 'Z' ? 'Z' : off.includes(':') ? off : `${off.slice(0, 3)}:${off.slice(3)}`) : 'Z';
    iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${sec}${offset}`;
  }
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) throw new Error(`Could not read timestamp "${raw}"`);
  return { iso, ts };
}

/** `00:23:39.8532780` or `1.02:03:04.5` -> seconds. */
export function parseDuration(raw: string) {
  const m = raw.trim().match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

const REQUIRED = ['Id', 'ContractName', 'EnteredAt', 'ExitedAt', 'EntryPrice', 'ExitPrice', 'Fees', 'PnL', 'Size', 'Type'];

export function parseTopstepCsv(text: string, tz: string): ParsedTrade[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new Error('The file is empty.');
  const header = splitLine(lines[0]).map((h) => h.trim());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new Error(`This doesn't look like a Topstep trade export. Missing column(s): ${missing.join(', ')}.`);
  }
  const col = (row: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  };

  return lines.slice(1).map((line, idx) => {
    const row = splitLine(line);
    const where = `row ${idx + 2}`;
    const contract = col(row, 'ContractName');
    const type = col(row, 'Type');
    if (type !== 'Long' && type !== 'Short') throw new Error(`Unknown side "${type}" on ${where}.`);
    const entered = parseTimestamp(col(row, 'EnteredAt'));
    const exited = parseTimestamp(col(row, 'ExitedAt'));
    const num = (name: string) => {
      const raw = col(row, name);
      const v = raw === '' ? 0 : Number(raw);
      if (Number.isNaN(v)) throw new Error(`Bad number "${raw}" in ${name} on ${where}.`);
      return v;
    };
    const qty = num('Size');
    const entry = num('EntryPrice');
    const exit = num('ExitPrice');
    const gross = num('PnL');
    const fees = num('Fees');
    const commissions = num('Commissions');
    const symbol = rootSymbol(contract);
    const open = wallClock(entered.ts, tz);
    const close = wallClock(exited.ts, tz);
    const parsedDuration = parseDuration(col(row, 'TradeDuration'));
    const tradeDay = col(row, 'TradeDay');
    const session = tradeDay ? wallDate(tradeDay) : open.date;

    return {
      external_id: col(row, 'Id'),
      symbol,
      contract,
      side: type,
      qty,
      entry_price: entry,
      exit_price: exit,
      entered_at: entered.iso,
      exited_at: exited.iso,
      entered_ts: entered.ts,
      exited_ts: exited.ts,
      date: open.date,
      open_time: open.time,
      close_date: close.date,
      close_time: close.time,
      session_date: session,
      duration_sec: Number.isNaN(parsedDuration) ? (exited.ts - entered.ts) / 1000 : parsedDuration,
      gross_pnl: gross,
      fees,
      commissions,
      // Topstep reports PnL before costs, e.g. $975 - $2.78 fees - $1.00 commission = $971.22.
      net_pnl: round2(gross - fees - commissions),
      point_value: pointValue(symbol, { gross, qty, move: exit - entry }),
    };
  });
}

/** TradeDay is a label ("11/02/2026 00:00:00 -06:00"), so take its printed date, not its instant. */
function wallDate(raw: string) {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return raw.slice(0, 10);
}

export function round2(v: number) {
  return Math.round(v * 100) / 100;
}
