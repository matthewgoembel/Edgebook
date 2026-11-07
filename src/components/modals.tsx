import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotebookPen, Play, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, duration, longDate, money, MOODS, pct, profitFactorLabel, signClass, useFilters, filterQuery } from '../lib';
import { EquityArea } from './charts';
import { CopyBadge, Modal, ModalHeader, StatusPill } from './ui';

function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

type UploadKind = 'topstep' | 'orders' | 'cash' | 'unsupported';

interface UploadItem {
  key: string;
  file: File;
  kind: UploadKind;
  /** Tradovate account numbers found in the file. */
  refs: string[];
  /** Topstep files don't name their account, so each gets a choice: an account id or 'new'. */
  account: string;
  newName: string;
  balance: string;
}

const KIND_LABEL: Record<UploadKind, string> = {
  topstep: 'Topstep trades',
  orders: 'Tradovate Orders',
  cash: 'Tradovate Cash History',
  unsupported: 'Not a supported file',
};

/** Reads just enough of a CSV to know what it is and which account it belongs to. */
async function inspectCsv(file: File): Promise<Pick<UploadItem, 'kind' | 'refs'>> {
  const lines = (await file.text()).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = (lines[0] ?? '').split(',').map((h) => h.trim());
  const has = (...cols: string[]) => cols.every((c) => header.includes(c));
  const kind: UploadKind = has('Id', 'ContractName', 'EnteredAt') ? 'topstep' : has('Order ID', 'Avg Fill Price', 'Fill Time') ? 'orders' : has('Transaction ID', 'Cash Change Type') ? 'cash' : 'unsupported';
  if (kind !== 'orders' && kind !== 'cash') return { kind, refs: [] };
  // The account column comes before any quoted values in both reports, so a plain split is safe.
  const column = header.indexOf('Account');
  return { kind, refs: [...new Set(lines.slice(1).map((l) => l.split(',')[column]?.trim()).filter(Boolean))] };
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshAll();
  const navigate = useNavigate();
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const accounts: any[] = (meta?.accounts ?? []).filter((a: any) => !a.archived);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [refNames, setRefNames] = useState<Record<string, { name: string }>>({});
  const [drag, setDrag] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (incoming: File[]) => {
    const csvs = incoming.filter((f) => f.name.toLowerCase().endsWith('.csv'));
    const inspected = await Promise.all(csvs.map(async (file) => ({ file, ...(await inspectCsv(file)) })));
    setItems((current) => {
      const next = [...current];
      const last = localStorage.getItem('lastAccount') ?? '';
      for (const { file, kind, refs } of inspected) {
        const key = `${file.name}|${file.size}|${file.lastModified}`;
        if (next.some((i) => i.key === key)) continue;
        // Start each Topstep file on a different account, so copy-trade exports don't pile into one.
        const used = new Set(next.filter((i) => i.kind === 'topstep').map((i) => i.account));
        const free = [last, ...accounts.map((a) => String(a.id))].find((id) => accounts.some((a) => String(a.id) === id) && !used.has(id));
        next.push({ key, file, kind, refs, account: free ?? 'new', newName: '', balance: '' });
      }
      return next;
    });
  };

  const patch = (key: string, change: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));
  const usable = items.filter((i) => i.kind !== 'unsupported');
  const unknownRefs = [...new Set(usable.flatMap((i) => i.refs))].filter((ref) => !accounts.some((a) => a.external_ref === ref));
  const accountName = (ref: string) => accounts.find((a) => a.external_ref === ref)?.name ?? refNames[ref]?.name ?? ref;

  const topstepCounts = new Map<string, number>();
  for (const i of items) if (i.kind === 'topstep' && i.account !== 'new') topstepCounts.set(i.account, (topstepCounts.get(i.account) ?? 0) + 1);
  const shared = [...topstepCounts.entries()].filter(([, n]) => n > 1).map(([id]) => accounts.find((a) => String(a.id) === id)?.name);

  const submit = async () => {
    setError('');
    const missing = usable.find((i) => i.kind === 'topstep' && i.account === 'new' && !i.newName.trim());
    if (missing) return setError(`Name the new account for ${missing.file.name}.`);
    const body = new FormData();
    usable.forEach((i) => body.append('files', i.file));
    body.append(
      'meta',
      JSON.stringify({
        files: usable.map((i) => (i.account === 'new' ? { newName: i.newName, balance: Number(i.balance) || 0 } : { accountId: Number(i.account) })),
        refs: refNames,
      }),
    );
    setBusy(true);
    try {
      const res = await api('/import', { method: 'POST', body });
      if (res.accountId) localStorage.setItem('lastAccount', String(res.accountId));
      setResults(res.results);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lastDate = results?.flatMap((r) => r.dates).sort().pop();

  return (
    <Modal size="medium" onClose={onClose}>
      <div className="modal-body">
        <ModalHeader title="Upload trades" onClose={onClose} />
        {results ? (
          <>
            {results.map((r) => (
              <div key={r.file} className={`banner ${r.error ? 'bad' : 'ok'}`} style={{ display: 'block' }}>
                <b style={{ fontWeight: 500 }}>{r.file}</b>
                <div style={{ marginTop: 3 }}>
                  {r.error ?? (r.kind === 'cash' ? `${r.total} cash entries read.` : `${r.added} new trade${r.added === 1 ? '' : 's'} added${r.skipped ? `, ${r.skipped} already imported and skipped` : ''}.`)}
                </div>
                {(r.notes ?? []).map((n: string) => <div key={n} style={{ marginTop: 3 }}>{n}</div>)}
              </div>
            ))}
          </>
        ) : (
          <>
            <div
              className={`drop ${drag ? 'drag' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <UploadCloud size={28} />
              <div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 500 }}>{items.length ? 'Add more files' : 'Drop your CSV files here'}</div>
              <div className="hint">Add as many as you like, all at once or one after another. Topstep: the trades export. Tradovate or Lucid: Orders and Cash History. Re-uploading never creates duplicates.</div>
              <input ref={input} hidden type="file" accept=".csv,text/csv" multiple onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            </div>

            {items.length > 0 && (
              <div className="upload-list">
                {items.map((item) => (
                  <div className={`upload-row ${item.kind === 'unsupported' ? 'bad' : ''}`} key={item.key}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div className="grow">
                        <div className="upload-name">{item.file.name}</div>
                        <div className="hint">
                          {KIND_LABEL[item.kind]}
                          {item.refs.length > 0 && ` → ${item.refs.map(accountName).join(', ')}`}
                          {item.kind === 'unsupported' && '. It will be skipped.'}
                        </div>
                      </div>
                      <button className="arrow" onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))} aria-label={`Remove ${item.file.name}`}><X size={15} /></button>
                    </div>
                    {item.kind === 'topstep' && (
                      <div className="upload-account">
                        <select className="select" aria-label={`Account for ${item.file.name}`} value={item.account} onChange={(e) => patch(item.key, { account: e.target.value })}>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          <option value="new">+ New account</option>
                        </select>
                        {item.account === 'new' && (
                          <>
                            <input className="input" aria-label="New account name" placeholder="Account name" value={item.newName} onChange={(e) => patch(item.key, { newName: e.target.value })} />
                            <input className="input" aria-label="Starting balance" type="number" placeholder="Starting balance" value={item.balance} onChange={(e) => patch(item.key, { balance: e.target.value })} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {unknownRefs.length > 0 && (
              <div className="upload-new-accounts">
                <div className="label">New Tradovate account{unknownRefs.length > 1 ? 's' : ''}: give {unknownRefs.length > 1 ? 'each' : 'it'} a name. Cash History sets the starting balance.</div>
                {unknownRefs.map((ref) => (
                  <div className="upload-account" key={ref}>
                    <input
                      className="input"
                      aria-label={`Name for ${ref}`}
                      placeholder={ref}
                      list="empty-accounts"
                      value={refNames[ref]?.name ?? ''}
                      onChange={(e) => setRefNames({ ...refNames, [ref]: { name: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
            )}

            <datalist id="empty-accounts">
              {accounts.filter((a) => !a.external_ref).map((a) => <option key={a.id} value={a.name} />)}
            </datalist>

            {shared.length > 0 && (
              <div className="banner" style={{ marginTop: 12, marginBottom: 0 }}>
                Several Topstep files are going into {shared.join(', ')}. That's right for different dates. For copy-trade accounts, give each file its own account, or your results will be counted several times over.
              </div>
            )}
            {error && <div className="banner bad" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}
          </>
        )}
      </div>
      <div className="modal-foot">
        {results ? (
          <>
            <button className="btn" onClick={onClose}>Done</button>
            {lastDate && (
              <button className="btn primary" onClick={() => { onClose(); navigate(`/day/${lastDate}`); }}>
                Journal {longDate(lastDate)}
              </button>
            )}
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!usable.length || busy} onClick={() => void submit()}>
              {busy ? 'Importing…' : usable.length > 1 ? `Import ${usable.length} files` : 'Import'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function AddTradeModal({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshAll();
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const [form, setForm] = useState({ account_id: '', symbol: 'NQZ6', side: 'Long', qty: '1', date: '', open_time: '09:30:00', close_time: '09:35:00', entry_price: '', exit_price: '', fees: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const account = form.account_id || (meta?.accounts?.[0]?.id ?? '');
  const date = form.date || meta?.today || '';

  const save = async () => {
    setError('');
    try {
      await api('/trades', { method: 'POST', json: { ...form, account_id: account, date } });
      await refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal size="small" onClose={onClose}>
      <div className="modal-body">
        <ModalHeader title="Add a trade by hand" onClose={onClose} />
        <div className="grid-2">
          <div className="field">
            <label className="label">Account</label>
            <select className="select" value={account} onChange={set('account_id')}>
              {(meta?.accounts ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field"><label className="label">Contract</label><input className="input" value={form.symbol} onChange={set('symbol')} /></div>
          <div className="field">
            <label className="label">Side</label>
            <select className="select" value={form.side} onChange={set('side')}><option>Long</option><option>Short</option></select>
          </div>
          <div className="field"><label className="label">Contracts</label><input className="input" type="number" value={form.qty} onChange={set('qty')} /></div>
          <div className="field"><label className="label">Date</label><input className="input" type="date" value={date} onChange={set('date')} /></div>
          <div className="field"><label className="label">Fees + commissions</label><input className="input" type="number" value={form.fees} onChange={set('fees')} /></div>
          <div className="field"><label className="label">Entry time (ET)</label><input className="input" type="time" step="1" value={form.open_time} onChange={set('open_time')} /></div>
          <div className="field"><label className="label">Exit time (ET)</label><input className="input" type="time" step="1" value={form.close_time} onChange={set('close_time')} /></div>
          <div className="field"><label className="label">Entry price</label><input className="input" type="number" value={form.entry_price} onChange={set('entry_price')} /></div>
          <div className="field"><label className="label">Exit price</label><input className="input" type="number" value={form.exit_price} onChange={set('exit_price')} /></div>
        </div>
        {error && <div className="banner bad">{error}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void save()}>Save trade</button>
      </div>
    </Modal>
  );
}

export function ChecklistEditor({ date }: { date: string }) {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery<any[]>({ queryKey: ['checklist', date], queryFn: () => api(`/checklist/${date}`) });
  const toggle = useMutation({
    mutationFn: (item: any) => api(`/checklist/${date}/${item.id}`, { method: 'PUT', json: { done: !item.done } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['checklist', date] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <div>
      {items.map((item) => (
        <label key={item.id} className="row" style={{ padding: '7px 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={item.done} onChange={() => toggle.mutate(item)} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} />
          <span>{item.label}</span>
        </label>
      ))}
    </div>
  );
}

export function StartDayModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const today = meta?.today;
  return (
    <Modal size="small" onClose={onClose}>
      <div className="modal-body">
        <ModalHeader title="Daily prep" onClose={onClose} />
        <p className="hint" style={{ marginTop: 0 }}>Check these off as you go. They feed your progress tracker, and the AI compares your checklist days against your results.</p>
        {today && <ChecklistEditor date={today} />}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Close</button>
        {today && (
          <button className="btn primary" onClick={() => { onClose(); navigate(`/day/${today}`); }}>
            <NotebookPen size={15} /> Open today&apos;s journal
          </button>
        )}
      </div>
    </Modal>
  );
}

export function MoodPicker({ date, mood, moodNote }: { date: string; mood: number | null; moodNote: string }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(mood);
  const [note, setNote] = useState(moodNote);
  useEffect(() => { setValue(mood); setNote(moodNote); }, [date, mood, moodNote]);
  const save = (m: number | null, n: string) => api(`/day/${date}`, { method: 'PUT', json: { mood: m, mood_note: n } }).then(() => qc.invalidateQueries({ queryKey: ['day', date] }));
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
      <b style={{ fontWeight: 500, fontSize: 15 }}>How did today feel?</b>
      <div className="moods">
        {MOODS.map((m) => (
          <button
            key={m.value}
            className={`mood-btn ${value === m.value ? 'on' : ''}`}
            title={m.label}
            aria-label={m.label}
            onClick={() => {
              const next = value === m.value ? null : m.value;
              setValue(next);
              void save(next, note);
            }}
          >
            {m.emoji}
          </button>
        ))}
      </div>
      <input
        className="input grow"
        style={{ minWidth: 200 }}
        placeholder="Add a note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => void save(value, note)}
      />
    </div>
  );
}

export function DayStats({ summary }: { summary: any }) {
  const stat = (k: string, v: string) => (
    <div className="day-stat" key={k}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
  return (
    <div className="day-stats">
      {stat('Total Trades', String(summary.count))}
      {stat('Gross P&L', money(summary.gross))}
      {stat('Winners / Losers', `${summary.wins} / ${summary.losses}`)}
      {stat('Commissions', money(summary.costs))}
      {stat('Win Rate', pct(summary.winRate))}
      {stat('Volume', String(summary.volume))}
      {stat('Profit Factor', profitFactorLabel(summary.profitFactor))}
      {stat('Avg Hold', summary.count ? duration(summary.avgHold) : '—')}
    </div>
  );
}

export function DayModal({ date, onClose }: { date: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { filters } = useFilters();
  const { data } = useQuery<any>({ queryKey: ['day', date, filters.accounts], queryFn: () => api(`/day/${date}${filterQuery({ ...filters, from: '', to: '', status: '' })}`) });

  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const curve = (data?.intraday ?? []).map((p: any, i: number) => ({ i, cum: p.cum }));

  return (
    <Modal onClose={onClose}>
      <div className="modal-body">
        {!data ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <div className="modal-head">
              <div className="modal-title">
                <span>{longDate(date)}</span>
                <span style={{ color: 'var(--faint)' }}>•</span>
                <span className={signClass(data.summary.net)}>Net P&amp;L {money(data.summary.net)}</span>
              </div>
              <button className="btn" onClick={() => go(`/day/${date}`)}>
                <NotebookPen size={15} /> {data.note?.body_text ? 'View note' : 'Add note'}
              </button>
            </div>
            {data.trades.length === 0 ? (
              <div className="empty">
                <h3>No trades on this day</h3>
                You can still journal it.
              </div>
            ) : (
              <>
                <div className="row" style={{ gap: 28, alignItems: 'center', flexWrap: 'wrap', marginBottom: 22 }}>
                  <div style={{ flex: '1 1 380px', minWidth: 280 }}>
                    <EquityArea data={curve} dataKey="cum" xKey="i" height={150} hideX />
                  </div>
                  <div style={{ flex: '1 1 460px' }}>
                    <DayStats summary={data.summary} />
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <MoodPicker date={date} mood={data.mood} moodNote={data.mood_note} />
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Open time</th>
                        <th>Ticker</th>
                        <th>Side</th>
                        <th>Instrument</th>
                        <th>Status</th>
                        <th className="num">Net P&amp;L</th>
                        <th className="num">Net ROI</th>
                        <th className="num">Realized R</th>
                        <th>Strategy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trades.map((t: any) => (
                        <tr key={t.id} className="click" onClick={() => go(`/trades/${t.id}`)}>
                          <td>{t.open_time}</td>
                          <td><span className="sym-pill">{t.symbol}</span><CopyBadge copies={t.copies} /></td>
                          <td>{t.side.toUpperCase()}</td>
                          <td>{t.contract}</td>
                          <td><StatusPill status={t.status} /></td>
                          <td className={`num ${signClass(t.net_pnl)}`}>{money(t.net_pnl)}</td>
                          <td className="num">{t.net_roi < 0 ? `(${Math.abs(t.net_roi).toFixed(2)}%)` : `${t.net_roi.toFixed(2)}%`}</td>
                          <td className="num">{t.r_multiple == null ? '—' : `${t.r_multiple.toFixed(2)}R`}</td>
                          <td>{data.strategies?.[t.strategy_id] ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => go(`/day/${date}`)}>
          <Play size={14} /> View Details
        </button>
      </div>
    </Modal>
  );
}

