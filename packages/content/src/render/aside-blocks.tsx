/**
 * Aside block components: ProfessionalNote, PracticalStep.
 *
 * Note icons use inline SVGs from the Phosphor icon set since
 * `@phosphor-icons/react` is not a direct dependency of this package.
 * When it is added (listed as a missing dependency), these should
 * migrate to `@nestself/ui` `Icon` with Phosphor components.
 *
 * Uses `aria-labelledby` for asides (item 20) and design-system tokens.
 */
import type { ReactNode } from 'react';

import type { RenderContext } from './context.ts';
import { ContentParagraph } from './text-blocks.tsx';

// ---------------------------------------------------------------------------
// Shared raw-node shape
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (Phosphor Regular weight, 20px)
// ---------------------------------------------------------------------------

function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h24V147.31L90.34,117.66a8,8,0,0,1,11.32-11.32L128,132.69l26.34-26.35a8,8,0,0,1,11.32,11.32L136,147.31V192h24v-6a32.12,32.12,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z" />
    </svg>
  );
}

/** Shared with the editor's note view so both look the same. */
export const NOTE_KIND_ICONS: Record<string, () => ReactNode> = {
  warning: WarningIcon,
  tip: LightbulbIcon,
  disclaimer: InfoIcon,
};

// ---------------------------------------------------------------------------
// ProfessionalNote
// ---------------------------------------------------------------------------

export const NOTE_KIND_STYLES: Record<string, string> = {
  warning: 'border-warning bg-warning-surface',
  tip: 'border-success bg-success-surface',
  disclaimer: 'border-border-control bg-raised',
};

function noteLabel(noteKind: string, ctx: RenderContext): string {
  switch (noteKind) {
    case 'warning': return ctx.labels.noteWarning;
    case 'tip': return ctx.labels.noteTip;
    case 'disclaimer': return ctx.labels.noteDisclaimer;
    default: return ctx.labels.noteDefault;
  }
}

let noteCounter = 0;

export function ProfessionalNote({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const noteKind = typeof node.attrs?.noteKind === 'string' ? node.attrs.noteKind : 'tip';
  const label = noteLabel(noteKind, ctx);
  const styles = NOTE_KIND_STYLES[noteKind] ?? 'border-border-control bg-raised';
  const NoteIcon = NOTE_KIND_ICONS[noteKind];
  const labelId = `note-${++noteCounter}`;

  return (
    <aside
      role="note"
      aria-labelledby={labelId}
      className={`border-l-4 rounded-r-card p-4 mb-4 ${styles}`}
    >
      <p id={labelId} className="text-text type-label mb-2 flex items-center gap-2">
        {NoteIcon ? <NoteIcon /> : null}
        {label}
      </p>
      {node.content?.map((child, i) => (
        <ContentParagraph key={i} node={child} ctx={ctx} />
      ))}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// PracticalStep
// ---------------------------------------------------------------------------

let stepCounter = 0;

export function PracticalStep({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const stepNumber = typeof node.attrs?.stepNumber === 'number' ? node.attrs.stepNumber : 1;
  const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
  const labelId = `step-${++stepCounter}`;

  return (
    <section aria-labelledby={labelId} className="mb-6">
      <div className="flex items-baseline gap-3 mb-2">
        <span
          className="flex-none min-w-7 min-h-7 rounded-full bg-primary text-on-primary type-label flex items-center justify-center"
          aria-hidden="true"
        >
          {stepNumber}
        </span>
        <p id={labelId} className="text-text type-label">{title}</p>
      </div>
      <div className="pl-10">
        {node.content?.map((child, i) => (
          <ContentParagraph key={i} node={child} ctx={ctx} />
        ))}
      </div>
    </section>
  );
}
