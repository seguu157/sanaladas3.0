import React, { useEffect, useRef, useState } from 'react';
import { Bold, Underline as UnderlineIcon } from 'lucide-react';
import DOMPurify from 'dompurify';

interface Props {
  initialHtml?: string;
  placeholder?: string;
  onSubmit: (html: string) => void;
  onCancel: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['b', 'u', 'br'],
  ALLOWED_ATTR: [],
};

const sanitizeHtml = (raw: string): string =>
  DOMPurify.sanitize(raw ?? '', SANITIZE_CONFIG);

const sanitizeFragment = (raw: string): DocumentFragment =>
  DOMPurify.sanitize(raw ?? '', {
    ...SANITIZE_CONFIG,
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;

const RichCommentEditor: React.FC<Props> = ({
  initialHtml = '',
  placeholder = 'Escribe un comentario...',
  onSubmit,
  onCancel,
  submitLabel = 'Guardar',
  autoFocus = true,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    node.replaceChildren(sanitizeFragment(initialHtml));
    setIsEmpty(node.textContent?.trim().length === 0);
    if (autoFocus) {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      node.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFormat = (command: 'bold' | 'underline') => {
    document.execCommand(command);
    editorRef.current?.focus();
  };

  const handleInput = () => {
    const node = editorRef.current;
    if (!node) return;
    setIsEmpty(node.textContent?.trim().length === 0);
  };

  const handleSubmit = () => {
    const node = editorRef.current;
    if (!node) return;
    const raw = node.innerHTML;
    const clean = sanitizeHtml(raw);
    if (!clean.replace(/<[^>]+>/g, '').trim()) return;
    onSubmit(clean);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border border-amber-200 rounded-lg bg-white overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-amber-100 bg-amber-50">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            applyFormat('bold');
          }}
          className="p-1.5 rounded hover:bg-amber-200 text-slate-700 transition-colors"
          title="Negrita (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            applyFormat('underline');
          }}
          className="p-1.5 rounded hover:bg-amber-200 text-slate-700 transition-colors"
          title="Subrayado (Ctrl+U)"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto text-[10px] text-slate-500 hidden sm:inline">
          Enter = nueva línea · Ctrl+Enter = guardar
        </span>
      </div>

      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          className="min-h-[80px] px-3 py-2 text-sm sm:text-base text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 focus:ring-inset whitespace-pre-wrap break-words"
        />
        {isEmpty && (
          <div className="pointer-events-none absolute top-2 left-3 text-slate-400 text-sm sm:text-base select-none">
            {placeholder}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-2 py-2 border-t border-amber-100 bg-amber-50">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-md text-slate-700 hover:bg-slate-100 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isEmpty}
          className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
};

export default RichCommentEditor;
