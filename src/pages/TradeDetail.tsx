import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Star, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PriceChart } from '../components/charts';
import { RichEditor } from '../components/Editor';
import { ScreenshotGrid } from '../components/media';
import { Card, Loading, StatusPill } from '../components/ui';
import { api, duration, longDate, money, price, signClass } from '../lib';

function TagPicker({ category, label, trade, tags, onChange }: { category: string; label: string; trade: any; tags: any[]; onChange: (ids: number[]) => void }) {
  const [value, setValue] = useState('');
  const qc = useQueryClient();
  const mine = trade.tags.filter((t: any) => t.category === category);
  const ids = trade.tags.map((t: any) => t.id);
  const add = async (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const tag = await api('/tags', { method: 'POST', json: { name: clean, category } });
    await qc.invalidateQueries({ queryKey: ['meta'] });
    setValue('');
    onChange([...new Set([...ids, tag.id])]);
  };
  const listId = `tags-${category}`;
  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="tag-row" style={{ marginBottom: 6 }}>
        {mine.map((t: any) => (
          <span className={`tag ${category}`} key={t.id}>
            {t.name}
            <button onClick={() => onChange(ids.filter((i: number) => i !== t.id))} aria-label={`Remove ${t.name}`}><X size={12} /></button>
          </span>
        ))}
      </div>
      <input
        className="input"
        list={listId}
        placeholder={`Add ${label.toLowerCase()}…`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void add(value); }}
        onBlur={() => void add(value)}
      />
      <datalist id={listId}>
        {tags.filter((t) => t.category === category).map((t) => <option key={t.id} value={t.name} />)}
      </datalist>
    </div>
  );
}

