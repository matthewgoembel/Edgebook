import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link2, List, ListChecks, ListOrdered,
  Minus, Quote, Redo2, RemoveFormatting, Strikethrough, Underline, Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { uploadImages } from './media';
import { TemplateMenu } from './Templates';
import { Dropdown } from './ui';

interface Props {
  html: string;
  placeholder?: string;
  minHeight?: number;
  /** Stable key for image uploads made while typing, e.g. the day or note id. */
  uploadKey: string;
  onSave: (body: { body_html: string; body_text: string }) => Promise<unknown> | void;
  /** Off when editing a template itself. */
  templates?: boolean;
}

const TEXT_COLORS = ['#616161', '#dc4a4a', '#e8833a', '#c99a06', '#2ea87c', '#2959db', '#6853b5', '#d6409f'];
const HIGHLIGHTS = ['#f0f0f0', '#fcdede', '#fde7cf', '#fff3bf', '#d9f2e6', '#dbe4fa', '#e5dffa', '#fbe0f0'];

/** Plain text for search and the AI, keeping whether each checkbox was ticked. */
function plainText(editor: Editor) {
  return editor.getText({
    textSerializers: {
      taskItem: ({ node }) => `${node.attrs.checked ? '[x]' : '[ ]'} ${node.textContent}`,
      horizontalRule: () => '---',
    },
  });
}

