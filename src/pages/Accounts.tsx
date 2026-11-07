import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Card, Modal, ModalHeader } from '../components/ui';
import { api, money, signClass, useUi } from '../lib';

function Account({ a, onChange }: { a: any; onChange: () => void }) {
  const [txn, setTxn] = useState({ date: '', amount: '', note: '' });
  const [start, setStart] = useState(String(a.initial_balance));
  const [name, setName] = useState(a.name);
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
        <label className="label">Account name</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={async () => {
            if (!name.trim() || name === a.name) return;
            await api(`/accounts/${a.id}`, { method: 'PUT', json: { name: name.trim() } });
            onChange();
          }}
        />
      </div>
      <div className="field">
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

function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ name: '', broker: 'Topstep', initial_balance: '' });
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/accounts', { method: 'POST', json: { ...form, initial_balance: Number(form.initial_balance) || 0 } });
      onAdded();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal size="small" onClose={onClose}>
      <form onSubmit={(e) => void save(e)}>
        <div className="modal-body">
          <ModalHeader title="Add account" onClose={onClose} />
          <div className="field">
            <label className="label" htmlFor="account-name">Account name</label>
            <input id="account-name" className="input" autoFocus placeholder="Topstep 150K #2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field grow">
              <label className="label" htmlFor="account-broker">Platform</label>
              <select id="account-broker" className="select" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })}>
                <option>Topstep</option>
                <option>Tradovate</option>
                <option>Other</option>
              </select>
            </div>
            <div className="field grow">
              <label className="label" htmlFor="account-balance">Starting balance</label>
              <input id="account-balance" className="input" type="number" placeholder="150000" value={form.initial_balance} onChange={(e) => setForm({ ...form, initial_balance: e.target.value })} />
            </div>
          </div>
          {error && <div className="banner bad" style={{ marginBottom: 0 }}>{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!form.name.trim()}>Add account</button>
        </div>
      </form>
    </Modal>
  );
}

export default function AccountsPage() {
  const qc = useQueryClient();
  const { openImport } = useUi();
  const { data = [] } = useQuery<any[]>({ queryKey: ['accounts'], queryFn: () => api('/accounts/overview') });
  const { data: imports = [] } = useQuery<any[]>({ queryKey: ['imports'], queryFn: () => api('/imports') });
  const refresh = () => void qc.invalidateQueries();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Tracking</div>
          <h1 className="page-title">Trading accounts</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setAdding(true)}><Plus size={15} /> Add account</button>
          <button className="btn primary" onClick={openImport}>Upload trades</button>
        </div>
      </div>
      {adding && <AddAccountModal onClose={() => setAdding(false)} onAdded={refresh} />}
      {data.length === 0 ? (
        <section className="card empty"><h3>No accounts yet</h3>Add one here, or your first upload can create it.</section>
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
