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
import { useEffect, useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { Select, cn } from '@nestself/ui';
import { NOTE_KIND_ICONS, NOTE_KIND_STYLES } from '../render/aside-blocks.tsx';
import { DEFAULT_NODE_VIEW_LABELS, type NodeViewLabels } from './node-view-labels.ts';
import { openBlockDialog } from './BlockDialogs.tsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read translated labels from editor storage, falling back to English. */
function getLabels(editor: ReactNodeViewProps['editor']): NodeViewLabels {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tiptap storage is untyped
  const stored = (editor.storage as any)?.nodeViewLabels?.labels as NodeViewLabels | undefined;
  return stored ?? DEFAULT_NODE_VIEW_LABELS;
}

// ---------------------------------------------------------------------------
// ProfessionalNote node view
// ---------------------------------------------------------------------------

export function ProfessionalNoteView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const kind = (node.attrs.noteKind as string) ?? 'tip';
  const editable = editor.isEditable;
  const labels = getLabels(editor);
  const Icon = NOTE_KIND_ICONS[kind] ?? NOTE_KIND_ICONS.tip!;

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
        <span className="text-text-secondary">
          <Icon />
        </span>
        {editable ? (
          <Select
            aria-label={labels.noteType}
            value={kind}
            onValueChange={(v) => { if (v) updateAttributes({ noteKind: v }); }}
            options={Object.entries(labels.noteKinds).map(([value, label]) => ({ value, label }))}
            className="min-h-9 w-auto type-label"
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
// CTA node view (atom). Configured in a dialog (BlockDialogs.tsx).
// ---------------------------------------------------------------------------

export function CtaView({ node, editor, getPos }: ReactNodeViewProps) {
  const ctaKind = (node.attrs.ctaKind as string) ?? 'suggest_topic';
  const targetId = (node.attrs.targetId as string | null) ?? null;
  const label = (node.attrs.label as string | null) ?? null;
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  const edit = () => {
    const pos = getPos();
    if (!editable || typeof pos !== 'number') return;
    openBlockDialog(editor, { type: 'cta', pos, attrs: { ctaKind, targetId, label } });
  };

  return (
    <NodeViewWrapper as="div" data-type="cta" className="my-4">
      <button
        type="button"
        disabled={!editable}
        aria-label={`${labels.ctaDialog}: ${label || labels.ctaKinds[ctaKind] || ctaKind}`}
        onClick={edit}
        className="flex min-h-11 w-full items-center justify-center rounded-control bg-primary px-4 text-on-primary type-label transition-colors hover:bg-primary-hover disabled:cursor-default"
      >
        {label || labels.ctaKinds[ctaKind] || ctaKind}
      </button>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// RelatedResource node view (atom). Picked in a dialog (BlockDialogs.tsx).
// ---------------------------------------------------------------------------

export function RelatedResourceView({ node, editor, getPos }: ReactNodeViewProps) {
  const resourceId = (node.attrs.contentResourceId as string | null) ?? null;
  const storedTitle = (node.attrs.contentResourceTitle as string | null) ?? null;
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  const edit = () => {
    const pos = getPos();
    if (!editable || typeof pos !== 'number') return;
    openBlockDialog(editor, {
      type: 'related',
      pos,
      attrs: resourceId ? { contentResourceId: resourceId, contentResourceTitle: storedTitle } : undefined,
    });
  };

  return (
    <NodeViewWrapper as="div" data-type="relatedResource" className="my-3">
      <button
        type="button"
        disabled={!editable}
        onClick={edit}
        className="flex w-full flex-col items-start gap-0.5 rounded-control border border-border-subtle bg-surface p-4 text-left transition-colors hover:bg-tint disabled:cursor-default"
      >
        <span className="type-metadata text-text-secondary">{labels.relatedDialog}</span>
        <span className="type-label text-text">{storedTitle || labels.relatedChoose}</span>
      </button>
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
          setStatusText(labels.imageUploading);
        }

        const result = await uploadHandler(file, (status) => {
          if (!cancelled) setStatusText(status);
        });

        if (!cancelled) {
          setPreviewUrl(result.previewUrl || blobUrl);
          setPhase('ready');
          updateAttributes({ mediaAssetId: result.assetId });
        }
      } catch {
        if (!cancelled) {
          setPhase('error');
          setErrorMsg(labels.imageUploadFailed);
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
          <span className="type-body">{statusText || labels.imageUploading}</span>
        </div>
      ) : null}

      {/* Error message */}
      {phase === 'error' ? (
        <div role="alert" className="flex min-h-[120px] items-center justify-center rounded-control border border-danger bg-danger-surface text-danger">
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
            aria-label={labels.imageAlt}
            value={alt}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
            placeholder={labels.imageAlt}
            className="type-metadata rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
          />
          <input
            type="text"
            aria-label={labels.imageCaption}
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
