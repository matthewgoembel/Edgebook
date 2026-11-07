import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, Loading } from '../components/ui';
import { api } from '../lib';

function ChecklistSettings() {
  const qc = useQueryClient();
  const { data } = useQuery<any[]>({ queryKey: ['checklistItems'], queryFn: () => api('/checklist/items') });
  const [items, setItems] = useState<{ id?: number; label: string }[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setItems(data); }, [data]);
  const save = async () => {
    await api('/checklist/items', { method: 'PUT', json: { items } });
    await qc.invalidateQueries();
    setSaved(true);
  };
  return (
    <Card title="Daily checklist">
      {items.map((item, i) => (
        <div className="row" key={item.id ?? `new-${i}`} style={{ marginBottom: 8 }}>
          <input
            className="input"
            value={item.label}
            aria-label="Checklist item"
            onChange={(e) => { setSaved(false); setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))); }}
          />
          <button className="arrow" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove item"><Trash2 size={15} /></button>
        </div>
      ))}
      <div className="row">
        <button className="btn" onClick={() => setItems([...items, { label: '' }])}><Plus size={14} /> Add item</button>
        <button className="btn primary" onClick={() => void save()}>Save checklist</button>
        {saved && <span className="hint">Saved</span>}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: meta } = useQuery<any>({ queryKey: ['meta'], queryFn: () => api('/meta') });
  const { data: session } = useQuery<any>({ queryKey: ['session'], queryFn: () => api('/session') });
  const signOut = async () => {
    await api('/logout', { method: 'POST' });
    window.location.href = '/';
  };
  const [form, setForm] = useState<any>(null);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (meta && !form) setForm(meta.settings); }, [meta]);
  if (!form) return <Loading />;

  const save = async (patch: Record<string, unknown>) => {
    setForm({ ...form, ...patch });
    await api('/settings', { method: 'PUT', json: patch });
    await qc.invalidateQueries();
  };
  const testKey = async () => {
    setMessage(null);
    try {
      if (key) {
        await api('/settings', { method: 'PUT', json: { ai_api_key: key } });
        setKey('');
        await qc.invalidateQueries();
      }
      const res = await api('/settings/test-ai', { method: 'POST' });
      setMessage({ ok: true, text: `Connected to ${res.model}.` });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">App</div>
          <h1 className="page-title">Settings</h1>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <Card title="Journal">
            <div className="field">
              <label className="label">Break-even range ($)</label>
              <input className="input" type="number" value={form.be_threshold} onChange={(e) => setForm({ ...form, be_threshold: e.target.value })} onBlur={(e) => void save({ be_threshold: e.target.value })} />
              <div className="hint" style={{ marginTop: 5 }}>
                Trades inside plus or minus this amount count as BE, not wins or losses. To match TradeZella, use the same value you set there.
              </div>
            </div>
            <div className="field">
              <label className="label">Evening trades go on</label>
              <select className="select" value={form.day_mode} onChange={(e) => void save({ day_mode: e.target.value })}>
                <option value="calendar">The calendar date they opened (like TradeZella)</option>
                <option value="session">Topstep&apos;s trading day (rolls over at 6pm ET)</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Same trade in several accounts</label>
              <select className="select" value={form.merge_copies ? '1' : '0'} onChange={(e) => void save({ merge_copies: e.target.value })}>
                <option value="1">Count as one trade with combined P&amp;L</option>
                <option value="0">Count separately in each account</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label">Time zone</label>
              <input className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} onBlur={(e) => void save({ timezone: e.target.value })} />
              <div className="hint" style={{ marginTop: 5 }}>Applies to new imports.</div>
            </div>
          </Card>
          <ChecklistSettings />
          <Card title="Your data">
            <p className="hint" style={{ marginTop: 0 }}>
              The app keeps daily backups on the server, but download your own copy now and then. This file holds your trades, notes and reports; screenshots are not included.
            </p>
            <div className="row">
              <a className="btn" href="/api/backup">Download backup</a>
              {session?.required && <button className="btn" onClick={() => void signOut()}>Sign out</button>}
            </div>
          </Card>
        </div>
        <Card title="Edge AI">
          <div className="field">
            <label className="label">Claude API key {meta.settings.has_ai_key && <span className="pos">(saved)</span>}</label>
            <div className="row">
              <input className="input" type="password" autoComplete="off" placeholder={meta.settings.has_ai_key ? 'Enter a new key to replace it' : 'Paste your key here'} value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn" disabled={!key && !meta.settings.has_ai_key} onClick={() => void testKey()}>{key ? 'Save & test' : 'Test'}</button>
            </div>
            <div className="hint" style={{ marginTop: 5 }}>
              Create one at console.anthropic.com under API Keys. It is stored in your journal database. API usage is billed separately from a Claude subscription.
            </div>
            {message && <div className={`banner ${message.ok ? 'ok' : 'bad'}`} style={{ marginTop: 10, marginBottom: 0 }}>{message.text}</div>}
          </div>
          <div className="field">
            <label className="label">Model</label>
            <select className="select" value={form.ai_model} onChange={(e) => void save({ ai_model: e.target.value })}>
              <option value="claude-opus-5-5">Claude Opus 5.5 (best analysis)</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (about half the cost)</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest, lighter analysis)</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Depth</label>
            <select className="select" value={form.ai_effort} onChange={(e) => void save({ ai_effort: e.target.value })}>
              <option value="medium">Standard</option>
              <option value="high">Deep</option>
              <option value="xhigh">Deepest (slower, costs more)</option>
            </select>
          </div>
          <div className="hint">
            When you run a report, your trades, notes and screenshots are sent to the Claude API. Nothing is sent unless you run a report or ask a question. Each report shows what it cost.
          </div>
        </Card>
      </div>
    </>
  );
}
