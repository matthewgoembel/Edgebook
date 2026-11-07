import { useQuery } from '@tanstack/react-query';
import { Sunrise, UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PnlCalendar } from '../components/Calendar';
import { BalanceChart, DailyBars, DrawdownChart, Donut, EdgeRadar, EquityArea, Gauge, PerformanceScatter } from '../components/charts';
import { Card, FilterBar, InfoTip, Loading } from '../components/ui';
import { api, filterQuery, money, moneyShort, pct, profitFactorLabel, signClass, useFilters, useUi, usDate } from '../lib';

function ProgressTracker({ progress, onChecklist }: { progress: any; onChecklist: () => void }) {
  const cells: { date: string; level: number }[] = progress.cells;
  const first = cells[0].date;
  const pad = new Date(`${first}T12:00:00Z`).getUTCDay();
  const weeks: ({ date: string; level: number } | null)[][] = [];
  const all = [...Array(pad).fill(null), ...cells];
  for (let i = 0; i < all.length; i += 7) weeks.push(all.slice(i, i + 7));
  const months = weeks.map((w, i) => {
    const d = w.find(Boolean);
    if (!d) return '';
    const month = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    const prev = weeks[i - 1]?.find(Boolean);
    const prevMonth = prev && new Date(`${prev.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    return month !== prevMonth ? month : '';
  });
  return (
    <>
      <div className="heat">
        <div className="heat-days">
          <span />
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <span key={d}>{d}</span>)}
        </div>
        {weeks.map((w, i) => (
          <div className="heat-col" key={i}>
            <div className="heat-month">{months[i]}</div>
            {Array.from({ length: 7 }, (_, d) => {
              const c = w[d];
              return c ? <div key={d} className={`heat-cell l${c.level}`} title={c.date} /> : <div key={d} className="heat-cell" style={{ visibility: 'hidden' }} />;
            })}
          </div>
        ))}
      </div>
      <div className="heat-legend">
        Less
        <i style={{ background: 'var(--heat-1)', marginLeft: 6 }} />
        <i style={{ background: 'var(--heat-2)' }} />
        <i style={{ background: 'var(--heat-3)' }} />
        <i style={{ background: 'var(--heat-4)', marginRight: 6 }} />
        More
      </div>
      <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
        <div>
          <div className="hint">Today&apos;s score</div>
          <div style={{ fontSize: 21, fontWeight: 500 }}>{progress.todayDone}/{progress.todayTotal}</div>
        </div>
        <button className="btn" onClick={onChecklist}>Daily checklist</button>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { filters } = useFilters();
  const { openImport, openStartDay } = useUi();
  const navigate = useNavigate();
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const { data } = useQuery<any>({ queryKey: ['dashboard', filters], queryFn: () => api(`/dashboard${filterQuery(filters)}`) });
  const [tab, setTab] = useState<'time' | 'duration'>('time');

  const header = (
    <div className="page-head">
      <div>
        <div className="crumb">Tracking</div>
        <h1 className="page-title">Dashboard</h1>
      </div>
      <FilterBar />
    </div>
  );

  if (!data || !meta) return <>{header}<Loading /></>;

  const s = data.summary;
  const lastImport = meta.lastImport
    ? new Date(`${meta.lastImport.replace(' ', 'T')}Z`).toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Never';

  if (!meta.lastImport && s.count === 0) {
    return (
      <>
        {header}
        <section className="card">
          <div className="empty" style={{ padding: 70 }}>
            <UploadCloud size={36} color="var(--primary)" />
            <h3 style={{ marginTop: 12 }}>Upload your first Topstep export</h3>
            <p>Everything on this page fills in from your CSV.</p>
            <button className="btn primary" onClick={openImport}>Upload trades</button>
          </div>
        </section>
      </>
    );
  }

  const decided = s.wins + s.losses;
  return (
    <>
      {header}
      <div className="subhead">
        <span>
          <b>Last import:</b> {lastImport}{' '}
          <a style={{ textDecoration: 'underline', marginLeft: 8, cursor: 'pointer' }} onClick={openImport}>Upload</a>
        </span>
        <button className="btn primary" onClick={openStartDay}><Sunrise size={15} /> Daily prep</button>
      </div>

      <div className="grid-5">
        <div className="card stat-card">
          <div>
            <div className="stat-label">
              Net P&amp;L <InfoTip text="Total after fees and commissions" /> <span className="count-pill">{s.count}</span>
            </div>
            <div className={`stat-value ${signClass(s.net)}`}>{money(s.net)}</div>
          </div>
        </div>
        <div className="card stat-card">
          <div>
            <div className="stat-label">Win rate <InfoTip text="Winners ÷ (winners + losers). Break-even trades don't count." /></div>
            <div className="stat-value">{pct(s.winRate)}</div>
          </div>
          <Gauge value={s.winRate} wins={s.wins} be={s.breakevens} losses={s.losses} />
        </div>
        <div className="card stat-card">
          <div>
            <div className="stat-label">Profit factor <InfoTip text="Gross wins ÷ gross losses" /></div>
            <div className="stat-value">{profitFactorLabel(s.profitFactor)}</div>
          </div>
          <Donut win={s.grossWin} loss={s.grossLoss} />
        </div>
        <div className="card stat-card">
          <div>
            <div className="stat-label">Green days <InfoTip text="Green days ÷ (green + red days)" /></div>
            <div className="stat-value">{pct(s.dayWinRate)}</div>
          </div>
          <Gauge value={s.dayWinRate} wins={s.dayWins} be={s.dayBreakevens} losses={s.dayLosses} />
        </div>
        <div className="card stat-card" style={{ display: 'block' }}>
          <div className="stat-label">Win/loss ratio <InfoTip text="Average winner ÷ average loser" /></div>
          <div className="row" style={{ gap: 18 }}>
            <div className="stat-value">{s.avgWinLoss.toFixed(2)}</div>
            <div className="grow">
              <div className="split-bar"><i style={{ width: `${(s.avgWin / (s.avgWin + s.avgLoss || 1)) * 100}%` }} /></div>
              <div className="split-labels">
                <span className="pos">{moneyShort(s.avgWin)}</span>
                <span className="neg">-{moneyShort(s.avgLoss)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-3">
        <Card title="Edge score" info="A 0-100 blend of win rate, profit factor, average win/loss, recovery factor, drawdown and consistency.">
          <EdgeRadar parts={data.edge.parts} />
          <div className="score-foot">
            <div>
              <div className="hint">Your Edge Score</div>
              <div className="score-num">{data.edge.score.toFixed(2)}</div>
            </div>
            <div className="grow">
              <div className="score-bar"><span className="score-dot" style={{ left: `${data.edge.score}%` }} /></div>
              <div className="score-axis">{[0, 20, 40, 60, 80, 100].map((n) => <span key={n}>{n}</span>)}</div>
            </div>
          </div>
        </Card>
        <Card title="Discipline tracker" info="Darker days are days you journaled and finished your checklist.">
          <ProgressTracker progress={data.progress} onChecklist={openStartDay} />
        </Card>
        <Card title="Equity curve" info="Running total of net P&L by day">
          <EquityArea data={data.days} dataKey="cum" xKey="date" height={330} xFormat={(d: string) => usDate(d).replace(/\/20(\d\d)$/, '/$1')} />
        </Card>
      </div>

      <div className="grid-3">
        <Card title="Daily P&L" info="Net result of each day">
          <DailyBars data={data.days} height={280} />
        </Card>
        <section className="card">
          <div className="linetabs"><button className="on">Recent trades</button></div>
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="data">
              <thead><tr><th>Close date</th><th>Symbol</th><th className="num">Net P&amp;L</th></tr></thead>
              <tbody>
                {data.recent.map((t: any) => (
                  <tr key={t.id} className="click" onClick={() => navigate(`/trades/${t.id}`)}>
                    <td>{usDate(t.close_date)}</td>
                    <td>{t.symbol}</td>
                    <td className={`num ${signClass(t.net_pnl)}`}>{money(t.net_pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <Card title="Account balance" info="Starting balances, plus net P&L, plus deposits and withdrawals">
          <BalanceChart data={data.balance} height={280} />
        </Card>
      </div>

      <div className="cal-grid">
        <PnlCalendar days={data.days} today={meta.today} beThreshold={meta.settings.be_threshold} />
        <div className="stack">
          <Card title="Drawdown" info="How far below your running high each day closed">
            <DrawdownChart data={data.days} height={290} />
          </Card>
          <Card
            title={tab === 'time' ? 'Results by time of day' : 'Results by hold time'}
            right={
              <div className="tabs">
                <button className={tab === 'time' ? 'on' : ''} onClick={() => setTab('time')}>Time</button>
                <button className={tab === 'duration' ? 'on' : ''} onClick={() => setTab('duration')}>Duration</button>
              </div>
            }
          >
            <PerformanceScatter data={data.scatter} x={tab === 'time' ? 'minutes' : 'duration'} height={300} />
          </Card>
        </div>
      </div>
    </>
  );
}
