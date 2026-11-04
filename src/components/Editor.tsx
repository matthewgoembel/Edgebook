import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading3, ImagePlus, Italic, List, ListOrdered, Quote, Strikethrough } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { uploadImages } from './media';

interface Props {
  html: string;
  placeholder?: string;
  minHeight?: number;
  /** Stable key for image uploads made while typing, e.g. the day or note id. */
  uploadKey: string;
  onSave: (body: { body_html: string; body_text: string }) => Promise<unknown> | void;
  insertHtml?: { html: string; nonce: number } | null;
}

/** Rich-text editor that autosaves one second after you stop typing. Screenshots can be pasted straight in. */
export function RichEditor({ html, placeholder, minHeight = 180, uploadKey, onSave, insertHtml }: Props) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const flush = async (ed: { getHTML(): string; getText(): string }) => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setState('saving');
    await saveRef.current({ body_html: ed.getHTML(), body_text: ed.getText() });
    setState('saved');
  };

  const addImages = async (files: File[]) => {
    const saved = await uploadImages(files, { type: 'note', key: uploadKey });
    for (const a of saved) editorRef.current?.chain().focus().setImage({ src: `/uploads/${a.stored_name}`, alt: a.filename }).run();
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Image,
      Link.configure({ openOnClick: true }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write your thoughts…' }),
    ],
    content: html,
    onUpdate: ({ editor: ed }) => {
      dirty.current = true;
      setState('idle');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(ed), 1000);
    },
    onBlur: ({ editor: ed }) => void flush(ed),
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        void addImages(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        void addImages(files);
        return true;
      },
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Save anything pending when leaving the page.
  useEffect(() => () => { if (editorRef.current) void flush(editorRef.current); }, []);

  useEffect(() => {
    if (insertHtml && editor) {
      editor.chain().focus('end').insertContent(insertHtml.html).run();
    }
  }, [insertHtml?.nonce]);

  if (!editor) return null;
  const b = (active: boolean, run: () => void, icon: React.ReactNode, label: string) => (
    <button type="button" className={active ? 'on' : ''} onClick={run} aria-label={label} title={label}>
      {icon}
    </button>
  );
  const chain = () => editor.chain().focus();

  return (
    <div className="editor" style={{ '--editor-min': `${minHeight}px` } as React.CSSProperties}>
      <div className="editor-tools">
        {b(editor.isActive('bold'), () => chain().toggleBold().run(), <Bold size={15} />, 'Bold')}
        {b(editor.isActive('italic'), () => chain().toggleItalic().run(), <Italic size={15} />, 'Italic')}
        {b(editor.isActive('strike'), () => chain().toggleStrike().run(), <Strikethrough size={15} />, 'Strikethrough')}
        <span className="sep" />
        {b(editor.isActive('heading', { level: 3 }), () => chain().toggleHeading({ level: 3 }).run(), <Heading3 size={16} />, 'Heading')}
        {b(editor.isActive('bulletList'), () => chain().toggleBulletList().run(), <List size={16} />, 'Bullet list')}
        {b(editor.isActive('orderedList'), () => chain().toggleOrderedList().run(), <ListOrdered size={16} />, 'Numbered list')}
        {b(editor.isActive('blockquote'), () => chain().toggleBlockquote().run(), <Quote size={15} />, 'Quote')}
        <span className="sep" />
        {b(false, () => fileInput.current?.click(), <ImagePlus size={16} />, 'Insert image')}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <span className="saved">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}</span>
      </div>
      <div className="editor-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
