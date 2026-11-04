import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenText, Folder, FolderPlus, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RichEditor } from '../components/Editor';
import { api, money, signClass } from '../lib';

function NoteEditor({ id, folders, templates, onDeleted }: { id: number; folders: any[]; templates: any[]; onDeleted: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: note } = useQuery<any>({ queryKey: ['note', id], queryFn: () => api(`/notes/${id}`), staleTime: 0, gcTime: 0 });
  const [title, setTitle] = useState('');
  const [insert, setInsert] = useState<{ html: string; nonce: number } | null>(null);
  useEffect(() => { if (note) setTitle(note.title); }, [note?.id]);
  if (!note) return null;

  const put = async (json: Record<string, unknown>) => {
    await api(`/notes/${id}`, { method: 'PUT', json });
    await qc.invalidateQueries({ queryKey: ['notes'] });
    await qc.invalidateQueries({ queryKey: ['folders'] });
  };

  return (
    <>
      <div style={{ padding: '16px 20px 10px' }}>
        <input className="nb-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== note.title && void put({ title })} aria-label="Note title" />
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <select className="select" style={{ width: 170 }} value={note.folder_id ?? ''} onChange={(e) => void put({ folder_id: Number(e.target.value) })} aria-label="Folder">
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="select" style={{ width: 170 }} value="" aria-label="Insert template" onChange={(e) => {
            const t = templates.find((x) => String(x.id) === e.target.value);
            if (t) setInsert({ html: t.body_html, nonce: Date.now() });
          }}>
            <option value="">Insert template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className={`btn small ${note.pinned ? 'primary' : ''}`} onClick={() => void put({ pinned: !note.pinned }).then(() => qc.invalidateQueries({ queryKey: ['note', id] }))}><Pin size={13} /> {note.pinned ? 'Pinned' : 'Pin'}</button>
          {note.type === 'day' && <button className="btn small" onClick={() => navigate(`/day/${note.date}`)}>Open day</button>}
          {note.trade_id && <button className="btn small" onClick={() => navigate(`/trades/${note.trade_id}`)}>Open trade</button>}
          <button
            className="btn small danger"
            onClick={async () => {
              if (!confirm('Delete this note?')) return;
              await api(`/notes/${id}`, { method: 'DELETE' });
              await qc.invalidateQueries({ queryKey: ['notes'] });
              await qc.invalidateQueries({ queryKey: ['folders'] });
              onDeleted();
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '0 20px 20px', display: 'flex' }}>
        <div className="grow" style={{ display: 'flex' }}>
          <div className="grow">
            <RichEditor
              key={id}
              html={note.body_html}
              uploadKey={`note-${id}`}
              minHeight={380}
              insertHtml={insert}
              onSave={(body) => put(body)}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export default function NotebookPage() {
  const qc = useQueryClient();
  const [folder, setFolder] = useState<number | 'all' | 'pinned'>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const { data: folders = [] } = useQuery<any[]>({ queryKey: ['folders'], queryFn: () => api('/folders') });
  const { data: templates = [] } = useQuery<any[]>({ queryKey: ['templates'], queryFn: () => api('/templates') });
  const query = new URLSearchParams();
  if (typeof folder === 'number') query.set('folder', String(folder));
  if (folder === 'pinned') query.set('pinned', '1');
  if (q) query.set('q', q);
  const { data: notes = [] } = useQuery<any[]>({ queryKey: ['notes', folder, q], queryFn: () => api(`/notes?${query}`) });

  useEffect(() => {
    if (selected === null && notes.length) setSelected(notes[0].id);
  }, [notes, selected]);

  const addNote = async () => {
    const body: Record<string, unknown> = {};
    if (typeof folder === 'number') body.folder_id = folder;
    const { id } = await api('/notes', { method: 'POST', json: body });
    await qc.invalidateQueries({ queryKey: ['notes'] });
    await qc.invalidateQueries({ queryKey: ['folders'] });
    setSelected(id);
  };
  const addFolder = async () => {
    const name = prompt('Folder name');
    if (!name) return;
    await api('/folders', { method: 'POST', json: { name } });
    await qc.invalidateQueries({ queryKey: ['folders'] });
  };

  const f = (key: number | 'all' | 'pinned', name: string, count?: number, icon = <Folder size={16} />) => (
    <button key={key} className={`nb-folder ${folder === key ? 'on' : ''}`} onClick={() => { setFolder(key); setSelected(null); }}>
      {icon} {name} {count !== undefined && <span className="ct">{count}</span>}
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Journal</div>
          <h1 className="page-title">Notebook</h1>
        </div>
        <button className="btn primary" onClick={() => void addNote()}><Plus size={15} /> New note</button>
      </div>
      <section className="card notebook">
        <div className="nb-col">
          <div style={{ paddingTop: 8 }}>
            {f('all', 'All notes', undefined, <BookOpenText size={16} />)}
            {f('pinned', 'Pinned', undefined, <Pin size={16} />)}
          </div>
          <div className="nb-section">
            Folders
            <button className="arrow" onClick={() => void addFolder()} aria-label="New folder"><FolderPlus size={15} /></button>
          </div>
          {folders.map((x) => f(x.id, x.name, x.count))}
        </div>
        <div className="nb-col">
          <div style={{ padding: 10, position: 'sticky', top: 0, background: '#fff', zIndex: 1, borderBottom: '1px solid var(--line)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--faint)' }} />
              <input className="input" style={{ paddingLeft: 30 }} placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {notes.length === 0 && <div className="empty">No notes here yet.</div>}
          {notes.map((n) => (
            <button key={n.id} className={`nb-note ${selected === n.id ? 'on' : ''}`} onClick={() => setSelected(n.id)}>
              <div className="t">
                <span>{n.title || 'Untitled'}</span>
                {n.net != null && <span className={signClass(n.net)}>{money(n.net, { cents: false })}</span>}
              </div>
              <div className="p">{n.preview || 'Empty note'}</div>
              <div className="d">{new Date(`${n.updated_at.replace(' ', 'T')}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            </button>
          ))}
        </div>
        <div className="nb-col">
          {selected ? (
            <NoteEditor key={selected} id={selected} folders={folders} templates={templates} onDeleted={() => setSelected(null)} />
          ) : (
            <div className="empty" style={{ margin: 'auto' }}><h3>Pick a note or start a new one</h3>Day and trade notes appear here automatically.</div>
          )}
        </div>
      </section>
    </>
  );
}
