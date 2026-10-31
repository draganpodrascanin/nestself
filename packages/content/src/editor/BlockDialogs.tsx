/**
 * Configuration dialogs for the call-to-action and related-resource blocks.
 *
 * Both blocks carry a target that the document schema requires, so the
 * editor never inserts them half-configured: the slash command and a click
 * on an existing block open a dialog, and the node is inserted or updated
 * only when the author confirms (FMT-R-27). Escape or Cancel leaves the
 * document unchanged.
 *
 * The dialogs use `Dialog` from `@nestself/ui` (Base UI, animated through the
 * dialog and backdrop presets) and its `Field` / `Select` / `Input`. The
 * resource picker is an ARIA combobox whose listbox animates through the
 * popover preset. Labels come from the editor's node-view labels.
 *
 * Colour: semantic tokens only.
 */
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import {
  AnimatePresence,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  Input,
  MotionFeatures,
  Select,
  cn,
  m,
  useMotionPreset,
} from '@nestself/ui';
import { CONTENT_CAPABILITIES } from '@nestself/contracts';
import type {
  NodeViewLabels,
  ResourceSearchHandler,
  ResourceSearchResult,
} from './node-view-labels.ts';

// ---------------------------------------------------------------------------
// Opening a dialog from the slash menu or a node view
// ---------------------------------------------------------------------------

export const BLOCK_DIALOG_EVENT = 'nestself:block-dialog';

export type CtaKindOption = 'suggest_topic' | 'open_content' | 'open_collection' | 'open_service';

export interface CtaAttrs {
  ctaKind: string;
  targetId: string | null;
  label: string | null;
}

export interface RelatedAttrs {
  contentResourceId: string;
  contentResourceTitle: string | null;
}

export type BlockDialogRequest =
  | { type: 'cta'; pos: number | null; attrs?: CtaAttrs }
  | { type: 'related'; pos: number | null; attrs?: RelatedAttrs };

/**
 * Ask the editor's dialog host to open a block dialog. `pos` is the position
 * of an existing node to update, or `null` to insert at the selection.
 */
export function openBlockDialog(editor: Editor, request: BlockDialogRequest): void {
  editor.view.dom.dispatchEvent(new CustomEvent(BLOCK_DIALOG_EVENT, { detail: request }));
}

const CTA_KIND_OPTIONS: CtaKindOption[] = [
  'suggest_topic',
  'open_content',
  'open_collection',
  'open_service',
];
const SEARCH_DEBOUNCE_MS = 200;

// ---------------------------------------------------------------------------
// Resource picker (combobox)
// ---------------------------------------------------------------------------

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: ResourceSearchResult[] }
  | { status: 'error' };

interface ResourcePickerProps {
  label: string;
  labels: NodeViewLabels;
  search: ResourceSearchHandler | undefined;
  /** Only offer results of this type (for example `collection`). */
  type?: string;
  selected: ResourceSearchResult | null;
  onSelect: (result: ResourceSearchResult) => void;
  error?: string;
}

