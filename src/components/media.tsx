import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { api } from '../lib';

export interface Attachment {
  id: number;
  kind: string;
  stored_name: string;
  filename: string;
  caption: string;
}

export async function uploadImages(files: File[], owner: { type: string; key: string; kind?: string }) {
  const body = new FormData();
  files.forEach((f) => body.append('files', f));
  body.append('owner_type', owner.type);
  body.append('owner_key', owner.key);
  body.append('kind', owner.kind ?? 'other');
  return api<Attachment[]>('/attachments', { method: 'POST', body });
}

function imagesFrom(list: FileList | DataTransferItemList | null) {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null;
    if (file && file.type.startsWith('image/')) out.push(file);
  }
  return out;
}

const LABEL: Record<string, string> = { chart: 'Chart', executions: 'My trades', other: 'Screenshot' };

export function Slot({ title, hint, owner, onDone }: { title: string; hint: string; owner: { type: string; key: string; kind: string }; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      await uploadImages(files, owner);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`shot-slot ${drag ? 'drag' : ''}`}
      tabIndex={0}
      role="button"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      onPaste={(e: ClipboardEvent) => void send(imagesFrom(e.clipboardData.items))}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); void send(imagesFrom(e.dataTransfer.files)); }}
    >
      <ImagePlus size={24} />
      <div className="shot-title">{busy ? 'Uploading…' : title}</div>
      <div className="hint">{hint}</div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void send(imagesFrom(e.target.files)); e.target.value = ''; }} />
    </div>
  );
}

export function ScreenshotGrid({ attachments, ownerType, ownerKey, onChange }: { attachments: Attachment[]; ownerType: string; ownerKey: string; onChange: () => void }) {
  const [big, setBig] = useState<string | null>(null);
  const remove = async (id: number) => {
    if (!confirm('Delete this screenshot?')) return;
    await api(`/attachments/${id}`, { method: 'DELETE' });
    onChange();
  };
  const has = (kind: string) => attachments.some((a) => a.kind === kind);
  return (
    <>
      <div className="shots">
        {attachments.map((a) => (
          <div className="shot" key={a.id}>
            <img src={`/uploads/${a.stored_name}`} alt={a.caption || a.filename} onClick={() => setBig(a.stored_name)} />
            <span className="shot-label">{LABEL[a.kind] ?? 'Screenshot'}</span>
            <button className="shot-del" onClick={() => void remove(a.id)} aria-label="Delete screenshot">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!has('chart') && <Slot title="Chart" hint="Click, drop, or click here and paste with Ctrl+V" owner={{ type: ownerType, key: ownerKey, kind: 'chart' }} onDone={onChange} />}
        {!has('executions') && <Slot title="My trades" hint="The chart with your entries and exits" owner={{ type: ownerType, key: ownerKey, kind: 'executions' }} onDone={onChange} />}
        {has('chart') && has('executions') && <Slot title="Add another" hint="Any other screenshot from today" owner={{ type: ownerType, key: ownerKey, kind: 'other' }} onDone={onChange} />}
      </div>
      {big && (
        <div className="lightbox" onClick={() => setBig(null)}>
          <img src={`/uploads/${big}`} alt="Full-size screenshot" />
        </div>
      )}
    </>
  );
}
