import { createContext, useContext } from 'react';

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json' } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') window.dispatchEvent(new Event('edgebook:signed-out'));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const money = (v: number, opts: { cents?: boolean } = {}) => {
  const cents = opts.cents ?? true;
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${v < 0 ? '-' : ''}$${abs}`;
};

export const moneyShort = (v: number) => {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(a >= 10000 ? 1 : 2).replace(/\.?0+$/, '')}K`;
  return `${sign}$${a.toFixed(a % 1 === 0 ? 0 : 0)}`;
};

export const pct = (v: number, digits = 2) => `${v.toFixed(digits)}%`;
export const signClass = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
export const price = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function duration(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}

/** 2026-11-02 -> 11/02/2026 */
export const usDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

export function longDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const profitFactorLabel = (pf: number | null | undefined) => (pf == null || !Number.isFinite(pf) ? '—' : pf.toFixed(2));

export interface Filters {
  accounts: number[];
  from: string;
  to: string;
  symbol: string;
  side: string;
  status: string;
  tag: string;
  strategy: string;
}

export const EMPTY_FILTERS: Filters = { accounts: [], from: '', to: '', symbol: '', side: '', status: '', tag: '', strategy: '' };

export function filterQuery(f: Filters, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  if (f.accounts.length) p.set('accounts', f.accounts.join(','));
  for (const key of ['from', 'to', 'symbol', 'side', 'status', 'tag', 'strategy'] as const) if (f[key]) p.set(key, f[key]);
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const FilterContext = createContext<{ filters: Filters; setFilters: (f: Filters) => void }>({ filters: EMPTY_FILTERS, setFilters: () => {} });
export const useFilters = () => useContext(FilterContext);

export interface UiActions {
  openImport: () => void;
  openDay: (date: string) => void;
  openAddTrade: () => void;
  openStartDay: () => void;
}
export const UiContext = createContext<UiActions>({ openImport() {}, openDay() {}, openAddTrade() {}, openStartDay() {} });
export const useUi = () => useContext(UiContext);

export const MOODS = [
  { value: 1, emoji: '😭', label: 'Awful' },
  { value: 2, emoji: '😞', label: 'Bad' },
  { value: 3, emoji: '😐', label: 'Neutral' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😍', label: 'Great' },
];
