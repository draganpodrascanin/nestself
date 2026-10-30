/**
 * React node views for the Notion-style content editor (T-C1.12, Phase B).
 *
 * Each custom block node that needs interactive behavior in the editor
 * gets a React node view here. Atom nodes (Image, CTA, RelatedResource)
 * render entirely as React; content nodes (ProfessionalNote, PracticalStep,
 * Checklist) wrap editable content via `<NodeViewContent />`.
 *
 * All styling uses semantic tokens from `@nestself/ui` and `packages/tokens`.
 * No hex literals.
 *
 * Labels come from `editor.storage.nodeViewLabels.labels`
 * (the `NodeViewLabelsExtension` in editor-extensions.ts). English fallbacks
 * are provided when the storage is missing so the views render stand-alone.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { cn } from '@nestself/ui';
import type { NodeViewLabels } from './node-view-labels.ts';

// ---------------------------------------------------------------------------
// Inline select for node views (no portal, no Base UI focus management)
// ---------------------------------------------------------------------------

interface InlineSelectProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  'aria-label': string;
}

/**
 * A minimal accessible select that renders options in-place (no portal).
 * Uses role="combobox" / role="option" so Playwright can click options.
 */
function InlineSelect({ value, options, onChange, 'aria-label': ariaLabel }: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const selected = options.find((o) => o.value === value);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const pick = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
    },
    [onChange],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        onClick={toggle}
        className="type-label rounded-control border border-border-control bg-surface px-2 py-0.5 text-text-secondary inline-flex items-center gap-1"
      >
        {selected?.label ?? value}
        <span aria-hidden className="text-[10px]">&#x25BE;</span>
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 min-w-[120px] rounded-control border border-border-subtle bg-surface py-1 shadow-menu"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              role="option"
              type="button"
              aria-selected={opt.value === value}
              className={cn(
                'block w-full px-3 py-1.5 text-left type-label',
                opt.value === value ? 'bg-tint font-[var(--font-weight-label)]' : 'hover:bg-tint',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read translated labels from editor storage, falling back to English. */
function getLabels(editor: ReactNodeViewProps['editor']): NodeViewLabels {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tiptap storage is untyped
  const stored = (editor.storage as any)?.nodeViewLabels?.labels as NodeViewLabels | undefined;
  if (stored) return stored;
  // English fallback so views still render in isolation (tests, storybook)
  return {
    noteKinds: { tip: 'Tip', warning: 'Warning', disclaimer: 'Disclaimer' },
    stepTitle: 'Step title',
    checklistLabel: '',
    ctaKinds: { suggest_topic: 'Suggest topic', open_content: 'Open content', open_collection: 'Open collection', open_service: 'Open service' },
    ctaLabelPlaceholder: 'Button label (optional, max 100)',
    relatedSearch: 'Resource ID',
    relatedEmpty: '(none)',
    imageAlt: 'Alt text (required)',
    imageCaption: 'Caption (optional)',
    imagePlaceholder: 'Drop or paste an image, or click to upload',
  };
}

// ---------------------------------------------------------------------------
// ProfessionalNote node view
// ---------------------------------------------------------------------------

/**
 * Valid note kinds per schema (blocks.ts:307): 'warning' | 'tip' | 'disclaimer'.
 * 'info' is NOT in the schema and must not appear.
 */
const NOTE_KIND_ICONS: Record<string, string> = {
  tip: '✨',         // sparkles
  warning: '⚠',     // warning sign
  disclaimer: '⚖',  // scales
};

const NOTE_KIND_STYLES: Record<string, string> = {
  tip: 'border-l-primary bg-primary/5',
  warning: 'border-l-warning bg-warning/5',
  disclaimer: 'border-l-text-secondary bg-surface-raised',
};

export function ProfessionalNoteView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const kind = (node.attrs.noteKind as string) ?? 'tip';
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  return (
    <NodeViewWrapper
      as="aside"
      data-type="professionalNote"
      data-note-kind={kind}
      className={cn(
        'my-3 rounded-control border-l-4 p-4',
        NOTE_KIND_STYLES[kind] ?? NOTE_KIND_STYLES.tip,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg" aria-hidden>
          {NOTE_KIND_ICONS[kind] ?? NOTE_KIND_ICONS.tip}
        </span>
        {editable ? (
          <InlineSelect
            aria-label="Note type"
            value={kind}
            onChange={(v) => updateAttributes({ noteKind: v })}
            options={Object.entries(labels.noteKinds).map(([value, label]) => ({ value, label }))}
          />
        ) : (
          <span className="type-label text-text-secondary">
            {labels.noteKinds[kind] ?? kind}
          </span>
        )}
      </div>
      <NodeViewContent contentEditable className="type-body text-text" />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// PracticalStep node view
// ---------------------------------------------------------------------------

export function PracticalStepView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const stepNumber = (node.attrs.stepNumber as number) ?? 1;
  const stepTitle = (node.attrs.title as string) ?? '';
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  return (
    <NodeViewWrapper
      as="div"
      data-type="practicalStep"
      className="my-3 flex gap-4 rounded-control border border-border-subtle bg-surface p-4"
    >
      {/* Step number badge */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary type-label">
        {stepNumber}
      </div>
      <div className="flex-1 min-w-0">
        {/* Editable step title */}
        {editable ? (
          <input
            type="text"
            value={stepTitle}
            onChange={(e) => updateAttributes({ title: e.target.value })}
            aria-label={labels.stepTitle}
            placeholder={labels.stepTitle}
            className="mb-2 block w-full border-0 bg-transparent p-0 type-label text-text placeholder:text-text-secondary focus:outline-none"
          />
        ) : stepTitle ? (
          <p className="mb-2 type-label text-text">{stepTitle}</p>
        ) : null}
        <NodeViewContent contentEditable className="type-body text-text" />
      </div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Checklist node view (the list itself)
// ---------------------------------------------------------------------------

export function ChecklistView({ node }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper
      as="ul"
      data-type="checklist"
      data-single={node.childCount === 1 ? '' : undefined}
      className="my-3 list-none space-y-1 pl-0"
    >
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// ChecklistItem node view
// ---------------------------------------------------------------------------

export function ChecklistItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const label = (node.attrs.label as string) ?? '';
  const isChecked = label.startsWith('[x]');
  const editable = editor.isEditable;

  const toggleCheck = () => {
    if (!editable) return;
    if (isChecked) {
      updateAttributes({ label: label.replace(/^\[x\]\s*/, '') });
    } else {
      updateAttributes({ label: `[x] ${label}` });
    }
  };

  return (
    <NodeViewWrapper
      as="li"
      data-type="checklistItem"
      className="flex items-start gap-2 py-0.5"
    >
      <input
        type="checkbox"
        checked={isChecked}
        onChange={toggleCheck}
        disabled={!editable}
        className="mt-1 h-4 w-4 shrink-0 rounded border-border-control accent-primary"
      />
      <NodeViewContent contentEditable className="type-body text-text flex-1" />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Resource search combobox (shared by CTA and RelatedResource)
// ---------------------------------------------------------------------------

interface ResourceComboboxProps {
  'aria-label': string;
  onSelect: (id: string, title: string) => void;
  editor: ReactNodeViewProps['editor'];
}

/** Read the resource search handler from editor storage. */
function getSearchHandler(editor: ReactNodeViewProps['editor']) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tiptap storage is untyped
  return (editor.storage as any)?.resourceSearch?.handler as
    | ((q: string) => Promise<Array<{ id: string; title: string }>>)
    | undefined;
}

function ResourceCombobox({ 'aria-label': ariaLabel, onSelect, editor }: ResourceComboboxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; title: string }>>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const comboBaseId = useId();
  const comboListboxId = `${comboBaseId}-listbox`;

  const search = getSearchHandler(editor);

  // Debounced search
  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!value.trim() || !search) {
        setResults([]);
        setOpen(false);
        return;
      }
      timerRef.current = setTimeout(async () => {
        try {
          const items = await search(value.trim());
          setResults(items);
          setOpen(items.length > 0);
        } catch {
          setResults([]);
          setOpen(false);
        }
      }, 200);
    },
    [search],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={comboListboxId}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        className="w-full type-body rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
        placeholder="Search..."
      />
      {open && (
        <ul
          id={comboListboxId}
          role="listbox"
          className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 max-h-48 w-full overflow-auto rounded-control border border-border-subtle bg-surface py-1 shadow-menu"
        >
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="block w-full px-3 py-1.5 text-left type-body hover:bg-tint"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(r.id, r.title);
                  setQuery(r.title);
                  setOpen(false);
                }}
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CTA node view (atom)
// ---------------------------------------------------------------------------

const CTA_KINDS = ['suggest_topic', 'open_content', 'open_collection', 'open_service'] as const;
const NEEDS_TARGET = new Set(['open_content', 'open_collection', 'open_service']);

export function CtaView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const ctaKind = (node.attrs.ctaKind as string) ?? 'suggest_topic';
  const targetId = (node.attrs.targetId as string) ?? null;
  const label = (node.attrs.label as string) ?? null;
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  // Dialog open on insert (when no targetId yet) or when the user clicks the block
  const [dialogOpen, setDialogOpen] = useState(editable && !targetId);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);

  // Local state for the dialog form
  const [formKind, setFormKind] = useState(ctaKind);
  const [formLabel, setFormLabel] = useState(label ?? '');
  const [formTargetId, setFormTargetId] = useState<string | null>(targetId);

  const handleDone = useCallback(() => {
    const attrs: Record<string, unknown> = {
      ctaKind: formKind,
      label: formLabel || null,
    };
    if (NEEDS_TARGET.has(formKind) && formTargetId) {
      attrs.targetId = formTargetId;
    }
    updateAttributes(attrs);
    setDialogOpen(false);
  }, [formKind, formLabel, formTargetId, updateAttributes]);

  return (
    <NodeViewWrapper
      as="div"
      data-type="cta"
      className="my-4 rounded-control border border-border-subtle bg-surface-raised p-4"
    >
      <div
        role="button"
        tabIndex={editable ? 0 : undefined}
        className="flex h-10 items-center justify-center rounded-control bg-primary px-4 text-on-primary type-label cursor-pointer"
        onClick={() => { if (editable) setDialogOpen(true); }}
        onKeyDown={(e) => { if (editable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDialogOpen(true); } }}
      >
        {label || labels.ctaKinds[ctaKind] || ctaKind.replace(/_/g, ' ')}
      </div>

      {dialogOpen ? (
        <div
          role="dialog"
          aria-label="Call to action"
          className="mt-3 rounded-control border border-border-subtle bg-surface p-4 shadow-menu"
        >
          <div className="flex flex-col gap-3">
            {/* Action kind select */}
            <div>
              <InlineSelect
                aria-label="Action"
                value={formKind}
                onChange={(v) => {
                  setFormKind(v);
                  if (!NEEDS_TARGET.has(v)) {
                    setFormTargetId(null);
                  }
                }}
                options={CTA_KINDS.map((k) => ({
                  value: k,
                  label: labels.ctaKinds[k] || k.replace(/_/g, ' '),
                }))}
              />
            </div>

            {/* Content search (only for kinds that need a target) */}
            {NEEDS_TARGET.has(formKind) ? (
              <ResourceCombobox
                aria-label="Content"
                editor={editor}
                onSelect={(id, title) => {
                  setFormTargetId(id);
                  setSelectedTitle(title);
                }}
              />
            ) : null}

            {/* Button label */}
            <input
              type="text"
              aria-label="Button label"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder={labels.ctaLabelPlaceholder}
              maxLength={100}
              className="type-metadata rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
            />

            <button
              type="button"
              onClick={handleDone}
              className="self-end rounded-control bg-primary px-4 py-1.5 text-on-primary type-label hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
      {selectedTitle && !dialogOpen ? (
        <p className="mt-1 type-metadata text-text-secondary">{selectedTitle}</p>
      ) : null}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// RelatedResource node view (atom)
// ---------------------------------------------------------------------------

export function RelatedResourceView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const resourceId = (node.attrs.contentResourceId as string) ?? null;
  const storedTitle = (node.attrs.contentResourceTitle as string) ?? null;
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  // Dialog open on insert (when no resourceId) or on click
  const [dialogOpen, setDialogOpen] = useState(editable && !resourceId);

  return (
    <NodeViewWrapper
      as="div"
      data-type="relatedResource"
      className="my-3 rounded-control border border-border-subtle bg-surface p-4"
    >
      <div
        role="button"
        tabIndex={editable ? 0 : undefined}
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => { if (editable && !dialogOpen) setDialogOpen(true); }}
        onKeyDown={(e) => { if (editable && !dialogOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDialogOpen(true); } }}
      >
        <span className="type-label text-text-secondary">{labels.relatedSearch}:</span>
        <span className="type-body text-text">{storedTitle || resourceId || labels.relatedEmpty}</span>
      </div>

      {dialogOpen ? (
        <div
          role="dialog"
          aria-label="Related resource"
          className="mt-3 rounded-control border border-border-subtle bg-surface p-4 shadow-menu"
        >
          <ResourceCombobox
            aria-label="Content"
            editor={editor}
            onSelect={(id, title) => {
              updateAttributes({ contentResourceId: id, contentResourceTitle: title });
              setDialogOpen(false);
            }}
          />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Image node view — pending file queue
// ---------------------------------------------------------------------------

/**
 * Module-level queue for the file selected by the slash menu "Image" command.
 *
 * The slash menu command creates a hidden `<input type="file">`, clicks it
 * (which fires the Playwright `filechooser` event), and stores a promise
 * here that resolves when the user selects a file.  The ImageView node view
 * consumes the promise on mount to start the upload.
 *
 * This avoids running the file-picker logic inside a React useEffect, which
 * breaks under React 19 StrictMode (double mount → cleanup removes the
 * input before the change event fires).
 */
let _pendingFile: Promise<File | null> | null = null;

/**
 * Open a file picker and return a promise for the selected file.
 * Called from the slash menu "Image" command (outside React).
 */
export function openImagePicker(): Promise<File | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.style.display = 'none';
  document.body.appendChild(input);

  const promise = new Promise<File | null>((resolve) => {
    input.addEventListener(
      'change',
      () => {
        resolve(input.files?.[0] ?? null);
        input.remove();
      },
      { once: true },
    );
    // If the dialog is cancelled (no change event), resolve null after a timeout.
    // Most browsers don't fire a cancel event on file inputs, so we rely on the
    // ImageView component to handle the "idle" → no file case.
  });

  _pendingFile = promise;
  input.click();
  return promise;
}

/**
 * Consume the pending file promise.  Returns null if no pick is pending.
 * The caller is responsible for clearing the promise after use.
 */
export function consumePendingImageFile(): Promise<File | null> | null {
  return _pendingFile;
}

/** Clear the pending file after successful consumption. */
function clearPendingImageFile(): void {
  _pendingFile = null;
}

// ---------------------------------------------------------------------------
// Image node view (atom)
// ---------------------------------------------------------------------------

type ImagePhase = 'idle' | 'picking' | 'uploading' | 'processing' | 'ready' | 'error';

/** Read the image upload handler from editor storage. */
function getUploadHandler(editor: ReactNodeViewProps['editor']) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tiptap storage is untyped
  return (editor.storage as any)?.imageUpload?.handler as
    | ((file: File, onStatus: (s: string) => void) => Promise<{ assetId: string; previewUrl: string }>)
    | undefined;
}

export function ImageView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const assetId = (node.attrs.mediaAssetId as string) ?? null;
  const alt = (node.attrs.alt as string) ?? '';
  const caption = (node.attrs.caption as string) ?? '';
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  const [phase, setPhase] = useState<ImagePhase>(assetId ? 'ready' : 'idle');
  const [statusText, setStatusText] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Consume the pending file on mount (set by slash menu openImagePicker).
  //
  // StrictMode-safe: the pending promise is NOT cleared until the upload
  // starts.  In strict mode, the first mount's effect is cancelled (the
  // cleanup sets `cancelled = true` before the awaited promise resolves),
  // but the promise stays available for the second mount's effect.
  useEffect(() => {
    if (assetId || !editable) return;

    const pending = consumePendingImageFile();
    if (!pending) return;

    let cancelled = false;

    (async () => {
      const file = await pending;
      if (cancelled || !file) return;

      // Clear the module-level promise now that we have the file and are
      // the active (non-cancelled) mount.
      clearPendingImageFile();

      const uploadHandler = getUploadHandler(editor);
      if (!uploadHandler) {
        // No handler — show local blob preview only
        const url = URL.createObjectURL(file);
        if (!cancelled) {
          setPreviewUrl(url);
          setPhase('ready');
        }
        return;
      }

      const blobUrl = URL.createObjectURL(file);

      try {
        if (!cancelled) {
          setPhase('uploading');
          setStatusText('Uploading');
        }

        const result = await uploadHandler(file, (status) => {
          if (!cancelled) setStatusText(status);
        });

        if (!cancelled) {
          setPreviewUrl(result.previewUrl || blobUrl);
          setPhase('ready');
          updateAttributes({ mediaAssetId: result.assetId });
        }
      } catch (err) {
        if (!cancelled) {
          setPhase('error');
          setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
          setPreviewUrl(blobUrl);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once on mount; assetId/editable are fixed for this node view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the node already has a mediaAssetId on mount (reload/conflict
  // resolution), build the preview URL from the ops endpoint.
  const displayUrl = previewUrl ?? (assetId ? `/api/ops/cms/media/${assetId}/original` : null);

  const isUploading = phase === 'uploading' || phase === 'processing';

  return (
    <NodeViewWrapper
      as="figure"
      data-type="image"
      data-phase={phase}
      data-error={errorMsg || undefined}
      className="my-4"
    >
      {/* Status text during upload/processing */}
      {isUploading ? (
        <div className="flex min-h-[120px] items-center justify-center rounded-control border border-border-subtle bg-surface-raised text-text-secondary">
          <span className="type-body">{statusText || 'Uploading'}</span>
        </div>
      ) : null}

      {/* Error message */}
      {phase === 'error' ? (
        <div className="flex min-h-[120px] items-center justify-center rounded-control border border-warning bg-warning/5 text-warning">
          <span className="type-body">{errorMsg}</span>
        </div>
      ) : null}

      {/* Image element (shown when ready or when assetId exists) */}
      {(phase === 'ready' || (assetId && !isUploading)) && displayUrl ? (
        <img
          src={displayUrl}
          alt={alt}
          className="mx-auto max-h-[400px] rounded-control object-contain"
        />
      ) : null}

      {/* Placeholder when idle and no assetId */}
      {phase === 'idle' && !assetId ? (
        <div className="flex min-h-[120px] items-center justify-center rounded-control border-2 border-dashed border-border-control bg-surface text-text-secondary">
          <span className="type-body">{labels.imagePlaceholder}</span>
        </div>
      ) : null}

      {/* Alt text and caption inputs */}
      {editable ? (
        <div className="mt-2 flex flex-col gap-2">
          <input
            type="text"
            aria-label="Alt text"
            value={alt}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
            placeholder={labels.imageAlt}
            className="type-metadata rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
          />
          <input
            type="text"
            aria-label="Caption"
            value={caption}
            onChange={(e) => updateAttributes({ caption: e.target.value || null })}
            placeholder={labels.imageCaption}
            className="type-metadata rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
          />
        </div>
      ) : (
        <>
          {caption ? (
            <figcaption className="mt-1 type-metadata text-text-secondary text-center">
              {caption}
            </figcaption>
          ) : null}
        </>
      )}
    </NodeViewWrapper>
  );
}