function Swatches({ colors, active, onPick, clearLabel }: { colors: string[]; active?: string; onPick: (color: string | null) => void; clearLabel: string }) {
  return (
    <>
      <div className="swatches">
        {colors.map((c) => (
          <button key={c} type="button" className={`swatch ${active === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => onPick(c)} />
        ))}
      </div>
      <button type="button" className="menu-item" onClick={() => onPick(null)}>{clearLabel}</button>
    </>
  );
}

/** Rich-text editor that autosaves one second after you stop typing. Screenshots can be pasted straight in. */
export function RichEditor({ html, placeholder, minHeight = 180, uploadKey, onSave, templates = true }: Props) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const flush = async (ed: Editor) => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setState('saving');
    await saveRef.current({ body_html: ed.getHTML(), body_text: plainText(ed) });
    setState('saved');
  };

  const addImages = async (files: File[]) => {
    const saved = await uploadImages(files, { type: 'note', key: uploadKey });
    for (const a of saved) editorRef.current?.chain().focus().setImage({ src: `/uploads/${a.stored_name}`, alt: a.filename }).run();
  };

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ link: false }),
      Image,
      Link.configure({ openOnClick: true }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write your thoughts…' }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
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

  if (!editor) return null;
  const b = (active: boolean, run: () => void, icon: React.ReactNode, label: string, disabled = false) => (
    <button type="button" className={active ? 'on' : ''} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run} aria-label={label} title={label}>
      {icon}
    </button>
  );
  const chain = () => editor.chain().focus();

  const setLink = () => {
    const current = editor.getAttributes('link').href as string | undefined;
    const input = window.prompt('Link address', current ?? 'https://');
    if (input === null) return;
    const url = input.trim();
    if (!url || url === 'https://') return void chain().unsetLink().run();
    const href = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
    if (editor.state.selection.empty && !current) chain().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain().extendMarkRange('link').setLink({ href }).run();
  };

  /** Inside a list, the line goes below the whole list so it spans the note. */
  const addDivider = () => {
    const { $from } = editor.state.selection;
    if ($from.depth <= 1) return void chain().setHorizontalRule().run();
    const after = $from.after(1);
    chain().insertContentAt(after, [{ type: 'horizontalRule' }, { type: 'paragraph' }]).setTextSelection(after + 2).run();
  };

  const textColor = editor.getAttributes('textStyle').color as string | undefined;
  const highlight = editor.getAttributes('highlight').color as string | undefined;

  return (
    <div className="editor" style={{ '--editor-min': `${minHeight}px` } as React.CSSProperties}>
      <div className="editor-tools">
        {b(false, () => chain().undo().run(), <Undo2 size={15} />, 'Undo', !editor.can().undo())}
        {b(false, () => chain().redo().run(), <Redo2 size={15} />, 'Redo', !editor.can().redo())}
        <span className="sep" />
        {b(editor.isActive('heading', { level: 2 }), () => chain().toggleHeading({ level: 2 }).run(), <Heading2 size={16} />, 'Large heading')}
        {b(editor.isActive('heading', { level: 3 }), () => chain().toggleHeading({ level: 3 }).run(), <Heading3 size={16} />, 'Small heading')}
        <span className="sep" />
        {b(editor.isActive('bold'), () => chain().toggleBold().run(), <Bold size={15} />, 'Bold')}
        {b(editor.isActive('italic'), () => chain().toggleItalic().run(), <Italic size={15} />, 'Italic')}
        {b(editor.isActive('underline'), () => chain().toggleUnderline().run(), <Underline size={15} />, 'Underline')}
        {b(editor.isActive('strike'), () => chain().toggleStrike().run(), <Strikethrough size={15} />, 'Strikethrough')}
        <Dropdown
          align="left"
          buttonClass="tool"
          menuClass="swatch-menu"
          title="Text color"
          label={<span className="color-tool"><Baseline size={15} /><i style={{ background: textColor ?? '#0d0d0d' }} /></span>}
        >
          {(close) => (
            <Swatches
              colors={TEXT_COLORS}
              active={textColor}
              clearLabel="Default color"
              onPick={(c) => { if (c) chain().setColor(c).run(); else chain().unsetColor().run(); close(); }}
            />
          )}
        </Dropdown>
        <Dropdown
          align="left"
          buttonClass="tool"
          menuClass="swatch-menu"
          title="Highlight"
          label={<span className="color-tool"><Highlighter size={15} /><i style={{ background: highlight ?? 'transparent' }} /></span>}
        >
          {(close) => (
            <Swatches
              colors={HIGHLIGHTS}
              active={highlight}
              clearLabel="No highlight"
              onPick={(c) => { if (c) chain().setHighlight({ color: c }).run(); else chain().unsetHighlight().run(); close(); }}
            />
          )}
        </Dropdown>
        <span className="sep" />
        {b(editor.isActive('bulletList'), () => chain().toggleBulletList().run(), <List size={16} />, 'Bullet list')}
        {b(editor.isActive('orderedList'), () => chain().toggleOrderedList().run(), <ListOrdered size={16} />, 'Numbered list')}
        {b(editor.isActive('taskList'), () => chain().toggleTaskList().run(), <ListChecks size={16} />, 'Checkboxes')}
        {b(editor.isActive('blockquote'), () => chain().toggleBlockquote().run(), <Quote size={15} />, 'Quote')}
        {b(false, addDivider, <Minus size={16} />, 'Divider line')}
        <span className="sep" />
        {b(editor.isActive({ textAlign: 'left' }), () => chain().setTextAlign('left').run(), <AlignLeft size={15} />, 'Align left')}
        {b(editor.isActive({ textAlign: 'center' }), () => chain().setTextAlign('center').run(), <AlignCenter size={15} />, 'Align center')}
        {b(editor.isActive({ textAlign: 'right' }), () => chain().setTextAlign('right').run(), <AlignRight size={15} />, 'Align right')}
        <span className="sep" />
        {b(editor.isActive('link'), setLink, <Link2 size={15} />, 'Link')}
        {b(false, () => fileInput.current?.click(), <ImagePlus size={16} />, 'Insert image')}
        {b(false, () => chain().unsetAllMarks().clearNodes().run(), <RemoveFormatting size={15} />, 'Clear formatting')}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <span className="saved">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}</span>
        {templates && <TemplateMenu editor={editor} />}
      </div>
      <div className="editor-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
