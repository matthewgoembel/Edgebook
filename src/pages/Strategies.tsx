import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card, Modal, ModalHeader } from '../components/ui';
import { api, money, pct, profitFactorLabel, signClass } from '../lib';

export default function StrategiesPage() {
  const qc = useQueryClient();
  const { data = [] } = useQuery<any[]>({ queryKey: ['strategies'], queryFn: () => api('/strategies') });
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['strategies'] });
    await qc.invalidateQueries({ queryKey: ['meta'] });
  };
  const save = async () => {
    setError('');
    try {
      if (editing.id) await api(`/strategies/${editing.id}`, { method: 'PUT', json: editing });
      else await api('/strategies', { method: 'POST', json: editing });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Tracking</div>
          <h1 className="page-title">Strategies</h1>
        </div>
        <button className="btn primary" onClick={() => setEditing({ name: '', description: '', rules: '' })}><Plus size={15} /> New strategy</button>
      </div>
      {data.length === 0 ? (
        <section className="card empty">
          <h3>No strategies yet</h3>
          Write down your setups and rules, then assign them to trades to see which ones really pay.
        </section>
      ) : (
        <div className="grid-3" style={{ marginTop: 0 }}>
          {data.map((s) => (
            <Card key={s.id} title={s.name} right={<button className="btn small" onClick={() => setEditing(s)}>Edit</button>}>
              <p className="hint" style={{ marginTop: 0 }}>{s.description || 'No description.'}</p>
              <div className="kv"><span>Net P&amp;L</span><span className={signClass(s.stats.net)}>{money(s.stats.net)}</span></div>
              <div className="kv"><span>Trades</span><span>{s.stats.count}</span></div>
              <div className="kv"><span>Win rate</span><span>{pct(s.stats.winRate)}</span></div>
              <div className="kv"><span>Profit factor</span><span>{profitFactorLabel(s.stats.profitFactor)}</span></div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <Modal size="small" onClose={() => setEditing(null)}>
          <div className="modal-body">
            <ModalHeader title={editing.id ? 'Edit strategy' : 'New strategy'} onClose={() => setEditing(null)} />
            <div className="field"><label className="label">Name</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="field"><label className="label">Description</label><textarea className="input" rows={3} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
            <div className="field"><label className="label">Rules</label><textarea className="input" rows={6} value={editing.rules} onChange={(e) => setEditing({ ...editing, rules: e.target.value })} /></div>
            {error && <div className="banner bad">{error}</div>}
          </div>
          <div className="modal-foot">
            {editing.id && (
              <button
                className="btn danger"
                style={{ marginRight: 'auto' }}
                onClick={async () => {
                  if (!confirm('Delete this strategy? Trades keep their other data.')) return;
                  await api(`/strategies/${editing.id}`, { method: 'DELETE' });
                  setEditing(null);
                  await refresh();
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn primary" onClick={() => void save()}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}
