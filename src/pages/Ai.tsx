import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarRange, Check, Crosshair, Loader2, PenLine, Send, Sparkles, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, Loading } from '../components/ui';
import { addDays, api, filterQuery, EMPTY_FILTERS, money, signClass } from '../lib';

const KINDS = [
  { key: 'daily', icon: CalendarDays, label: 'Daily debrief', hint: 'Reads the fills, notes, market and your charts for one day' },
  { key: 'weekly', icon: CalendarRange, label: 'Weekly review', hint: 'What defined the week and the one change that matters' },
  { key: 'monthly', icon: CalendarRange, label: 'Monthly review', hint: 'What changed and which days should not have been traded' },
  { key: 'patterns', icon: Crosshair, label: 'Edge & pattern report', hint: 'Your full history: when you are at your best and worst' },
  { key: 'custom', icon: PenLine, label: 'Custom analysis', hint: 'Write your own prompt and get a full report on it' },
];

const CUSTOM_EXAMPLES = [
  'Compare my Monday trades with the rest of my week',
  'Which of my losses were good trades, and which were mistakes?',
  'How does my trading change after a big green day?',
];

function CustomReportView({ row }: { row: any }) {
  const r = JSON.parse(row.result);
  return (
    <div className="report">
      <div className="hint">{row.title}</div>
      <h2 style={{ marginTop: 3 }}>{r.headline}</h2>
      <div className="custom-prompt">{row.prompt}</div>
      {r.sections.map((s: any) => (
        <div key={s.title}>
          <h3>{s.title}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p>
        </div>
      ))}
      <p className="hint" style={{ marginTop: 18 }}>{r.sample_note}</p>
      {r.follow_ups.length > 0 && (
        <>
          <h3>Worth asking next</h3>
          <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 1.6 }}>{r.follow_ups.map((n: string) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
      <p className="hint" style={{ marginTop: 22 }}>
        {row.model} · {row.scope_from === '2000-01-01' ? 'All history' : `${row.scope_from} to ${row.scope_to}`} · {row.images_used} screenshot{row.images_used === 1 ? '' : 's'} read · ${row.cost_usd.toFixed(2)}
      </p>
    </div>
  );
}

function ReportView({ row, adopted, onAdopt }: { row: any; adopted: Set<string>; onAdopt: (rule: { rule: string; why: string }) => void }) {
  const r = JSON.parse(row.result);
  return (
    <div className="report">
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div className="grade" title="Process grade, separate from P&L">{r.process_grade}</div>
        <div className="grow">
          <div className="hint">{row.title}</div>
          <h2 style={{ marginTop: 3 }}>{r.headline}</h2>
        </div>
      </div>
      <p style={{ marginTop: 14 }}>{r.summary}</p>

      <h3>Price action</h3>
      <p>{r.price_action_read}</p>

      {r.findings.length > 0 && <h3>What actually happened</h3>}
      {r.findings.map((f: any) => (
        <div className={`finding ${f.kind}`} key={f.title}>
          <h4>{f.title} <span className="hint">{f.kind} · {f.impact} impact</span></h4>
          <div style={{ lineHeight: 1.55 }}>{f.detail}</div>
          <div className="evidence">{f.evidence}</div>
        </div>
      ))}

      {(r.higher_probability.length > 0 || r.lower_probability.length > 0) && (
        <>
          <h3>Probability map</h3>
          <div className="prob-grid">
            <div className="prob hi">
              <h4 className="row" style={{ gap: 6 }}><TrendingUp size={15} /> Higher probability for you</h4>
              {r.higher_probability.map((p: any) => (
                <div className="prob-item" key={p.condition}>
                  <b style={{ fontWeight: 500 }}>{p.condition}</b>
                  <div>{p.why}</div>
                  <div className="evidence">{p.evidence} (sample: {p.sample})</div>
                </div>
              ))}
            </div>
            <div className="prob lo">
              <h4 className="row" style={{ gap: 6 }}><TrendingDown size={15} /> Lower probability for you</h4>
              {r.lower_probability.map((p: any) => (
                <div className="prob-item" key={p.condition}>
                  <b style={{ fontWeight: 500 }}>{p.condition}</b>
                  <div>{p.why}</div>
                  <div className="evidence">{p.evidence} (sample: {p.sample})</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <h3>Psychology</h3>
      <p>{r.psychology}</p>

      {r.rule_followup.length > 0 && (
        <>
          <h3>Your rules</h3>
          {r.rule_followup.map((f: any) => (
            <div className="kv" key={f.rule}>
              <span style={{ color: 'var(--text)' }}>{f.rule}<div className="evidence">{f.evidence}</div></span>
              <span className={f.status === 'followed' ? 'pos' : f.status === 'broken' ? 'neg' : ''}>{f.status.replace('_', ' ')}</span>
            </div>
          ))}
        </>
      )}

      {r.new_rules.length > 0 && (
        <>
          <h3>Suggested rules</h3>
          {r.new_rules.map((rule: any) => (
            <div className="kv" key={rule.rule}>
              <span style={{ color: 'var(--text)' }}>{rule.rule}<div className="evidence">{rule.why}</div></span>
              <span>
                {adopted.has(rule.rule) ? (
                  <span className="pos row" style={{ gap: 4 }}><Check size={14} /> Adopted</span>
                ) : (
                  <button className="btn small" onClick={() => onAdopt(rule)}>Adopt</button>
                )}
              </span>
            </div>
          ))}
        </>
      )}

      {r.next_session_focus.length > 0 && (
        <>
          <h3>Next session focus</h3>
          <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 1.6 }}>{r.next_session_focus.map((n: string) => <li key={n}>{n}</li>)}</ul>
        </>
      )}

      {r.data_gaps.length > 0 && (
        <>
          <h3>To make this sharper</h3>
          <ul className="hint" style={{ paddingLeft: 20, margin: 0 }}>{r.data_gaps.map((n: string) => <li key={n}>{n}</li>)}</ul>
        </>
      )}

      <p className="hint" style={{ marginTop: 22 }}>
        {row.model} · {row.images_used} screenshot{row.images_used === 1 ? '' : 's'} read · ${row.cost_usd.toFixed(2)} · {(row.input_tokens / 1000).toFixed(1)}k in, {(row.output_tokens / 1000).toFixed(1)}k out
      </p>
    </div>
  );
}

function Generator({ today, lastDay, onStarted, hasKey }: { today: string; lastDay: string | null; onStarted: (id: number) => void; hasKey: boolean }) {
  const [kind, setKind] = useState('daily');
  const [date, setDate] = useState('');
  const [prompt, setPrompt] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const day = date || lastDay || today;
  const defaultFrom = kind === 'weekly' ? addDays(today, -6) : kind === 'monthly' ? addDays(today, -29) : kind === 'custom' ? '' : '2000-01-01';

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const body = kind === 'daily' ? { kind, from: day, to: day } : { kind, from: from || defaultFrom || '2000-01-01', to: to || today, prompt };
      const { id } = await api('/ai/reports', { method: 'POST', json: body });
      onStarted(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="New analysis">
      <div className="ai-kinds">
        {KINDS.map((k) => (
          <button key={k.key} className={`ai-kind ${kind === k.key ? 'on' : ''}`} onClick={() => setKind(k.key)}>
            <k.icon size={17} color="var(--primary)" style={{ flex: 'none', marginTop: 2 }} />
            <span><b>{k.label}</b><small>{k.hint}</small></span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        {kind === 'daily' ? (
          <div className="field">
            <label className="label">Day</label>
            <input type="date" className="input" value={day} onChange={(e) => setDate(e.target.value)} />
          </div>
        ) : (
          kind !== 'patterns' && (
            <>
            {kind === 'custom' && (
              <div className="field">
                <label className="label" htmlFor="custom-prompt">What do you want analyzed?</label>
                <textarea id="custom-prompt" className="input" rows={5} maxLength={4000} placeholder={CUSTOM_EXAMPLES[0]} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                <div className="tag-row" style={{ marginTop: 6 }}>
                  {CUSTOM_EXAMPLES.map((text) => <button type="button" className="btn small" style={{ whiteSpace: 'normal', height: 'auto', padding: '5px 8px', textAlign: 'left' }} key={text} onClick={() => setPrompt(text)}>{text}</button>)}
                </div>
              </div>
            )}
            <div className="row">
              <div className="field grow"><label className="label">From</label><input type="date" className="input" value={from || defaultFrom} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field grow"><label className="label">To</label><input type="date" className="input" value={to || today} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            {kind === 'custom' && <div className="hint" style={{ marginBottom: 12 }}>Leave From empty to use your whole history.</div>}
            </>
          )
        )}
        {error && <div className="banner bad">{error}</div>}
        {hasKey ? (
          <button className="btn primary" style={{ width: '100%' }} disabled={busy || (kind === 'custom' && !prompt.trim())} onClick={() => void run()}><Sparkles size={15} /> Run analysis</button>
        ) : (
          <Link className="btn primary" style={{ width: '100%' }} to="/settings">Add your Claude API key</Link>
        )}
      </div>
    </Card>
  );
}

function Rules({ rules, onChange }: { rules: any[]; onChange: () => void }) {
  const [text, setText] = useState('');
  const active = rules.filter((r) => r.status === 'active');
  const add = async () => {
    if (!text.trim()) return;
    await api('/ai/rules', { method: 'POST', json: { text } });
    setText('');
    onChange();
  };
  return (
    <Card title="Rules I'm holding myself to" info="Every report checks whether you followed these.">
      {active.length === 0 && <div className="hint" style={{ marginBottom: 10 }}>Adopt a suggested rule from a report, or write your own.</div>}
      {active.map((r) => (
        <div className="row" key={r.id} style={{ padding: '7px 0', borderBottom: '1px solid #f5f5f5', alignItems: 'flex-start' }}>
          <span className="grow" style={{ lineHeight: 1.4 }}>{r.text}</span>
          <button className="arrow" onClick={() => void api(`/ai/rules/${r.id}`, { method: 'DELETE' }).then(onChange)} aria-label="Remove rule"><X size={14} /></button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" placeholder="Add a rule" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <button className="btn" onClick={() => void add()}>Add</button>
      </div>
    </Card>
  );
}

const SUGGESTED = [
  'What do my best days have in common before the first trade?',
  'Which trades should I have skipped this month?',
  'Am I better long or short, and on which kinds of days?',
  'What does my journal say on days I lose the most?',
];

function Chat({ hasKey }: { hasKey: boolean }) {
  const qc = useQueryClient();
  const { data: saved = [] } = useQuery<any[]>({ queryKey: ['chat'], queryFn: () => api('/ai/chat') });
  const [pending, setPending] = useState<{ q: string; a: string } | null>(null);
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [saved, pending]);

  const send = async (question: string) => {
    if (!question.trim() || pending) return;
    setText('');
    setPending({ q: question, a: '' });
    const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question }) });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({ error: 'Something went wrong.' }));
      setPending({ q: question, a: body.error });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let answer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      setPending({ q: question, a: answer });
    }
    await qc.invalidateQueries({ queryKey: ['chat'] });
    setPending(null);
  };

  const messages = [...saved, ...(pending ? [{ id: 'q', role: 'user', content: pending.q }, { id: 'a', role: 'assistant', content: pending.a || '…' }] : [])];

  return (
    <section className="card chat">
      <div className="card-head">
        <div className="card-title">Ask your journal</div>
        {saved.length > 0 && (
          <button className="btn small" onClick={() => void api('/ai/chat', { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: ['chat'] }))}>
            <Trash2 size={13} /> Clear
          </button>
        )}
      </div>
      <div className="chat-log" ref={log}>
        {messages.length === 0 && (
          <div className="empty">
            <h3>Ask anything about your trading</h3>
            It can see every position, your recent journal entries, your rules and past reports.
            <div className="suggestions">
              {SUGGESTED.map((s) => <button className="btn small" key={s} disabled={!hasKey} onClick={() => void send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => <div key={m.id} className={`msg ${m.role}`}>{m.content}</div>)}
      </div>
      <div className="chat-input">
        <input className="input" placeholder={hasKey ? 'Ask a question' : 'Add your Claude API key in Settings first'} disabled={!hasKey} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send(text)} />
        <button className="btn primary icon-only" disabled={!hasKey || !!pending} onClick={() => void send(text)} aria-label="Send"><Send size={15} /></button>
      </div>
    </section>
  );
}

function FreeInsights() {
  const { data } = useQuery<any>({ queryKey: ['reports', EMPTY_FILTERS], queryFn: () => api(`/reports${filterQuery(EMPTY_FILTERS)}`) });
  if (!data) return <Loading />;
  const list = (rows: any[]) =>
    rows.length ? rows.map((r) => (
      <div className="prob-item" key={`${r.group}-${r.label}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b style={{ fontWeight: 500 }}>{r.label}</b>
          <span className={signClass(r.avg)}>{money(r.avg, { cents: false })} avg</span>
        </div>
        <div className="evidence">{r.group}: {r.n} positions, {r.winRate.toFixed(0)}% wins, {money(r.net, { cents: false })} total{r.lowSample ? '. Early read, small sample.' : ''}</div>
      </div>
    )) : <div className="hint">Not enough trades yet.</div>;
  return (
    <div className="stack">
      <div className="banner">Calculated instantly from your data with no API cost. Averages are per position, compared with your overall {money(data.ranked.baseline, { cents: false })}.</div>
      <div className="prob-grid">
        <div className="prob hi"><h4 className="row" style={{ gap: 6 }}><TrendingUp size={15} /> Where you beat your average</h4>{list(data.ranked.best)}</div>
        <div className="prob lo"><h4 className="row" style={{ gap: 6 }}><TrendingDown size={15} /> Where you fall below it</h4>{list(data.ranked.worst)}</div>
      </div>
    </div>
  );
}

export default function AiPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get('report')) || null;
  const [view, setView] = useState<'reports' | 'ask' | 'edges'>('reports');
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const { data: reports = [] } = useQuery<any[]>({
    queryKey: ['aiReports'],
    queryFn: () => api('/ai/reports'),
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((r) => r.status === 'running') ? 2500 : false),
  });
  const { data: rules = [] } = useQuery<any[]>({ queryKey: ['aiRules'], queryFn: () => api('/ai/rules') });
  const { data: dash } = useQuery<any>({ queryKey: ['dashboard', EMPTY_FILTERS], queryFn: () => api('/dashboard') });

  const refreshRules = () => void qc.invalidateQueries({ queryKey: ['aiRules'] });
  const open = (id: number) => {
    setParams({ report: String(id) });
    setView('reports');
    void qc.invalidateQueries({ queryKey: ['aiReports'] });
  };

  const current = reports.find((r) => r.id === selected) ?? reports[0];
  const lastDay = dash?.days?.[dash.days.length - 1]?.date ?? null;
  const adopted = new Set<string>(rules.map((r) => r.text));
  const hasKey = Boolean(meta?.settings?.has_ai_key);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Analysis</div>
          <h1 className="page-title">Edge AI</h1>
        </div>
        <div className="tabs">
          <button className={view === 'reports' ? 'on' : ''} onClick={() => setView('reports')}>Reports</button>
          <button className={view === 'ask' ? 'on' : ''} onClick={() => setView('ask')}>Ask</button>
          <button className={view === 'edges' ? 'on' : ''} onClick={() => setView('edges')}>Edges</button>
        </div>
      </div>
      {meta && !hasKey && (
        <div className="banner">AI analysis needs a Claude API key. <Link to="/settings" style={{ textDecoration: 'underline' }}>Add it in Settings.</Link> The Edges tab works without one.</div>
      )}
      <div className="ai-layout">
        <div className="stack">
          <Generator today={meta?.today ?? ''} lastDay={lastDay} onStarted={open} hasKey={hasKey} />
          <Rules rules={rules} onChange={refreshRules} />
          {reports.length > 0 && (
            <section className="card" style={{ overflow: 'hidden' }}>
              <div className="card-head"><div className="card-title">History</div></div>
              {reports.map((r) => (
                <button key={r.id} className={`report-link ${current?.id === r.id ? 'on' : ''}`} onClick={() => open(r.id)}>
                  <div className="t">{r.title}</div>
                  <div className="m">
                    {r.status === 'running' ? 'Analyzing…' : r.status === 'failed' ? 'Failed' : `$${r.cost_usd.toFixed(2)}`} · {new Date(`${r.created_at.replace(' ', 'T')}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </button>
              ))}
            </section>
          )}
        </div>
        <div>
          {view === 'ask' && <Chat hasKey={hasKey} />}
          {view === 'edges' && <FreeInsights />}
          {view === 'reports' && (
            <section className="card">
              <div className="card-body" style={{ padding: 24 }}>
                {!current ? (
                  <div className="empty"><Sparkles size={30} color="var(--primary)" /><h3 style={{ marginTop: 10 }}>No reports yet</h3>Upload trades, journal a day, add your charts, then run a debrief.</div>
                ) : current.status === 'running' ? (
                  <div className="empty"><Loader2 className="spin" size={28} color="var(--primary)" /><h3 style={{ marginTop: 10 }}>{current.title}</h3>Reading your trades, notes and charts. This usually takes a minute or two.</div>
                ) : current.status === 'failed' ? (
                  <div className="banner bad">{current.error}</div>
                ) : (
                  current.kind === 'custom' ? <CustomReportView row={current} /> : <ReportView
                    row={current}
                    adopted={adopted}
                    onAdopt={(rule) => void api('/ai/rules', { method: 'POST', json: { text: rule.rule, why: rule.why, source_report_id: current.id } }).then(refreshRules)}
                  />
                )}
                {current && current.status !== 'running' && (
                  <div style={{ marginTop: 16, textAlign: 'right' }}>
                    <button
                      className="btn small danger"
                      onClick={() => {
                        if (confirm('Delete this report?')) void api(`/ai/reports/${current.id}`, { method: 'DELETE' }).then(() => { setParams({}); return qc.invalidateQueries({ queryKey: ['aiReports'] }); });
                      }}
                    >
                      <Trash2 size={13} /> Delete report
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
