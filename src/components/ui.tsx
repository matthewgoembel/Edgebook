import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Info, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, api, EMPTY_FILTERS, useFilters } from '../lib';

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info" title={text}>
      <Info size={14} />
    </span>
  );
}

export function Card({ title, info, right, children, bodyStyle }: { title?: ReactNode; info?: string; right?: ReactNode; children: ReactNode; bodyStyle?: React.CSSProperties }) {
  return (
    <section className="card">
      {title && (
        <div className="card-head">
          <div className="card-title">
            {title} {info && <InfoTip text={info} />}
          </div>
          {right}
        </div>
      )}
      <div className="card-body" style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function Dropdown({ label, children, align = 'right', buttonClass = '', menuClass = '', title }: { label: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; buttonClass?: string; menuClass?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={`btn ${buttonClass}`} title={title} aria-label={title} onClick={() => setOpen((v) => !v)}>
        {label} <ChevronDown size={14} />
      </button>
      {open && (
        <div className={`menu ${menuClass}`} style={align === 'left' ? { left: 0, right: 'auto' } : undefined}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const RANGES: { label: string; days?: number; ytd?: boolean; month?: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 6 },
  { label: 'Last 30 days', days: 29 },
  { label: 'Last 90 days', days: 89 },
  { label: 'This month', month: 0 },
  { label: 'Last month', month: 1 },
  { label: 'Year to date', ytd: true },
];

/** The Filters / Date range / Accounts controls shared by the dashboard, trades and reports pages. */
export function FilterBar() {
  const { filters, setFilters } = useFilters();
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const today: string = meta?.today ?? new Date().toISOString().slice(0, 10);

  const applyRange = (r: (typeof RANGES)[number]) => {
    if (r.days !== undefined) setFilters({ ...filters, from: addDays(today, -r.days), to: today });
    else if (r.ytd) setFilters({ ...filters, from: `${today.slice(0, 4)}-01-01`, to: today });
    else {
      const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - r.month!);
      const first = `${d.toISOString().slice(0, 7)}-01`;
      const next = new Date(`${first}T12:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      setFilters({ ...filters, from: first, to: r.month ? addDays(next.toISOString().slice(0, 10), -1) : today });
    }
  };

  const activeCount = ['symbol', 'side', 'status', 'tag', 'strategy'].filter((k) => filters[k as keyof typeof filters]).length;
  const accountLabel = filters.accounts.length === 0 ? 'All accounts' : filters.accounts.length === 1 ? (meta?.accounts?.find((a: any) => a.id === filters.accounts[0])?.name ?? '1 account') : `${filters.accounts.length} accounts`;

  return (
    <div className="filters">
      <Dropdown label={activeCount ? `Filters (${activeCount})` : 'Filters'}>
        {() => (
          <div style={{ padding: 6, width: 250 }}>
            <FilterSelect label="Symbol" value={filters.symbol} onChange={(symbol) => setFilters({ ...filters, symbol })} options={(meta?.symbols ?? []).map((s: string) => [s, s])} />
            <FilterSelect label="Side" value={filters.side} onChange={(side) => setFilters({ ...filters, side })} options={[['Long', 'Long'], ['Short', 'Short']]} />
            <FilterSelect label="Result" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[['win', 'Win'], ['loss', 'Loss'], ['be', 'Break even']]} />
            <FilterSelect label="Tag" value={filters.tag} onChange={(tag) => setFilters({ ...filters, tag })} options={(meta?.tags ?? []).map((t: any) => [String(t.id), t.name])} />
            <FilterSelect label="Strategy" value={filters.strategy} onChange={(strategy) => setFilters({ ...filters, strategy })} options={(meta?.strategies ?? []).map((s: any) => [String(s.id), s.name])} />
            <button className="btn small" style={{ width: '100%' }} onClick={() => setFilters({ ...EMPTY_FILTERS, accounts: filters.accounts, from: filters.from, to: filters.to })}>
              Clear filters
            </button>
          </div>
        )}
      </Dropdown>

      <Dropdown label={filters.from || filters.to ? `${filters.from || '…'} → ${filters.to || '…'}` : 'Date range'}>
        {(close) => (
          <>
            {RANGES.map((r) => (
              <button key={r.label} className="menu-item" onClick={() => { applyRange(r); close(); }}>
                {r.label}
              </button>
            ))}
            <div style={{ padding: 8 }}>
              <div className="field">
                <label className="label">From</label>
                <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">To</label>
                <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
              </div>
              <button className="btn small" style={{ width: '100%' }} onClick={() => { setFilters({ ...filters, from: '', to: '' }); close(); }}>
                All time
              </button>
            </div>
          </>
        )}
      </Dropdown>

      <Dropdown label={accountLabel}>
        {() => (
          <>
            <button className={`menu-item ${filters.accounts.length === 0 ? 'on' : ''}`} onClick={() => setFilters({ ...filters, accounts: [] })}>
              All accounts
            </button>
            {(meta?.accounts ?? []).map((a: any) => {
              const on = filters.accounts.includes(a.id);
              return (
                <label key={a.id} className="menu-item">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setFilters({ ...filters, accounts: on ? filters.accounts.filter((x) => x !== a.id) : [...filters.accounts, a.id] })}
                  />
                  {a.name}
                </label>
              );
            })}
          </>
        )}
      </Dropdown>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="field" style={{ marginBottom: 10 }}>
      <label className="label">{label}</label>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Modal({ children, size, onClose }: { children: ReactNode; size?: 'small' | 'medium'; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-head">
      <div className="modal-title" style={{ fontSize: 18 }}>
        {title}
      </div>
      <button type="button" className="arrow" onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
    </div>
  );
}

export function StatusPill({ status }: { status: 'win' | 'loss' | 'be' }) {
  return <span className={`status ${status}`}>{status === 'win' ? 'WIN' : status === 'loss' ? 'LOSS' : 'BE'}</span>;
}

/** A small bar showing the result relative to the average win and loss. */
export function ScaleBar({ net, avgWin, avgLoss }: { net: number; avgWin: number; avgLoss: number }) {
  const ref = net >= 0 ? avgWin || 1 : avgLoss || 1;
  const width = Math.min(50, (Math.abs(net) / ref) * 25);
  const color = net >= 0 ? 'var(--green)' : 'var(--red)';
  return (
    <div className="scale" title={`${(Math.abs(net) / ref).toFixed(1)}× your average ${net >= 0 ? 'win' : 'loss'}`}>
      <i style={net >= 0 ? { left: '50%', width: `${width}%`, background: color } : { right: '50%', width: `${width}%`, background: color }} />
    </div>
  );
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}