export default function TradeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ['trade', id], queryFn: () => api(`/trades/${id}`) });
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });

  const chartTrades = useMemo(
    () => (data?.siblings ?? []).map((s: any) => ({ ...s, highlight: s.id === data.trade.id })),
    [data, id],
  );
  const focus = useMemo<[number, number] | undefined>(() => (data ? [data.trade.entered_ts, data.trade.exited_ts] : undefined), [data]);

  if (!data || !meta) return <Loading />;
  const t = data.trade;
  const points = t.side === 'Long' ? t.exit_price - t.entry_price : t.entry_price - t.exit_price;
  const patch = async (json: Record<string, unknown>) => {
    await api(`/trades/${id}`, { method: 'PATCH', json });
    await qc.invalidateQueries({ queryKey: ['trade', id] });
  };
  const kv = (k: string, v: React.ReactNode) => (
    <div className="kv" key={k}><span>{k}</span><span>{v}</span></div>
  );
  const entry = data.market.entry;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link to={`/day/${t.date}`}>{longDate(t.date)}</Link> › Trade {data.tradeNumber} of {data.tradesThatDay}</div>
          <h1 className="page-title">{t.symbol} {t.side}</h1>
        </div>
        <div className="row">
          <button className="btn icon-only" disabled={!data.prevId} onClick={() => navigate(`/trades/${data.prevId}`)} aria-label="Previous trade"><ChevronLeft size={16} /></button>
          <button className="btn icon-only" disabled={!data.nextId} onClick={() => navigate(`/trades/${data.nextId}`)} aria-label="Next trade"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="trade-layout">
        <div className="stack">
          <Card>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="hint">Net P&amp;L</span>
              <StatusPill status={t.status} />
            </div>
            <div className={`big-net ${signClass(t.net_pnl)}`}>{money(t.net_pnl)}</div>
            <div style={{ marginTop: 10 }}>
              {kv('Side', t.side.toUpperCase())}
              {kv('Contract', t.contract)}
              {kv('Contracts', t.qty)}
              {kv('Entry', price(t.entry_price))}
              {kv('Exit', price(t.exit_price))}
              {kv('Points', `${points >= 0 ? '+' : ''}${points.toFixed(2)}`)}
              {kv('Gross P&L', money(t.gross_pnl))}
              {kv('Fees + commissions', money(t.fees + t.commissions))}
              {kv('Net ROI', `${t.net_roi.toFixed(2)}%`)}
              {kv('Opened', `${t.date} ${t.open_time}`)}
              {kv('Closed', `${t.close_date} ${t.close_time}`)}
              {kv('Duration', duration(t.duration_sec))}
              {t.entry_type && kv('Entry / exit order', `${t.entry_type} / ${t.exit_type}`)}
              {t.stop_price != null && kv('Original stop', price(t.stop_price))}
              {entry?.mfePoints != null && kv('Best price reached', `+${entry.mfePoints.toFixed(2)} pts`)}
              {entry?.maePoints != null && kv('Worst price reached', `-${entry.maePoints.toFixed(2)} pts`)}
              {entry?.withVwap != null && kv('Entry vs VWAP', entry.withVwap ? 'With' : 'Against')}
            </div>
          </Card>

          <Card title="Review">
            <div className="field">
              <label className="label">Strategy</label>
              <select className="select" value={t.strategy_id ?? ''} onChange={(e) => void patch({ strategy_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None</option>
                {meta.strategies.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Planned risk ($){t.copies > 1 ? ' for one account' : ''}, for R-multiple</label>
              <input key={data.ownRisk} className="input" type="number" defaultValue={data.ownRisk ?? ''} onBlur={(e) => void patch({ risk_amount: e.target.value })} />
              {t.r_multiple != null && <div className="hint" style={{ marginTop: 4 }}>Realized {t.r_multiple.toFixed(2)}R</div>}
            </div>
            <TagPicker category="setup" label="Setups" trade={t} tags={meta.tags} onChange={(tag_ids) => void patch({ tag_ids })} />
            <TagPicker category="mistake" label="Mistakes" trade={t} tags={meta.tags} onChange={(tag_ids) => void patch({ tag_ids })} />
            <TagPicker category="custom" label="Tags" trade={t} tags={meta.tags} onChange={(tag_ids) => void patch({ tag_ids })} />
            <label className="label">Execution rating</label>
            <div className="row" style={{ gap: 2 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className="arrow" onClick={() => void patch({ rating: t.rating === n ? null : n })} aria-label={`${n} star${n > 1 ? 's' : ''}`}>
                  <Star size={19} fill={t.rating >= n ? '#e5a93c' : 'none'} color={t.rating >= n ? '#e5a93c' : '#bbb'} />
                </button>
              ))}
            </div>
          </Card>

          {data.accounts.length > 0 && (
            <Card title={`Taken in ${data.accounts.length} accounts`}>
              {data.accounts.map((a: any) => (
                <div className="kv" key={a.id}>
                  <span>{a.name} × {a.qty}</span>
                  <span className={signClass(a.net)}>{money(a.net)}</span>
                </div>
              ))}
            </Card>
          )}

          {t.insights.length > 0 && (
            <Card title="Insights">
              {t.insights.map((f: string) => <div className="flag" key={f}><AlertTriangle size={15} style={{ flex: 'none', marginTop: 1 }} /> {f}</div>)}
            </Card>
          )}
        </div>

        <div className="stack">
          {data.market.bars.length > 0 ? (
            <Card title="Price action" info={`NQ=F ${data.market.interval} bars from a free feed. This trade is labeled; your other trades that day are faded.`}>
              <PriceChart bars={data.market.bars} trades={chartTrades} height={440} focus={focus} />
            </Card>
          ) : (
            <Card title="Price action">
              <div className="hint">No bars saved for this date. The free feed keeps 1-minute data for about a month and 5-minute data for about 60 days, so uploading daily keeps every day charted.</div>
            </Card>
          )}
          <Card title="Trade notes">
            <RichEditor
              key={id}
              html={data.note?.body_html ?? ''}
              uploadKey={`trade-${id}`}
              placeholder="Why did you take this? Where was your invalidation?"
              onSave={(body) => api(`/notes/trade/${data.noteTradeId}`, { method: 'PUT', json: body })}
            />
          </Card>
          <Card title="Screenshots">
            <ScreenshotGrid attachments={data.attachments} ownerType="trade" ownerKey={id} onChange={() => void qc.invalidateQueries({ queryKey: ['trade', id] })} />
          </Card>
        </div>
      </div>
    </>
  );
}
