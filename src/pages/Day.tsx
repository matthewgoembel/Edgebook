import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EquityArea, PriceChart } from '../components/charts';
import { RichEditor } from '../components/Editor';
import { ScreenshotGrid } from '../components/media';
import { ChecklistEditor, DayStats, MoodPicker } from '../components/modals';
import { Card, Loading, StatusPill } from '../components/ui';
import { api, duration, filterQuery, longDate, money, price, signClass, useFilters } from '../lib';

function MarketCard({ c }: { c: any }) {
  const cell = (k: string, v: string) => (
    <div key={k}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
  const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
  return (
    <div className="market-grid">
      {cell('Day type', c.dayType)}
      {cell('RTH range', `${Math.round(c.range)} pts${c.relativeRange ? ` (${c.relativeRange.toFixed(2)}×)` : ''}`)}
      {cell('Opening gap', c.gap == null ? '—' : `${c.gap > 0 ? '+' : ''}${c.gap.toFixed(1)} pts`)}
      {cell('First hour', c.firstHourDirection)}
      {cell('Open', n(c.open))}
      {cell('High', n(c.high))}
      {cell('Low', n(c.low))}
      {cell('Close', n(c.close))}
      {cell('Overnight high', n(c.overnightHigh))}
      {cell('Overnight low', n(c.overnightLow))}
      {cell('VWAP (close)', n(c.vwap))}
      {cell('Time above VWAP', `${Math.round(c.pctAboveVwap)}%`)}
    </div>
  );
}

export default function DayPage() {
  const { date = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { filters } = useFilters();
  const key = ['day', date, filters.accounts];
  const { data } = useQuery<any>({ queryKey: key, queryFn: () => api(`/day/${date}${filterQuery({ ...filters, from: '', to: '', status: '' })}`) });
  const { data: templates = [] } = useQuery<any[]>({ queryKey: ['templates'], queryFn: () => api('/templates') });
  const [insert, setInsert] = useState<{ html: string; nonce: number } | null>(null);
  const [error, setError] = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: ['day', date] });
  const analyze = useMutation({
    mutationFn: () => api<{ id: number }>('/ai/reports', { method: 'POST', json: { kind: 'daily', from: date, to: date } }),
    onSuccess: ({ id }) => navigate(`/ai?report=${id}`),
    onError: (err) => setError((err as Error).message),
  });

  if (!data) return <Loading />;
  const curve = data.intraday.map((p: any, i: number) => ({ i, cum: p.cum }));
  const latestReport = data.reports.find((r: any) => r.status === 'done');
  const chartTrades = data.trades.map((t: any) => ({ ...t, highlight: true }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link to="/trades">Trades</Link> › Day view</div>
          <h1 className="page-title">
            {longDate(date)} {data.trades.length > 0 && <span className={signClass(data.summary.net)} style={{ fontSize: 20, marginLeft: 8 }}>{money(data.summary.net)}</span>}
          </h1>
        </div>
        <div className="row">
          <button className="btn icon-only" disabled={!data.prev} onClick={() => navigate(`/day/${data.prev}`)} aria-label="Previous trading day"><ChevronLeft size={16} /></button>
          <button className="btn icon-only" disabled={!data.next} onClick={() => navigate(`/day/${data.next}`)} aria-label="Next trading day"><ChevronRight size={16} /></button>
          <button className="btn primary" disabled={analyze.isPending || !data.trades.length} onClick={() => analyze.mutate()}>
            <Sparkles size={15} /> Debrief this day
          </button>
        </div>
      </div>
      {error && <div className="banner bad">{error} {error.includes('Settings') && <Link to="/settings" style={{ textDecoration: 'underline' }}>Open Settings</Link>}</div>}

      <div className="day-layout">
        <div className="stack">
          {data.trades.length > 0 && (
            <Card title="The day">
              <div className="row" style={{ gap: 28, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px', minWidth: 260 }}><EquityArea data={curve} dataKey="cum" xKey="i" height={150} hideX /></div>
                <div style={{ flex: '1 1 400px' }}><DayStats summary={data.summary} /></div>
              </div>
            </Card>
          )}

          <Card title="Chart screenshots" info="The AI reads these. Paste straight from your clipboard: click a box, then press Ctrl+V.">
            <ScreenshotGrid attachments={data.attachments} ownerType="day" ownerKey={date} onChange={() => void refresh()} />
          </Card>

          <Card
            title="Daily journal"
            right={
              <select className="select" style={{ width: 170 }} value="" onChange={(e) => {
                const t = templates.find((x) => String(x.id) === e.target.value);
                if (t) setInsert({ html: t.body_html, nonce: Date.now() });
              }}>
                <option value="">Insert template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            }
          >
            <RichEditor
              key={date}
              html={data.note?.body_html ?? ''}
              uploadKey={`day-${date}`}
              minHeight={220}
              placeholder="What was the plan? What did you see? How did you feel?"
              insertHtml={insert}
              onSave={(body) => api(`/notes/day/${date}`, { method: 'PUT', json: body })}
            />
          </Card>

          {data.market.bars.length > 0 && (
            <Card title="Price action" info={`${data.context?.feed ?? 'NQ=F'} ${data.market.interval} bars. Arrows are entries, dots are exits.`}>
              <PriceChart bars={data.market.bars} trades={chartTrades} height={420} />
            </Card>
          )}

          {data.trades.length > 0 && (
            <section className="card">
              <div className="card-head"><div className="card-title">Trades</div></div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Open time</th><th>Ticker</th><th>Side</th><th className="num">Size</th><th className="num">Entry</th><th className="num">Exit</th><th>Duration</th><th>Status</th><th className="num">Net P&amp;L</th><th>Tags</th></tr>
                  </thead>
                  <tbody>
                    {data.trades.map((t: any) => (
                      <tr key={t.id} className="click" onClick={() => navigate(`/trades/${t.id}`)}>
                        <td>{t.open_time}</td>
                        <td><span className="sym-pill">{t.symbol}</span></td>
                        <td>{t.side.toUpperCase()}</td>
                        <td className="num">{t.qty}</td>
                        <td className="num">{price(t.entry_price)}</td>
                        <td className="num">{price(t.exit_price)}</td>
                        <td>{duration(t.duration_sec)}</td>
                        <td><StatusPill status={t.status} /></td>
                        <td className={`num ${signClass(t.net_pnl)}`}>{money(t.net_pnl)}</td>
                        <td>{t.tags.map((g: any) => g.name).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="stack">
          <Card title="Mood">
            <MoodPicker date={date} mood={data.mood} moodNote={data.mood_note} />
          </Card>
          <Card title="Daily checklist">
            <ChecklistEditor date={date} />
          </Card>
          {data.context && (
            <Card title="Market context" info="Calculated from the bars saved for this day.">
              <MarketCard c={data.context} />
            </Card>
          )}
          {latestReport && (
            <Card title="Latest debrief">
              <p style={{ margin: '0 0 10px', lineHeight: 1.5 }}>{JSON.parse(latestReport.result).headline}</p>
              <Link className="btn small" to={`/ai?report=${latestReport.id}`}>Read the full debrief</Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
