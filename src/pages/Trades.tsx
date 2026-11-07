import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Columns3, Plus, Sunrise } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Donut, EquityArea, Gauge } from '../components/charts';
import { DayStats } from '../components/modals';
import { CopyBadge, Dropdown, FilterBar, Loading, ScaleBar, StatusPill } from '../components/ui';
import { api, duration, filterQuery, longDate, money, moneyShort, pct, price, profitFactorLabel, signClass, useFilters, useUi, usDate } from '../lib';

const COLUMNS: { key: string; label: string; sort?: string; on?: boolean; num?: boolean; render: (t: any, s: any) => React.ReactNode }[] = [
  { key: 'open', label: 'Open date', sort: 'entered_ts', on: true, render: (t) => usDate(t.date) },
  { key: 'time', label: 'Open time', sort: 'entered_ts', render: (t) => t.open_time },
  { key: 'symbol', label: 'Symbol', sort: 'symbol', on: true, render: (t) => <><b style={{ fontWeight: 500 }}>{t.symbol}</b><CopyBadge copies={t.copies} /></> },
  { key: 'status', label: 'Status', on: true, render: (t) => <StatusPill status={t.status} /> },
  { key: 'side', label: 'Side', sort: 'side', render: (t) => t.side },
  { key: 'qty', label: 'Size', sort: 'qty', num: true, render: (t) => t.qty },
  { key: 'close', label: 'Close date', sort: 'exited_ts', on: true, render: (t) => usDate(t.close_date) },
  { key: 'entry', label: 'Entry price', sort: 'entry_price', on: true, render: (t) => price(t.entry_price) },
  { key: 'exit', label: 'Exit price', sort: 'exit_price', on: true, render: (t) => price(t.exit_price) },
  { key: 'duration', label: 'Duration', sort: 'duration_sec', render: (t) => duration(t.duration_sec) },
  { key: 'net', label: 'Net P&L', sort: 'net_pnl', on: true, num: true, render: (t) => <span className={signClass(t.net_pnl)}>{money(t.net_pnl)}</span> },
  { key: 'roi', label: 'Net ROI', sort: 'net_roi', on: true, num: true, render: (t) => <span className={signClass(t.net_roi)}>{t.net_roi.toFixed(2)}%</span> },
  { key: 'r', label: 'Realized R', sort: 'r_multiple', num: true, render: (t) => (t.r_multiple == null ? '—' : `${t.r_multiple.toFixed(2)}R`) },
  { key: 'costs', label: 'Fees', num: true, render: (t) => money(t.fees + t.commissions) },
  { key: 'tags', label: 'Tags', render: (t) => t.tags.map((g: any) => g.name).join(', ') || '—' },
  { key: 'insights', label: 'Insights', on: true, num: true, render: (t) => <span title={t.insights.join('\n')}>{t.insights.length} •</span> },
  { key: 'scale', label: 'Scale', on: true, render: (t, s) => <ScaleBar net={t.net_pnl} avgWin={s.avgWin} avgLoss={s.avgLoss} /> },
];