export function ResourcePicker({
  label,
  labels,
  search,
  type,
  selected,
  onSelect,
  error,
}: ResourcePickerProps) {
  const [query, setQuery] = useState(selected?.title ?? '');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const [activeIndex, setActiveIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const popupMotion = useMotionPreset('popover');

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const results =
    state.status === 'done' ? state.results.filter((r) => !type || r.type === type) : [];
  const open = state.status !== 'idle';

  const runSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setActiveIndex(0);
      if (timer.current) clearTimeout(timer.current);
      const q = value.trim();
      if (!q || !search) {
        setState({ status: 'idle' });
        return;
      }
      setState({ status: 'loading' });
      const id = ++request.current;
      timer.current = setTimeout(() => {
        search(q).then(
          (items) => {
            if (id === request.current) setState({ status: 'done', results: items });
          },
          () => {
            if (id === request.current) setState({ status: 'error' });
          },
        );
      }, SEARCH_DEBOUNCE_MS);
    },
    [search],
  );

  const choose = (result: ResourceSearchResult) => {
    setQuery(result.title);
    setState({ status: 'idle' });
    onSelect(result);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      choose(results[activeIndex]);
    } else if (e.key === 'Escape') {
      // Close the list, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      setState({ status: 'idle' });
    }
  };

  const status =
    state.status === 'loading'
      ? labels.searching
      : state.status === 'error'
        ? labels.searchError
        : state.status === 'done' && results.length === 0
          ? labels.searchEmpty
          : null;

  return (
    <Field label={label} id={baseId} error={error} required>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open && results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
          }
          aria-invalid={error ? true : undefined}
          value={query}
          placeholder={labels.searchPlaceholder}
          onChange={(e) => runSearch(e.target.value)}
          onKeyDown={onKeyDown}
          className={cn(
            'min-h-11 px-3 w-full rounded-control border border-border-control bg-surface type-body text-text',
            'placeholder:text-text-secondary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        />
        <MotionFeatures>
          <AnimatePresence>
            {open ? (
              <m.div
                key="results"
                data-picker-results=""
                {...popupMotion}
                className="left-0 right-0 mt-1 max-h-56 py-1 absolute top-full z-[var(--z-dropdown)] overflow-auto rounded-control border border-border-subtle bg-surface shadow-menu"
              >
                <ul id={listboxId} role="listbox" aria-label={label}>
                  {results.map((r, i) => (
                    // Keyboard selection runs on the combobox input (aria-activedescendant).
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                    <li
                      key={r.id}
                      id={`${listboxId}-${i}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      className={cn(
                        'px-3 py-2 cursor-pointer type-body text-text',
                        i === activeIndex ? 'bg-tint' : 'hover:bg-tint',
                      )}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(r)}
                    >
                      {r.title}
                    </li>
                  ))}
                </ul>
                {status ? (
                  <p
                    role={state.status === 'error' ? 'alert' : 'status'}
                    className={cn(
                      'px-3 py-2 type-metadata',
                      state.status === 'error' ? 'text-danger' : 'text-text-secondary',
                    )}
                  >
                    {status}
                  </p>
                ) : null}
              </m.div>
            ) : null}
          </AnimatePresence>
        </MotionFeatures>
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Call to action dialog
// ---------------------------------------------------------------------------

interface CtaDialogProps {
  open: boolean;
  initial: CtaAttrs | undefined;
  initialTitle: string | null;
  labels: NodeViewLabels;
  search: ResourceSearchHandler | undefined;
  onConfirm: (attrs: CtaAttrs, targetTitle: string | null) => void;
  onClose: () => void;
}

function CtaForm({
  initial,
  initialTitle,
  labels,
  search,
  onConfirm,
  onClose,
}: Omit<CtaDialogProps, 'open'>) {
  const [kind, setKind] = useState<string>(initial?.ctaKind ?? 'open_content');
  const [target, setTarget] = useState<ResourceSearchResult | null>(
    initial?.targetId && initial.ctaKind !== 'open_service'
      ? { id: initial.targetId, title: initialTitle ?? '' }
      : null,
  );
  const [service, setService] = useState<string | null>(
    initial?.ctaKind === 'open_service' ? initial.targetId : null,
  );
  const [label, setLabel] = useState(initial?.label ?? '');
  const [showErrors, setShowErrors] = useState(false);

  const targetId =
    kind === 'open_service' ? service : kind === 'suggest_topic' ? null : (target?.id ?? null);
  const missingTarget = kind !== 'suggest_topic' && !targetId;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missingTarget) {
      setShowErrors(true);
      return;
    }
    const trimmed = label.trim();
    onConfirm(
      { ctaKind: kind, targetId, label: trimmed === '' ? null : trimmed },
      kind === 'open_service' ? null : (target?.title ?? null),
    );
  };

  const targetError = showErrors && missingTarget ? labels.ctaTargetRequired : undefined;

  return (
    <form noValidate onSubmit={submit} className="gap-4 flex flex-col">
      <Field label={labels.ctaAction} required>
        <Select
          aria-label={labels.ctaAction}
          value={kind}
          onValueChange={(v) => {
            if (!v) return;
            setKind(v);
            setShowErrors(false);
          }}
          options={CTA_KIND_OPTIONS.map((k) => ({ value: k, label: labels.ctaKinds[k] ?? k }))}
        />
      </Field>
      {kind === 'open_content' || kind === 'open_collection' ? (
        <ResourcePicker
          key={kind}
          label={kind === 'open_content' ? labels.ctaContent : labels.ctaCollection}
          labels={labels}
          search={search}
          type={kind === 'open_collection' ? 'collection' : undefined}
          selected={target}
          onSelect={setTarget}
          error={targetError}
        />
      ) : null}
      {kind === 'open_service' ? (
        <Field label={labels.ctaService} required error={targetError}>
          <Select
            aria-label={labels.ctaService}
            value={service ?? undefined}
            placeholder={labels.ctaService}
            onValueChange={(v) => setService(v)}
            options={CONTENT_CAPABILITIES.map((c) => ({
              value: c,
              label: labels.ctaServices[c] ?? c,
            }))}
          />
        </Field>
      ) : null}
      <Field label={labels.ctaButtonLabel} description={labels.ctaButtonLabelHint}>
        <Input value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <DialogActions>
        <Button type="button" variant="secondary" onClick={onClose}>
          {labels.cancel}
        </Button>
        <Button type="submit">{labels.done}</Button>
      </DialogActions>
    </form>
  );
}

export function CtaDialog({ open, onClose, labels, ...rest }: CtaDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent title={labels.ctaDialog} closeLabel={labels.close}>
        {open ? <CtaForm labels={labels} onClose={onClose} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Related resource dialog
// ---------------------------------------------------------------------------

interface RelatedDialogProps {
  open: boolean;
  initial: RelatedAttrs | undefined;
  labels: NodeViewLabels;
  search: ResourceSearchHandler | undefined;
  onConfirm: (attrs: RelatedAttrs) => void;
  onClose: () => void;
}

export function RelatedDialog({
  open,
  initial,
  labels,
  search,
  onConfirm,
  onClose,
}: RelatedDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent title={labels.relatedDialog} closeLabel={labels.close}>
        {open ? (
          <ResourcePicker
            label={labels.ctaContent}
            labels={labels}
            search={search}
            selected={
              initial
                ? { id: initial.contentResourceId, title: initial.contentResourceTitle ?? '' }
                : null
            }
            onSelect={(r) => onConfirm({ contentResourceId: r.id, contentResourceTitle: r.title })}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Host: listens for requests and applies the result to the document
// ---------------------------------------------------------------------------

interface BlockDialogsProps {
  editor: Editor;
  labels: NodeViewLabels;
  search: ResourceSearchHandler | undefined;
}

type OpenRequest = BlockDialogRequest & { insertAt: number };

export function BlockDialogs({ editor, labels, search }: BlockDialogsProps) {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [ctaTitle, setCtaTitle] = useState<string | null>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<BlockDialogRequest>).detail;
      setRequest({ ...detail, insertAt: editor.state.selection.from });
    };
    dom.addEventListener(BLOCK_DIALOG_EVENT, onRequest);
    return () => dom.removeEventListener(BLOCK_DIALOG_EVENT, onRequest);
  }, [editor]);

  const apply = useCallback(
    (type: 'cta' | 'relatedResource', attrs: object) => {
      if (!request) return;
      const chain = editor.chain().focus();
      if (request.pos === null) {
        chain.setTextSelection(request.insertAt).insertContent({ type, attrs }).run();
      } else {
        const pos = request.pos;
        chain
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)?.attrs, ...attrs });
            return true;
          })
          .run();
      }
      setRequest(null);
    },
    [editor, request],
  );

  const close = useCallback(() => {
    setRequest(null);
    editor.commands.focus();
  }, [editor]);

  return (
    <>
      <CtaDialog
        open={request?.type === 'cta'}
        initial={request?.type === 'cta' ? request.attrs : undefined}
        initialTitle={ctaTitle}
        labels={labels}
        search={search}
        onConfirm={(attrs, title) => {
          setCtaTitle(title);
          apply('cta', attrs);
        }}
        onClose={close}
      />
      <RelatedDialog
        open={request?.type === 'related'}
        initial={request?.type === 'related' ? request.attrs : undefined}
        labels={labels}
        search={search}
        onConfirm={(attrs) => apply('relatedResource', attrs)}
        onClose={close}
      />
    </>
  );
}
