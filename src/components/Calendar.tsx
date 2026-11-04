import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, moneyShort, useUi } from '../lib';

export interface CalendarDay {
  date: string;
  net: number;
  trades: number;
  winRate: number;
  hasNote?: boolean;
}

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthLabel(month: string) {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shiftMonth(month: string, by: number) {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

export function PnlCalendar({ days, today, beThreshold }: { days: CalendarDay[]; today: string; beThreshold: number }) {
  const { openDay } = useUi();
  const [month, setMonth] = useState(today.slice(0, 7));
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const first = `${month}-01`;
  const startOffset = new Date(`${first}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(first, -startOffset);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks: string[][] = [];
  for (let i = 0; i < 6; i++) {
    const w = cells.slice(i * 7, i * 7 + 7);
    if (w.some((d) => d.startsWith(month))) weeks.push(w);
  }

  const monthDays = days.filter((d) => d.date.startsWith(month));
  const monthNet = monthDays.reduce((a, d) => a + d.net, 0);

  return (
    <section className="card">
      <div className="cal-top">
        <div className="cal-nav">
          <button className="arrow" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <div className="cal-month">{monthLabel(month)}</div>
          <button className="arrow" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
          <button className="btn small" onClick={() => setMonth(today.slice(0, 7))}>
            This month
          </button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <b style={{ fontWeight: 500 }}>Monthly stats:</b>
          <span className={monthNet >= 0 ? 'chip-green' : 'chip-red'}>{moneyShort(monthNet)}</span>
          <span className="chip-plain">
            {monthDays.length} day{monthDays.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="cal-body">
        <div>
          <div className="cal-weekdays">
            {WEEK.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="cal-cells">
            {weeks.flat().map((date) => {
              const inMonth = date.startsWith(month);
              const d = byDate.get(date);
              const state = d ? (d.net > beThreshold ? 'win' : d.net < -beThreshold ? 'loss' : 'be') : '';
              if (!inMonth) return <div key={date} className="cal-cell out" />;
              return (
                <button key={date} className={`cal-cell ${state || 'empty-day'}`} style={{ border: state ? undefined : 0 }} onClick={() => openDay(date)}>
                  <span className={`cal-date ${date === today ? 'today' : ''}`}>{Number(date.slice(8))}</span>
                  {d && (
                    <>
                      <span className="cal-net">{moneyShort(d.net)}</span>
                      <span className="cal-sub">
                        {d.trades} trade{d.trades === 1 ? '' : 's'}
                      </span>
                      <span className="cal-sub">{d.winRate.toFixed(d.winRate % 1 ? 2 : 1)}%</span>
                    </>
                  )}
                  {d?.hasNote && (
                    <span className="cal-note" title="Journaled">
                      <NotebookPen size={15} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="cal-weeks">
          {weeks.map((w, i) => {
            const rows = w.map((date) => (date.startsWith(month) ? byDate.get(date) : undefined)).filter(Boolean) as CalendarDay[];
            const net = rows.reduce((a, d) => a + d.net, 0);
            return (
              <div className="week-card" key={w[0]}>
                <div className="week-label">Week {i + 1}</div>
                <div className={`week-net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`}>{moneyShort(net)}</div>
                <div>
                  <span className="chip-plain" style={{ fontSize: 11.5 }}>
                    {rows.length} day{rows.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