function TopStats({ s, days }: { s: any; days: any[] }) {
  return (
    <div className="grid-4" style={{ margin: '14px 0' }}>
      <div className="card stat-card">
        <div className="grow">
          <div className="stat-label">Equity curve <span className="count-pill">{s.count}</span></div>
          <div className="stat-value">{money(s.net)}</div>
          <EquityArea data={days} dataKey="cum" xKey="date" height={54} showAxis={false} />
        </div>
      </div>
      <div className="card stat-card">
        <div>
          <div className="stat-label">Profit factor</div>
          <div className="stat-value">{profitFactorLabel(s.profitFactor)}</div>
        </div>
        <Donut win={s.grossWin} loss={s.grossLoss} />
      </div>
      <div className="card stat-card">
        <div>
          <div className="stat-label">Win rate</div>
          <div className="stat-value">{pct(s.winRate)}</div>
        </div>
        <Gauge value={s.winRate} wins={s.wins} be={s.breakevens} losses={s.losses} />
      </div>
      <div className="card stat-card" style={{ display: 'block' }}>
        <div className="stat-label">Win/loss ratio</div>
        <div className="row" style={{ gap: 18 }}>
          <div className="stat-value">{s.avgWinLoss.toFixed(2)}</div>
          <div className="grow">
            <div className="split-bar"><i style={{ width: `${(s.avgWin / (s.avgWin + s.avgLoss || 1)) * 100}%` }} /></div>
            <div className="split-labels"><span className="pos">{moneyShort(s.avgWin)}</span><span className="neg">-{moneyShort(s.avgLoss)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function periodCards(data: any, mode: 'Day' | 'Week') {
  const days: any[] = data.days;
  if (mode === 'Day') return [...days].reverse().map((d) => ({ key: d.date, title: longDate(d.date), date: d.date, ...d }));
  const weeks = new Map<string, any[]>();
  for (const d of days) {
    const dt = new Date(`${d.date}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
    const key = dt.toISOString().slice(0, 10);
    (weeks.get(key) ?? weeks.set(key, []).get(key)!).push(d);
  }
  return [...weeks.entries()].reverse().map(([key, rows]) => {
    const wins = rows.reduce((a, r) => a + r.wins, 0);
    const losses = rows.reduce((a, r) => a + r.losses, 0);
    return {
      key,
      title: `Week of ${longDate(key)}`,
      date: null,
      net: rows.reduce((a, r) => a + r.net, 0),
      gross: rows.reduce((a, r) => a + r.gross, 0),
      costs: rows.reduce((a, r) => a + r.costs, 0),
      trades: rows.reduce((a, r) => a + r.trades, 0),
      volume: rows.reduce((a, r) => a + r.volume, 0),
      wins,
      losses,
      winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
      breakevens: rows.reduce((a, r) => a + r.breakevens, 0),
      profitFactor: null,
      rows,
    };
  });
}

function PeriodList({ data, mode }: { data: any; mode: 'Day' | 'Week' }) {
  const navigate = useNavigate();
  const { openDay } = useUi();
  const cards = useMemo(() => periodCards(data, mode), [data, mode]);
  if (!cards.length) return <div className="card empty">No trades match these filters.</div>;
  return (
    <div className="stack">
      {cards.map((c: any) => (
        <section className="card" key={c.key}>
          <div className="card-head">
            <div className="row" style={{ gap: 14 }}>
              <b style={{ fontWeight: 500 }}>{c.title}</b>
              <span className={signClass(c.net)} style={{ fontWeight: 500 }}>Net P&amp;L {money(c.net)}</span>
            </div>
            {c.date ? (
              <div className="row">
                <button className="btn small" onClick={() => openDay(c.date)}>Quick view</button>
                <button className="btn small primary" onClick={() => navigate(`/day/${c.date}`)}>Open day <ChevronRight size={14} /></button>
              </div>
            ) : null}
          </div>
          <div className="card-body">
            <DayStats
              summary={{ count: c.trades, gross: c.gross, wins: c.wins, losses: c.losses, costs: c.costs, winRate: c.winRate, volume: c.volume, profitFactor: c.profitFactor, avgHold: 0 }}
            />
            {c.rows && (
              <div className="tag-row" style={{ marginTop: 14 }}>
                {c.rows.map((d: any) => (
                  <button key={d.date} className="btn small" onClick={() => navigate(`/day/${d.date}`)}>
                    {d.date.slice(5)} <span className={signClass(d.net)}>{moneyShort(d.net)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function TradesPage() {
  const { filters } = useFilters();
  const { openAddTrade, openStartDay } = useUi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'Day' | 'Week' | 'All'>('All');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'entered_ts', dir: 'desc' });
  const [showStats, setShowStats] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [visible, setVisible] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('tradeColumns') ?? '') as string[];
    } catch {
      return COLUMNS.filter((c) => c.on).map((c) => c.key);
    }
  });
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const { data } = useQuery<any>({
    queryKey: ['trades', filters, page, sort],
    queryFn: () => api(`/trades${filterQuery(filters, { page, size: 50, sort: sort.key, dir: sort.dir })}`),
    placeholderData: (prev: any) => prev,
  });

  const cols = COLUMNS.filter((c) => visible.includes(c.key));
  const toggleColumn = (key: string) => {
    const next = visible.includes(key) ? visible.filter((k) => k !== key) : COLUMNS.map((c) => c.key).filter((k) => k === key || visible.includes(k));
    setVisible(next);
    localStorage.setItem('tradeColumns', JSON.stringify(next));
  };
  const clickSort = (key?: string) => {
    if (!key) return;
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
    setPage(1);
  };
  const bulk = async (json: Record<string, unknown>) => {
    await api('/trades/bulk', { method: 'POST', json: { ids: selected, ...json } });
    setSelected([]);
    await qc.invalidateQueries();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Tracking</div>
          <h1 className="page-title">Trades</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={openStartDay}><Sunrise size={15} /> Daily prep</button>
          <button className="btn primary" onClick={openAddTrade}><Plus size={15} /> Add trade</button>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="tabs">
          {(['Day', 'Week', 'All'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m}</button>
          ))}
        </div>
        <div className="filters">
          <Dropdown label={<Columns3 size={15} />}>
            {() => COLUMNS.map((c) => (
              <label className="menu-item" key={c.key}>
                <input type="checkbox" checked={visible.includes(c.key)} onChange={() => toggleColumn(c.key)} /> {c.label}
              </label>
            ))}
          </Dropdown>
          <button className="btn" onClick={() => setShowStats((v) => !v)}>
            <ChevronDown size={14} style={{ transform: showStats ? 'rotate(180deg)' : undefined }} /> {showStats ? 'Hide stats' : 'Show stats'}
          </button>
          <FilterBar />
        </div>
      </div>

      {!data ? <Loading /> : (
        <>
          {showStats && <TopStats s={data.summary} days={data.days} />}
          {mode !== 'All' ? (
            <div style={{ marginTop: 14 }}><PeriodList data={data} mode={mode} /></div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'flex-end', margin: '12px 0' }}>
                <Dropdown label={selected.length ? `Bulk actions (${selected.length})` : 'Bulk actions'}>
                  {(close) => selected.length === 0 ? (
                    <div className="hint" style={{ padding: 8 }}>Tick some trades first.</div>
                  ) : (
                    <>
                      <div className="hint" style={{ padding: '4px 10px' }}>Add tag</div>
                      {(meta?.tags ?? []).map((t: any) => (
                        <button key={t.id} className="menu-item" onClick={() => { void bulk({ action: 'tag', tag_id: t.id }); close(); }}>{t.name}</button>
                      ))}
                      <div className="hint" style={{ padding: '4px 10px' }}>Set strategy</div>
                      {(meta?.strategies ?? []).map((t: any) => (
                        <button key={t.id} className="menu-item" onClick={() => { void bulk({ action: 'strategy', strategy_id: t.id }); close(); }}>{t.name}</button>
                      ))}
                      <button
                        className="menu-item"
                        style={{ color: 'var(--red-dark)' }}
                        onClick={() => {
                          if (confirm(`Delete ${selected.length} trade(s)? This also deletes their notes.`)) void bulk({ action: 'delete' });
                          close();
                        }}
                      >
                        Delete selected
                      </button>
                    </>
                  )}
                </Dropdown>
              </div>
              <section className="card">
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="Select all on this page"
                            checked={data.trades.length > 0 && data.trades.every((t: any) => selected.includes(t.id))}
                            onChange={(e) => setSelected(e.target.checked ? data.trades.map((t: any) => t.id) : [])}
                          />
                        </th>
                        {cols.map((c) => (
                          <th key={c.key} className={`${c.sort ? 'sortable' : ''} ${c.num ? 'num' : ''}`} onClick={() => clickSort(c.sort)}>
                            {c.label}{sort.key === c.sort ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.trades.map((t: any) => (
                        <tr key={t.id} className="click" onClick={() => navigate(`/trades/${t.id}`)}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label="Select trade"
                              checked={selected.includes(t.id)}
                              onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))}
                            />
                          </td>
                          {cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(t, data.summary)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.trades.length === 0 && <div className="empty">No trades match these filters.</div>}
                </div>
                <div className="pager">
                  <span>{data.total} trades</span>
                  <div className="row">
                    <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                    <span>Page {page} of {Math.max(1, Math.ceil(data.total / data.size))}</span>
                    <button className="btn small" disabled={page * data.size >= data.total} onClick={() => setPage(page + 1)}>Next</button>
                  </div>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
