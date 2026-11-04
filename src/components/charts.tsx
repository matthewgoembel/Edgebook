import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { duration, money, moneyShort } from '../lib';

const axis = { fontSize: 11.5, fill: '#616161' };
const grid = '#eeeeee';
const shortDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(2, 4)}`;

function MoneyTip({ active, payload, label, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }}>
      <div style={{ color: '#616161', marginBottom: 2 }}>{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ fontWeight: 500 }}>
          {money(p.value)}
        </div>
      ))}
    </div>
  );
}

/** Two-tone area: green above zero, red below. */
function gradientOffset(values: number[]) {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

export function EquityArea({ data, dataKey, xKey, height = 260, xFormat, showAxis = true, hideX = false }: { data: any[]; dataKey: string; xKey: string; height?: number; xFormat?: (v: any) => string; showAxis?: boolean; hideX?: boolean }) {
  const off = useMemo(() => gradientOffset(data.map((d) => d[dataKey])), [data, dataKey]);
  const id = useMemo(() => `eq${Math.random().toString(36).slice(2)}`, []);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: showAxis ? 4 : 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ebf94" stopOpacity={0.75} />
            <stop offset={off} stopColor="#4ebf94" stopOpacity={0.04} />
            <stop offset={off} stopColor="#f06363" stopOpacity={0.04} />
            <stop offset="100%" stopColor="#f06363" stopOpacity={0.75} />
          </linearGradient>
        </defs>
        {showAxis && <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />}
        <XAxis dataKey={xKey} hide={!showAxis || hideX} tick={axis} tickFormatter={xFormat} tickLine={false} axisLine={false} minTickGap={50} />
        <YAxis hide={!showAxis} tick={axis} tickFormatter={(v) => moneyShort(v)} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<MoneyTip labelFmt={xFormat} />} />
        <Area type="monotone" dataKey={dataKey} stroke="#6853b5" strokeWidth={1.6} fill={`url(#${id})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DailyBars({ data, height = 260 }: { data: { date: string; net: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={axis} tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={50} />
        <YAxis tick={axis} tickFormatter={(v) => moneyShort(v)} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<MoneyTip labelFmt={shortDate} />} cursor={{ fill: 'rgba(104,83,181,0.06)' }} />
        <ReferenceLine y={0} stroke="#c9c9c9" />
        <Bar dataKey="net" isAnimationActive={false} maxBarSize={14}>
          {data.map((d) => (
            <Cell key={d.date} fill={d.net >= 0 ? '#4ebf94' : '#f06363'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DrawdownChart({ data, height = 290 }: { data: { date: string; drawdown: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f06363" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#f06363" stopOpacity={0.5} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={axis} tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={50} />
        <YAxis tick={axis} tickFormatter={(v) => moneyShort(v)} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<MoneyTip labelFmt={shortDate} />} />
        <Area type="monotone" dataKey="drawdown" stroke="#6853b5" strokeWidth={1.6} fill="url(#ddFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BalanceChart({ data, height = 260 }: { data: { date: string; balance: number; flow: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={axis} tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={50} />
        <YAxis tick={axis} tickFormatter={(v) => moneyShort(v)} tickLine={false} axisLine={false} width={62} />
        <Tooltip content={<MoneyTip labelFmt={shortDate} />} />
        <Legend verticalAlign="top" align="left" iconType="circle" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
        <Line name="Account balance" type="monotone" dataKey="balance" stroke="#6853b5" strokeWidth={1.8} dot={false} isAnimationActive={false} />
        <Line name="Deposits / withdrawals" type="monotone" dataKey="flow" stroke="#f06363" strokeWidth={1.4} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function EdgeRadar({ parts }: { parts: { label: string; value: number; display: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <RadarChart data={parts} outerRadius="74%">
        <defs>
          <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6853b5" stopOpacity={0.7} />
            <stop offset="100%" stopColor="#6853b5" stopOpacity={0.15} />
          </linearGradient>
        </defs>
        <PolarGrid stroke="#ececf2" />
        <PolarAngleAxis dataKey="label" tick={{ fontSize: 12.5, fill: '#4a4a4a' }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar dataKey="value" stroke="#6853b5" strokeWidth={1.5} fill="url(#radarFill)" dot={{ r: 3, fill: '#fff', stroke: '#6853b5', strokeWidth: 1.5 }} isAnimationActive={false} />
        <Tooltip
          content={({ active, payload }: any) =>
            active && payload?.length ? (
              <div style={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }}>
                <b style={{ fontWeight: 500 }}>{payload[0].payload.label}</b>: {payload[0].payload.display} ({Math.round(payload[0].payload.value)}/100)
              </div>
            ) : null
          }
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

const statusColor = { win: '#4ebf94', loss: '#f06363', be: '#2959db' } as const;

export function PerformanceScatter({ data, x, height = 300 }: { data: any[]; x: 'minutes' | 'duration'; height?: number }) {
  const series = (['win', 'loss', 'be'] as const).map((s) => ({ s, rows: data.filter((d) => d.status === s) }));
  const fmtX = x === 'minutes' ? (v: number) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}` : (v: number) => duration(v);
  const domain: [number, number] | ['auto', 'auto'] = x === 'minutes' ? [420, 1290] : [0, Math.max(60, ...data.map((d) => d.duration))];
  const ticks = x === 'minutes' ? Array.from({ length: 15 }, (_, i) => 420 + i * 60) : undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis type="number" dataKey={x} domain={domain} ticks={ticks} tick={axis} tickFormatter={fmtX} tickLine={false} axisLine={false} />
        <YAxis type="number" dataKey="net" tick={axis} tickFormatter={(v) => moneyShort(v)} tickLine={false} axisLine={false} width={58} />
        <ZAxis range={[26, 26]} />
        <ReferenceLine y={0} stroke="#c9c9c9" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }: any) =>
            active && payload?.length ? (
              <div style={{ background: '#fff', border: '1px solid #e2e2e2', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }}>
                {fmtX(payload[0].payload[x])}: <b style={{ fontWeight: 500 }}>{money(payload[0].payload.net)}</b>
              </div>
            ) : null
          }
        />
        {series.map(({ s, rows }) => (
          <Scatter key={s} data={rows} fill={statusColor[s]} isAnimationActive={false} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function Gauge({ value, wins, be, losses }: { value: number; wins: number; be: number; losses: number }) {
  const total = wins + be + losses || 1;
  const r = 44;
  const c = Math.PI * r;
  const seg = (n: number) => (n / total) * c;
  const arc = 'M 6 52 A 44 44 0 0 1 94 52';
  return (
    <div style={{ width: 104 }} title={`${value.toFixed(1)}%`}>
      <svg viewBox="0 0 100 58" width="104" height="60" role="img" aria-label="Wins, break-evens and losses">
        <path d={arc} fill="none" stroke="#eee" strokeWidth="8" />
        <path d={arc} fill="none" stroke="#4ebf94" strokeWidth="8" strokeDasharray={`${seg(wins)} ${c}`} />
        <path d={arc} fill="none" stroke="#2959db" strokeWidth="8" strokeDasharray={`${seg(be)} ${c}`} strokeDashoffset={-seg(wins)} />
        <path d={arc} fill="none" stroke="#f06363" strokeWidth="8" strokeDasharray={`${seg(losses)} ${c}`} strokeDashoffset={-(seg(wins) + seg(be))} />
      </svg>
      <div className="gauge-pills">
        <span className="mini-pill win">{wins}</span>
        <span className="mini-pill be">{be}</span>
        <span className="mini-pill loss">{losses}</span>
      </div>
    </div>
  );
}

export function Donut({ win, loss }: { win: number; loss: number }) {
  const total = win + loss || 1;
  const r = 26;
  const c = 2 * Math.PI * r;
  const part = (win / total) * c;
  return (
    <svg viewBox="0 0 64 64" width="66" height="66" role="img" aria-label="Gross profit versus gross loss">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#f06363" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="#4ebf94" strokeWidth="6" strokeDasharray={`${part} ${c}`} transform="rotate(-90 32 32)" />
    </svg>
  );
}

const etTime = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export interface ChartTrade {
  side: string;
  entered_ts: number;
  exited_ts: number;
  entry_price: number;
  exit_price: number;
  net_pnl: number;
  qty: number;
  highlight?: boolean;
}

/** Candles from the stored bars with every entry and exit from that day marked on them. */
export function PriceChart({ bars, trades, height = 420, focus }: { bars: number[][]; trades: ChartTrade[]; height?: number; focus?: [number, number] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !bars.length) return;
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#616161', fontFamily: 'Roboto, sans-serif' },
      grid: { vertLines: { color: '#f5f5f5' }, horzLines: { color: '#f5f5f5' } },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#eeeeee',
        tickMarkFormatter: (t: number) => etTime(t),
      },
      rightPriceScale: { borderColor: '#eeeeee' },
      localization: {
        timeFormatter: (t: number) => etTime(t),
      },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#4ebf94', downColor: '#f06363', borderVisible: false, wickUpColor: '#4ebf94', wickDownColor: '#f06363',
    });
    const seen = new Set<number>();
    const clean = bars.filter((b) => (seen.has(b[0]) ? false : (seen.add(b[0]), true))).sort((a, b) => a[0] - b[0]);
    candles.setData(clean.map((b) => ({ time: b[0] as UTCTimestamp, open: b[1], high: b[2], low: b[3], close: b[4] })));

    const barStep = clean.length > 1 ? clean[1][0] - clean[0][0] : 60;
    const snap = (ms: number) => (Math.floor(ms / 1000 / barStep) * barStep) as UTCTimestamp;
    const markers: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      const long = t.side === 'Long';
      markers.push({ time: snap(t.entered_ts), position: long ? 'belowBar' : 'aboveBar', color: t.highlight === false ? '#b9b1dc' : '#6853b5', shape: long ? 'arrowUp' : 'arrowDown', text: t.highlight ? `${long ? 'Buy' : 'Sell'} ${t.qty}` : '' });
      markers.push({ time: snap(t.exited_ts), position: long ? 'aboveBar' : 'belowBar', color: t.net_pnl >= 0 ? '#2ea87c' : '#dc4a4a', shape: 'circle', text: t.highlight ? money(t.net_pnl, { cents: false }) : '' });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(candles, markers);

    if (focus) {
      const pad = barStep * 45;
      chart.timeScale().setVisibleRange({ from: (focus[0] / 1000 - pad) as UTCTimestamp, to: (focus[1] / 1000 + pad) as UTCTimestamp });
    } else if (trades.length) {
      const pad = barStep * 45;
      chart.timeScale().setVisibleRange({
        from: (Math.min(...trades.map((t) => t.entered_ts)) / 1000 - pad) as UTCTimestamp,
        to: (Math.max(...trades.map((t) => t.exited_ts)) / 1000 + pad) as UTCTimestamp,
      });
    } else chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, trades, height, focus]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
