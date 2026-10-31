/**
 * Checklist block component.
 *
 * Uses `@nestself/ui` `Checkbox` with the visible text as its label
 * (no overriding `aria-label`). Target size follows the design system
 * (min-h-12 from Checkbox).
 *
 * State reset: the parent `ContentRenderer` passes `documentKey` as the
 * React key on the Checklist wrapper, so state never leaks between documents
 * (item 13). This is verified by the interactive tests.
 */
import { Checkbox } from '@nestself/ui';
import { useState } from 'react';

import type { RenderContext } from './context.ts';
import { renderInlineNodes } from './inline.tsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// ChecklistItem
// ---------------------------------------------------------------------------

function ChecklistItemComponent({
  node,
  ctx,
  checked,
  onToggle,
}: {
  node: RawNode;
  ctx: RenderContext;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  const label = typeof node.attrs?.label === 'string' ? node.attrs.label : '';
  return (
    <li className="flex items-start gap-0 py-0.5 list-none">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
      >
        <span className={`type-body ${checked ? 'line-through text-text-secondary' : 'text-text'}`}>
          {renderInlineNodes(node.content as unknown[] | undefined, ctx) ?? label}
        </span>
      </Checkbox>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export function Checklist({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const items = node.content ?? [];
  const [checked, setChecked] = useState<boolean[]>(() =>
    new Array(items.length).fill(false) as boolean[],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list role when list-style:none; explicit role restores it
    <ul role="list" aria-label={ctx.labels.checklist} className="mb-4 space-y-0.5">
      {items.map((item, i) => (
        <ChecklistItemComponent
          key={i}
          node={item}
          ctx={ctx}
          checked={checked[i] ?? false}
          onToggle={(v) => {
            setChecked((prev) => {
              const next = [...prev];
              next[i] = v;
              return next;
            });
          }}
        />
      ))}
    </ul>
  );
}
