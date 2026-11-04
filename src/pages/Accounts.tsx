import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/ui';
import { api, money, signClass, useUi } from '../lib';

function Account({ a, onChange }: { a: any; onChange: () => void }) {
  const [txn, setTxn] = useState({ date: '', amount: '', note: '' });
  const [start, setStart] = useState(String(a.initial_balance));
  const [error, setError] = useState('');
  const addTxn = async () => {
    setError('');
    try {
      await api(`/accounts/${a.id}/txns`, { method: 'POST', json: txn });
      setTxn({ date: '', amount: '', note: '' });
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card
      title={a.name}
      right={
        <button
          className="btn small danger"
          onClick={async () => {
            if (!confirm(`Delete ${a.name} and its ${a.trades} trades? This cannot be undone.`)) return;
            await api(`/accounts/${a.id}`, { method: 'DELETE' });
            onChange();
          }}
        >
          <Trash2 size={13} /> Delete
        </button>
      }
    >
      <div className="kv"><span>Balance</span><span>{money(a.balance)}</span></div>
      <div className="kv"><span>Net P&amp;L</span><span className={signClass(a.net)}>{money(a.net)}</span></div>
      <div className="kv"><span>Trades / days</span><span>{a.trades} / {a.days}</span></div>
      <div className="kv"><span>Last trade</span><span>{a.lastTrade ?? '—'}</span></div>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="label">Starting balance</label>
        <input
          className="input"
          type="number"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={async () => {
            await api(`/accounts/${a.id}`, { method: 'PUT', json: { initial_balance: Number(start) || 0 } });
            onChange();
          }}
        />
      </div>
      <label className="label">Deposits and payouts</label>
      {a.txns.map((t: any) => (
        <div className="row" key={t.id} style={{ padding: '4px 0' }}>
          <span className="grow hint">{t.date} {t.note}</span>
          <span className={signClass(t.amount)}>{money(t.amount)}</span>
          <button className="arrow" onClick={() => void api(`/txns/${t.id}`, { method: 'DELETE' }).then(onChange)} aria-label="Delete entry"><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input" type="date" value={txn.date} onChange={(e) => setTxn({ ...txn, date: e.target.value })} aria-label="Date" />
        <input className="input" type="number" placeholder="-5000" value={txn.amount} onChange={(e) => setTxn({ ...txn, amount: e.target.value })} aria-label="Amount" />
        <button className="btn" onClick={() => void addTxn()}>Add</button>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>Use a negative amount for a payout.</div>
      {error && <div className="banner bad" style={{ marginTop: 8 }}>{error}</div>}
    </Card>
  );
}

export default function AccountsPage() {
  const qc = useQueryClient();
  const { openImport } = useUi();
  const { data = [] } = useQuery<any[]>({ queryKey: ['accounts'], queryFn: () => api('/accounts/overview') });
  const { data: imports = [] } = useQuery<any[]>({ queryKey: ['imports'], queryFn: () => api('/imports') });
  const refresh = () => void qc.invalidateQueries();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Tracking</div>
          <h1 className="page-title">Trading accounts</h1>
        </div>
        <button className="btn primary" onClick={openImport}><Plus size={15} /> Upload trades</button>
      </div>
      {data.length === 0 ? (
        <section className="card empty"><h3>No accounts yet</h3>Your first upload creates one.</section>
      ) : (
        <div className="grid-3" style={{ marginTop: 0 }}>
          {data.map((a) => <Account key={a.id} a={a} onChange={refresh} />)}
        </div>
      )}
      {imports.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><div className="card-title">Import history</div></div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Imported</th><th>Account</th><th>File</th><th className="num">Added</th><th className="num">Skipped</th><th /></tr></thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td>{new Date(`${i.created_at.replace(' ', 'T')}Z`).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>{i.account}</td>
                    <td>{i.filename}</td>
                    <td className="num">{i.rows_added}</td>
                    <td className="num">{i.rows_skipped}</td>
                    <td className="num">
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (!confirm(`Undo this import? It removes ${i.rows_added} trades and their notes.`)) return;
                          await api(`/imports/${i.id}`, { method: 'DELETE' });
                          refresh();
                        }}
                      >
                        Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
