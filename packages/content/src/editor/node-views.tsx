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
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { cn } from '@nestself/ui';
import type { NodeViewLabels } from './node-view-labels.ts';

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
          <select
            value={kind}
            onChange={(e) => updateAttributes({ noteKind: e.target.value })}
            className="type-label rounded-control border border-border-control bg-surface px-2 py-0.5 text-text-secondary"
          >
            {Object.entries(labels.noteKinds).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        ) : (
          <span className="type-label text-text-secondary">
            {labels.noteKinds[kind] ?? kind}
          </span>
        )}
      </div>
      <NodeViewContent className="type-body text-text" />
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
            placeholder={labels.stepTitle}
            className="mb-2 block w-full border-0 bg-transparent p-0 type-label text-text placeholder:text-text-secondary focus:outline-none"
          />
        ) : stepTitle ? (
          <p className="mb-2 type-label text-text">{stepTitle}</p>
        ) : null}
        <NodeViewContent className="type-body text-text" />
      </div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Checklist node view (the list itself)
// ---------------------------------------------------------------------------

export function ChecklistView(_props: ReactNodeViewProps) {
  return (
    <NodeViewWrapper
      as="ul"
      data-type="checklist"
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
      <NodeViewContent className="type-body text-text flex-1" />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// CTA node view (atom)
// ---------------------------------------------------------------------------

const CTA_KINDS = ['suggest_topic', 'open_content', 'open_collection', 'open_service'] as const;

export function CtaView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const ctaKind = (node.attrs.ctaKind as string) ?? 'suggest_topic';
  const label = (node.attrs.label as string) ?? null;
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  return (
    <NodeViewWrapper
      as="div"
      data-type="cta"
      className="my-4 rounded-control border border-border-subtle bg-surface-raised p-4"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 items-center justify-center rounded-control bg-primary px-4 text-on-primary type-label">
          {label || labels.ctaKinds[ctaKind] || ctaKind.replace(/_/g, ' ')}
        </div>
        {editable ? (
          <div className="flex flex-col gap-2">
            <select
              value={ctaKind}
              onChange={(e) => updateAttributes({ ctaKind: e.target.value })}
              className="type-metadata rounded-control border border-border-control bg-surface px-2 py-1 text-text-secondary"
            >
              {CTA_KINDS.map((k) => (
                <option key={k} value={k}>
                  {labels.ctaKinds[k] || k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={label ?? ''}
              onChange={(e) => updateAttributes({ label: e.target.value || null })}
              placeholder={labels.ctaLabelPlaceholder}
              maxLength={100}
              className="type-metadata rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
            />
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// RelatedResource node view (atom)
// ---------------------------------------------------------------------------

export function RelatedResourceView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const resourceId = (node.attrs.contentResourceId as string) ?? null;
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  return (
    <NodeViewWrapper
      as="div"
      data-type="relatedResource"
      className="my-3 rounded-control border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-center gap-3">
        <span className="type-label text-text-secondary">{labels.relatedSearch}:</span>
        {editable ? (
          <input
            type="text"
            value={resourceId ?? ''}
            onChange={(e) => updateAttributes({ contentResourceId: e.target.value || null })}
            placeholder={labels.relatedSearch}
            className="flex-1 type-body rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
          />
        ) : (
          <span className="type-body text-text">{resourceId || labels.relatedEmpty}</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Image node view (atom)
// ---------------------------------------------------------------------------

export function ImageView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const assetId = (node.attrs.mediaAssetId as string) ?? null;
  const alt = (node.attrs.alt as string) ?? '';
  const caption = (node.attrs.caption as string) ?? '';
  const editable = editor.isEditable;
  const labels = getLabels(editor);

  return (
    <NodeViewWrapper
      as="figure"
      data-type="image"
      className="my-4"
    >
      {assetId ? (
        <div
          className="flex min-h-[200px] items-center justify-center rounded-control bg-surface-raised text-text-secondary"
          role="img"
          aria-label={alt || 'Image'}
        >
          <span className="type-metadata">[Image: {assetId}]</span>
        </div>
      ) : (
        <div className="flex min-h-[120px] items-center justify-center rounded-control border-2 border-dashed border-border-control bg-surface text-text-secondary">
          <span className="type-body">{labels.imagePlaceholder}</span>
        </div>
      )}
      {editable ? (
        <div className="mt-2 flex flex-col gap-2">
          <input
            type="text"
            value={alt}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
            placeholder={labels.imageAlt}
            required
            className="type-metadata rounded-control border border-border-control bg-surface px-2 py-1 text-text placeholder:text-text-secondary"
          />
          <input
            type="text"
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
