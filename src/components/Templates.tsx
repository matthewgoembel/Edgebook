import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { FilePlus2, LayoutTemplate, Plus, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib';
import { RichEditor } from './Editor';
import { Dropdown, Modal, ModalHeader } from './ui';

interface Template {
  id: number;
  name: string;
  body_html: string;
}

const useTemplates = () => useQuery<Template[]>({ queryKey: ['templates'], queryFn: () => api('/templates') });

function SaveTemplateModal({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      // A template is a fresh start, so boxes ticked in this note come through unticked.
      const body_html = editor.getHTML().replace(/data-checked="true"/g, 'data-checked="false"').replace(/ checked="checked"/g, '');
      await api('/templates', { method: 'POST', json: { name, body_html } });
      await qc.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal size="small" onClose={onClose}>
      <form onSubmit={(e) => void save(e)}>
        <div className="modal-body">
          <ModalHeader title="Save as template" onClose={onClose} />
          <div className="field">
            <label className="label" htmlFor="template-name">Template name</label>
            <input id="template-name" className="input" autoFocus placeholder="NFP day plan" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="hint">This saves everything currently in this note, including its layout and checkboxes.</div>
          {error && <div className="banner bad" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()}>Save template</button>
        </div>
      </form>
    </Modal>
  );
}

function ManageTemplatesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: templates = [] } = useTemplates();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];
  const [name, setName] = useState('');
  useEffect(() => setName(selected?.name ?? ''), [selected?.id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });
  const create = async () => {
    const { id } = await api('/templates', { method: 'POST', json: { name: 'Untitled template', body_html: '' } });
    await refresh();
    setSelectedId(id);
  };
  const rename = async () => {
    if (!selected || !name.trim() || name.trim() === selected.name) return;
    await api(`/templates/${selected.id}`, { method: 'PUT', json: { name: name.trim() } });
    await refresh();
  };
  const remove = async () => {
    if (!selected || !confirm(`Delete the "${selected.name}" template? Notes already using it won't change.`)) return;
    await api(`/templates/${selected.id}`, { method: 'DELETE' });
    setSelectedId(null);
    await refresh();
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-body">
        <ModalHeader title="Templates" onClose={onClose} />
        <div className="template-manager">
          <div className="template-list">
            {templates.map((t) => (
              <button type="button" key={t.id} className={`nb-folder ${selected?.id === t.id ? 'on' : ''}`} onClick={() => setSelectedId(t.id)}>
                <LayoutTemplate size={15} /> {t.name}
              </button>
            ))}
            <button type="button" className="btn small" style={{ margin: 10 }} onClick={() => void create()}><Plus size={13} /> New template</button>
          </div>
          <div className="grow">
            {selected ? (
              <>
                <div className="row" style={{ marginBottom: 12 }}>
                  <input className="input" aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} />
                  <button type="button" className="btn danger" onClick={() => void remove()}><Trash2 size={14} /> Delete</button>
                </div>
                <RichEditor
                  key={selected.id}
                  html={selected.body_html}
                  uploadKey={`template-${selected.id}`}
                  minHeight={300}
                  templates={false}
                  placeholder="Build your template here"
                  onSave={async ({ body_html }) => {
                    await api(`/templates/${selected.id}`, { method: 'PUT', json: { body_html } });
                    await refresh();
                  }}
                />
              </>
            ) : (
              <div className="empty"><h3>No templates yet</h3>Create one to reuse it in any note.</div>
            )}
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

/** Lives in every editor's toolbar: insert a template, save the note as one, or manage them. */
export function TemplateMenu({ editor }: { editor: Editor }) {
  const { data: templates = [] } = useTemplates();
  const [dialog, setDialog] = useState<'save' | 'manage' | null>(null);
  return (
    <>
      <Dropdown buttonClass="tool templates-tool" label={<><LayoutTemplate size={15} /> Templates</>}>
        {(close) => (
          <>
            {templates.length > 0 && <div className="hint" style={{ padding: '4px 10px' }}>Insert</div>}
            {templates.map((t) => (
              <button
                type="button"
                key={t.id}
                className="menu-item"
                onClick={() => {
                  editor.chain().focus().insertContent(t.body_html).run();
                  close();
                }}
              >
                {t.name}
              </button>
            ))}
            {templates.length > 0 && <div className="nav-divider" />}
            <button type="button" className="menu-item" disabled={editor.isEmpty} onClick={() => { setDialog('save'); close(); }}>
              <FilePlus2 size={15} /> Save this note as a template
            </button>
            <button type="button" className="menu-item" onClick={() => { setDialog('manage'); close(); }}>
              <Settings2 size={15} /> Create and edit templates
            </button>
          </>
        )}
      </Dropdown>
      {dialog === 'save' && createPortal(<SaveTemplateModal editor={editor} onClose={() => setDialog(null)} />, document.body)}
      {dialog === 'manage' && createPortal(<ManageTemplatesModal onClose={() => setDialog(null)} />, document.body)}
    </>
  );
}
