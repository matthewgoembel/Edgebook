import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DailyBars, DrawdownChart, EquityArea } from '../components/charts';
import { Card, FilterBar, Loading } from '../components/ui';
import { api, duration, filterQuery, money, pct, profitFactorLabel, signClass, useFilters } from '../lib';

export function Bars({ rows, unit = 'trades' }: { rows: any[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  return (
    <div>
      <div className="bar-row head"><span /><span /><span className="num">Net</span><span className="num">Win %</span><span className="num">Avg</span></div>
      {rows.map((r) => {
        const w = (Math.abs(r.net) / max) * 50;
        return (
          <div className="bar-row" key={r.label}>
            <span>
              {r.label} <span className="low">({r.n} {unit}{r.lowSample ? ', early' : ''})</span>
            </span>
            <span className="bar-track">
              <i style={r.net >= 0 ? { left: '50%', width: `${w}%`, background: 'var(--green)' } : { right: '50%', width: `${w}%`, background: 'var(--red)' }} />
            </span>
            <span className={`num ${signClass(r.net)}`}>{money(r.net, { cents: false })}</span>
            <span className="num">{r.winRate.toFixed(0)}%</span>
            <span className={`num ${signClass(r.avg)}`}>{money(r.avg, { cents: false })}</span>
          </div>
        );
      })}
    </div>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'time', label: 'Days & times', groups: ['session', 'halfhour', 'weekday', 'hold'] },
  { key: 'instrument', label: 'Instruments', groups: ['symbol', 'side', 'symbolside', 'size'] },
  { key: 'behavior', label: 'Behavior', groups: ['seq', 'after', 'reentry', 'entrytype', 'mood', 'checklist'] },
  { key: 'market', label: 'Market', groups: ['daytype', 'vwap', 'location'] },
  { key: 'tags', label: 'Tags & strategies', groups: ['setup', 'mistake', 'strategy'] },
  { key: 'days', label: 'Good vs bad days' },
];

export default function ReportsPage() {
  const { filters } = useFilters();
  const { data } = useQuery<any>({ queryKey: ['reports', filters], queryFn: () => api(`/reports${filterQuery(filters)}`) });
  const [tab, setTab] = useState('overview');
  const head = (
    <div className="page-head">
      <div>
        <div className="crumb">Analysis</div>
        <h1 className="page-title">Reports</h1>
      </div>
      <FilterBar />
    </div>
  );
  if (!data) return <>{head}<Loading /></>;
  const s = data.summary;
  const b = data.behavior;
  const kv = (k: string, v: React.ReactNode) => <div className="kv" key={k}><span>{k}</span><span>{v}</span></div>;
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <>
      {head}
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="linetabs" style={{ flexWrap: 'wrap' }}>
          {TABS.map((t) => <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>
      </section>

      {tab === 'overview' && (
        <div className="stack">
          <Card title="Your stats">
            <div className="kpi-table">
              <div>
                {kv('Net P&L', <span className={signClass(s.net)}>{money(s.net)}</span>)}
                {kv('Gross P&L', money(s.gross))}
                {kv('Fees + commissions', money(s.costs))}
                {kv('Profit factor', profitFactorLabel(s.profitFactor))}
                {kv('Win rate', pct(s.winRate))}
                {kv('Expectancy per trade', money(s.expectancy))}
                {kv('Average win', money(s.avgWin))}
                {kv('Average loss', money(-s.avgLoss))}
                {kv('Largest win', money(s.largestWin))}
                {kv('Largest loss', money(s.largestLoss))}
                {kv('Total trades', s.count)}
                {kv('Wins / losses / break even', `${s.wins} / ${s.losses} / ${s.breakevens}`)}
              </div>
              <div>
                {kv('Trading days', s.days)}
                {kv('Green / red days', `${s.dayWins} / ${s.dayLosses}`)}
                {kv('Day win rate', pct(s.dayWinRate))}
                {kv('Average day', money(s.avgDayNet))}
                {kv('Best day', s.bestDay ? `${money(s.bestDay.net)} (${s.bestDay.date})` : '—')}
                {kv('Worst day', s.worstDay ? `${money(s.worstDay.net)} (${s.worstDay.date})` : '—')}
                {kv('Longest win streak', `${s.maxWinStreak} trades / ${s.maxDayWinStreak} days`)}
                {kv('Longest loss streak', `${s.maxLossStreak} trades / ${s.maxDayLossStreak} days`)}
                {kv('Average hold', duration(s.avgHold))}
                {kv('Hold on winners', duration(s.avgHoldWin))}
                {kv('Hold on losers', duration(s.avgHoldLoss))}
                {kv('Long / short net', `${money(s.longNet, { cents: false })} / ${money(s.shortNet, { cents: false })}`)}
              </div>
            </div>
          </Card>
          <div className="grid-2">
            <Card title="Cumulative P&L"><EquityArea data={data.days} dataKey="cum" xKey="date" height={260} xFormat={(d: string) => d.slice(5)} /></Card>
            <Card title="Net daily P&L"><DailyBars data={data.days} height={260} /></Card>
          </div>
          <Card title="Drawdown"><DrawdownChart data={data.days} height={230} /></Card>
        </div>
      )}

      {tab === 'behavior' && (
        <div className="stack" style={{ marginBottom: 16 }}>
          <Card title="Habits" info="Based on merged positions, so one 5-lot split into three CSV rows counts once.">
            <div className="kpi-table">
              <div>
                {kv('Positions', `${b.positions} (${b.rawFillsMerged} partial-fill rows merged)`)}
                {kv('Quick re-entries after a loss (under 5 min)', b.revengeCount)}
                {kv('Net from those re-entries', <span className={signClass(b.revengeNet)}>{money(b.revengeNet)}</span>)}
                {kv('Sized up after a loss', b.sizedUpAfterLoss)}
                {kv('Net from sizing up after a loss', <span className={signClass(b.sizedUpAfterLossNet)}>{money(b.sizedUpAfterLossNet)}</span>)}
              </div>
              <div>
                {kv('Average hold, winners', `${b.avgHoldWinnerMin.toFixed(1)} min`)}
                {kv('Average hold, losers', `${b.avgHoldLoserMin.toFixed(1)} min`)}
                {kv('Green-to-red days (up $200+, closed red)', b.greenToRedDays)}
                {kv('Given back from daily peak', money(b.givenBackFromPeak))}
                {kv('Move captured on winners', b.avgMfeCaptured == null ? 'Needs price data' : `${b.avgMfeCaptured.toFixed(0)}%`)}
              </div>
            </div>
          </Card>
        </div>
      )}

      {active.groups && (
        <div className="stack">
          {active.groups.flatMap((key) => data.groups.filter((g: any) => g.key === key)).map((g: any) => (
            <Card title={g.title} key={g.key}><Bars rows={g.rows} unit="positions" /></Card>
          ))}
          {active.groups.every((key) => !data.groups.some((g: any) => g.key === key)) && (
            <div className="card empty">
              <h3>Nothing here yet</h3>
              {tab === 'tags' ? 'Tag setups and mistakes on your trades to see them compared here.' : 'This fills in as you upload trades and journal.'}
            </div>
          )}
        </div>
      )}

      {tab === 'days' && (
        <div className="stack">
          {data.dayGroups.map((g: any) => <Card title={g.title} key={g.key}><Bars rows={g.rows} unit="days" /></Card>)}
        </div>
      )}
    </>
  );
}
