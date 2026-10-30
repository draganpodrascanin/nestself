/**
 * Slash command menu for the Notion-style content editor (T-C1.12).
 *
 * Opened by typing '/' at the start of an empty paragraph. Provides a
 * filtered list of block types grouped by category. Positioned with
 * Floating UI via Tiptap Suggestion's `mount` API.
 *
 * Keyboard: Arrow keys navigate, Enter inserts, Escape closes, typing filters.
 * Accessibility: listbox with aria-activedescendant.
 * Animation: popover preset per the Motion rule.
 * Colour: semantic tokens only (no hex literals).
 */
'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { createPortal } from 'react-dom';
import {
  m,
  AnimatePresence,
  MotionFeatures,
  useMotionPreset,
} from '@nestself/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashMenuItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  group: string;
  command: (props: { editor: SuggestionProps['editor']; range: SuggestionProps['range'] }) => void;
}

export interface SlashMenuLabels {
  placeholder: string;
  empty: string;
  groupText: string;
  groupLists: string;
  groupBlocks: string;
  groupMedia: string;
}

// ---------------------------------------------------------------------------
// Slash menu popup (rendered via portal)
// ---------------------------------------------------------------------------

interface SlashMenuPopupProps {
  items: SlashMenuItem[];
  query: string;
  labels: SlashMenuLabels;
  onSelect: (item: SlashMenuItem) => void;
  onClose: () => void;
  position: { x: number; y: number } | null;
}

function SlashMenuPopup({
  items,
  query,
  labels,
  onSelect,
  onClose,
  position,
}: SlashMenuPopupProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const popoverMotion = useMotionPreset('popover');

  // Filter items by query
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.hint && item.hint.toLowerCase().includes(q)),
    );
  }, [items, query]);

  // Group items
  const groups = useMemo(() => {
    const map = new Map<string, SlashMenuItem[]>();
    for (const item of filtered) {
      const group = map.get(item.group) ?? [];
      group.push(item);
      map.set(item.group, group);
    }
    return map;
  }, [filtered]);

  // Flatten for keyboard navigation
  const flatItems = useMemo(() => {
    const result: SlashMenuItem[] = [];
    for (const [, group] of groups) {
      result.push(...group);
    }
    return result;
  }, [groups]);

  // Derive a clamped index from the raw state (no setState during render)
  const safeIndex = flatItems.length > 0 ? Math.min(activeIndex, flatItems.length - 1) : 0;

  // Scroll active into view
  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  // Group label mapping
  const groupLabel = useCallback(
    (key: string) => {
      switch (key) {
        case 'text':
          return labels.groupText;
        case 'lists':
          return labels.groupLists;
        case 'blocks':
          return labels.groupBlocks;
        case 'media':
          return labels.groupMedia;
        default:
          return key;
      }
    },
    [labels],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % flatItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[safeIndex];
        if (item) onSelect(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [flatItems, safeIndex, onSelect, onClose],
  );

  if (!position) return null;

  return createPortal(
    <MotionFeatures>
      <AnimatePresence>
        <m.div
          {...popoverMotion}
          role="listbox"
          aria-label={labels.placeholder}
          aria-activedescendant={flatItems[safeIndex]?.id}
          ref={listRef}
          onKeyDown={handleKeyDown}
          className="fixed z-[var(--z-dropdown)] w-72 max-h-80 overflow-y-auto rounded-control border border-border-subtle bg-surface shadow-menu"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
          }}
        >
          {flatItems.length === 0 ? (
            <div className="px-3 py-4 text-center type-metadata text-text-secondary">
              {labels.empty}
            </div>
          ) : (
            Array.from(groups.entries()).map(([group, groupItems]) => (
              <div key={group} role="group" aria-label={groupLabel(group)}>
                <div className="px-3 pt-2 pb-1 type-metadata text-text-secondary font-[var(--font-weight-label)]">
                  {groupLabel(group)}
                </div>
                {groupItems.map((item) => {
                  const flatIdx = flatItems.indexOf(item);
                  const isActive = flatIdx === safeIndex;
                  return (
                    <button
                      key={item.id}
                      id={item.id}
                      role="option"
                      type="button"
                      aria-selected={isActive}
                      data-active={isActive}
                      className={[
                        'flex w-full items-center gap-3 px-3 py-2 text-left',
                        'transition-colors duration-[var(--motion-fast)] ease-standard',
                        'hover:bg-tint focus-visible:outline-none',
                        isActive ? 'bg-tint' : '',
                      ].join(' ')}
                      onMouseEnter={() => setActiveIndex(flatIdx)}
                      onClick={() => onSelect(item)}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-border-subtle bg-surface text-text-secondary">
                        {item.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block type-body text-text truncate">
                          {item.label}
                        </span>
                        {item.hint ? (
                          <span className="block type-metadata text-text-secondary truncate">
                            {item.hint}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </m.div>
      </AnimatePresence>
    </MotionFeatures>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Slash menu extension (wraps Tiptap Suggestion)
// ---------------------------------------------------------------------------

const slashMenuPluginKey = new PluginKey('slashMenu');

export interface SlashMenuExtensionOptions {
  items: SlashMenuItem[];
  labels: SlashMenuLabels;
  onOpen: (props: {
    items: SlashMenuItem[];
    query: string;
    labels: SlashMenuLabels;
    onSelect: (item: SlashMenuItem) => void;
    onClose: () => void;
    range: SuggestionProps['range'];
    editor: SuggestionProps['editor'];
  }) => void;
  onUpdate: (props: { query: string }) => void;
  onClose: () => void;
}

/**
 * Creates the slash menu Tiptap extension. This is a low-level extension;
 * the React component `SlashMenuProvider` handles the UI lifecycle.
 */
export function createSlashMenuExtension(
  suggestionConfig: Partial<SuggestionOptions>,
) {
  return Extension.create({
    name: 'slashMenu',

    addOptions() {
      return {};
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          pluginKey: slashMenuPluginKey,
          allowSpaces: false,
          startOfLine: false,
          ...suggestionConfig,
        }),
      ];
    },
  });
}

// ---------------------------------------------------------------------------
// React hook for the slash menu
// ---------------------------------------------------------------------------

export interface UseSlashMenuOptions {
  items: SlashMenuItem[];
  labels: SlashMenuLabels;
}

export interface SlashMenuState {
  isOpen: boolean;
  query: string;
  position: { x: number; y: number } | null;
  range: SuggestionProps['range'] | null;
  editor: SuggestionProps['editor'] | null;
}

/**
 * React hook that manages the slash menu lifecycle. Returns both the
 * Tiptap Suggestion config and the popup component to render.
 */
export function useSlashMenu({ items, labels }: UseSlashMenuOptions) {
  const [state, setState] = useState<SlashMenuState>({
    isOpen: false,
    query: '',
    position: null,
    range: null,
    editor: null,
  });

  const unmountRef = useRef<(() => void) | null>(null);

  const suggestionConfig: Partial<SuggestionOptions> = useMemo(
    () => ({
      items: ({ query }: { query: string }) => {
        if (!query) return items;
        const q = query.toLowerCase();
        return items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            (item.hint && item.hint.toLowerCase().includes(q)),
        );
      },

      render: () => {
        let popup: HTMLDivElement | null = null;

        return {
          onStart: (props: SuggestionProps) => {
            popup = document.createElement('div');
            popup.style.position = 'fixed';
            popup.style.zIndex = 'var(--z-dropdown, 20)';

            const unmount = props.mount?.(popup, {
              onPosition: (data) => {
                setState((prev) => ({
                  ...prev,
                  position: { x: data.x, y: data.y },
                }));
              },
            });
            if (unmount) unmountRef.current = unmount;

            setState({
              isOpen: true,
              query: props.query,
              position: null,
              range: props.range,
              editor: props.editor,
            });
          },

          onUpdate: (props: SuggestionProps) => {
            setState((prev) => ({
              ...prev,
              query: props.query,
              range: props.range,
            }));
          },

          onExit: () => {
            unmountRef.current?.();
            unmountRef.current = null;
            if (popup) {
              popup.remove();
              popup = null;
            }
            setState({
              isOpen: false,
              query: '',
              position: null,
              range: null,
              editor: null,
            });
          },

          onKeyDown: (props: { event: globalThis.KeyboardEvent }) => {
            if (props.event.key === 'Escape') {
              setState((prev) => ({ ...prev, isOpen: false }));
              return true;
            }
            if (
              props.event.key === 'ArrowDown' ||
              props.event.key === 'ArrowUp' ||
              props.event.key === 'Enter'
            ) {
              // Handled by the popup component
              return true;
            }
            return false;
          },
        };
      },

      command: ({
        editor,
        range,
        props: item,
      }: {
        editor: SuggestionProps['editor'];
        range: SuggestionProps['range'];
        props: SlashMenuItem;
      }) => {
        item.command({ editor, range });
      },
    }),
    [items],
  );

  const handleSelect = useCallback(
    (item: SlashMenuItem) => {
      if (state.editor && state.range) {
        item.command({ editor: state.editor, range: state.range });
      }
    },
    [state.editor, state.range],
  );

  const handleClose = useCallback(() => {
    if (state.editor && state.range) {
      // Delete the slash character
      state.editor
        .chain()
        .focus()
        .deleteRange(state.range)
        .run();
    }
  }, [state.editor, state.range]);

  const popup = state.isOpen ? (
    <SlashMenuPopup
      items={items}
      query={state.query}
      labels={labels}
      onSelect={handleSelect}
      onClose={handleClose}
      position={state.position}
    />
  ) : null;

  return { suggestionConfig, popup, isOpen: state.isOpen };
}

// ---------------------------------------------------------------------------
// Default slash items (factory; labels come from i18n)
// ---------------------------------------------------------------------------

/** SVG icon builder (Phosphor regular, 18px) */
function icon(d: string) {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Phosphor icon paths
const ICON_TEXT =
  'M208,56V200a8,8,0,0,1-16,0V136H64v64a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0v64H192V56a8,8,0,0,1,16,0Z';
const ICON_H2 = ICON_TEXT;
const ICON_H3 =
  'M152,56V200a8,8,0,0,1-16,0V136H56v64a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0v64h80V56a8,8,0,0,1,16,0Zm71.77,68.32a36,36,0,0,0-52-10.47,8,8,0,0,0,9.34,13,20,20,0,1,1,13.13,35.2H184a8,8,0,0,0,0,16h10.23A20,20,0,1,1,181.11,213.5a8,8,0,1,0-9.34,13,36,36,0,0,0,52-10.47,35.27,35.27,0,0,0,0-36.4A36.64,36.64,0,0,0,223.77,124.32Z';
const ICON_BULLET =
  'M80,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H88A8,8,0,0,1,80,64Zm136,56H88a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,64H88a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM44,52A12,12,0,1,0,56,64,12,12,0,0,0,44,52Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,116Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,180Z';
const ICON_NUMBERED =
  'M224,128a8,8,0,0,1-8,8H104a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM104,72H216a8,8,0,0,0,0-16H104a8,8,0,0,0,0,16ZM216,184H104a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM43.58,55.16,48,52.94V104a8,8,0,0,0,16,0V40a8,8,0,0,0-11.58-7.16l-16,8a8,8,0,0,0,7.16,14.32Z';
const ICON_CHECKLIST =
  'M224,128a8,8,0,0,1-8,8H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128ZM128,72h88a8,8,0,0,0,0-16H128a8,8,0,0,0,0,16Zm88,112H128a8,8,0,0,0,0,16h88a8,8,0,0,0,0-16ZM79.51,39.51,56,63l-7.51-7.52a8,8,0,0,0-11.32,11.32l13.17,13.17a8,8,0,0,0,11.32,0L85.66,56a8,8,0,0,0,0-11.32A8,8,0,0,0,79.51,39.51Zm0,64L56,127l-7.51-7.52a8,8,0,0,0-11.32,11.32l13.17,13.17a8,8,0,0,0,11.32,0l24-24a8,8,0,0,0-11.32-11.32Zm0,64L56,191l-7.51-7.52a8,8,0,0,0-11.32,11.32l13.17,13.17a8,8,0,0,0,11.32,0l24-24a8,8,0,0,0-11.32-11.32Z';
const ICON_QUOTE =
  'M100,56H40A16,16,0,0,0,24,72v64a16,16,0,0,0,16,16h60v4a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,100,56Zm0,80H40V72h60ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v4a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Zm0,80H156V72h60Z';
const ICON_NOTE =
  'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z';
const ICON_STEP =
  'M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V48H208V208Zm-32-80a8,8,0,0,1-8,8H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32A8,8,0,0,1,176,128Z';
const ICON_CTA =
  'M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z';
const ICON_RELATED =
  'M240,88.23a54.43,54.43,0,0,1-16,37L189.25,160a54.27,54.27,0,0,1-38.63,16h-.05A54.63,54.63,0,0,1,96,120.07a8,8,0,0,1,16,.36,38.63,38.63,0,0,0,38.56,39.57,38.39,38.39,0,0,0,27.31-11.31l34.75-34.75a38.63,38.63,0,0,0-54.63-54.63l-11,11A8,8,0,0,1,135.7,59l11-11A54.65,54.65,0,0,1,240,88.23ZM109,185.66l-11,11A38.41,38.41,0,0,1,70.6,208a38.63,38.63,0,0,1-27.29-65.94L78.06,107.3A38.63,38.63,0,0,1,144,135.57a8,8,0,0,0,16,.36A54.86,54.86,0,0,0,105.38,80,54.65,54.65,0,0,0,66.74,96,54.59,54.59,0,0,0,48,96l-34.75,34.75A54.62,54.62,0,0,0,51.63,208h.05a54.28,54.28,0,0,0,38.63-16l11-11a8,8,0,0,0-11.31-11.32Z';
const ICON_IMAGE =
  'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,200V172l52-52,80,80H40Zm176,0H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z';

export interface SlashMenuItemLabels {
  paragraph: string;
  paragraphHint: string;
  heading2: string;
  heading2Hint: string;
  heading3: string;
  heading3Hint: string;
  bulletList: string;
  bulletListHint: string;
  numberedList: string;
  numberedListHint: string;
  checklist: string;
  checklistHint: string;
  quote: string;
  quoteHint: string;
  note: string;
  noteHint: string;
  step: string;
  stepHint: string;
  cta: string;
  ctaHint: string;
  related: string;
  relatedHint: string;
  image: string;
  imageHint: string;
}

/**
 * Creates the default set of slash menu items from translated labels.
 */
export function createSlashMenuItems(
  l: SlashMenuItemLabels,
  onInsertImage?: () => void,
): SlashMenuItem[] {
  return [
    {
      id: 'slash-paragraph',
      label: l.paragraph,
      hint: l.paragraphHint,
      icon: icon(ICON_TEXT),
      group: 'text',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('paragraph').run();
      },
    },
    {
      id: 'slash-heading2',
      label: l.heading2,
      hint: l.heading2Hint,
      icon: icon(ICON_H2),
      group: 'text',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode('sectionHeading', { level: 2 })
          .run();
      },
    },
    {
      id: 'slash-heading3',
      label: l.heading3,
      hint: l.heading3Hint,
      icon: icon(ICON_H3),
      group: 'text',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode('sectionHeading', { level: 3 })
          .run();
      },
    },
    {
      id: 'slash-bullet',
      label: l.bulletList,
      hint: l.bulletListHint,
      icon: icon(ICON_BULLET),
      group: 'lists',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      id: 'slash-numbered',
      label: l.numberedList,
      hint: l.numberedListHint,
      icon: icon(ICON_NUMBERED),
      group: 'lists',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      id: 'slash-checklist',
      label: l.checklist,
      hint: l.checklistHint,
      icon: icon(ICON_CHECKLIST),
      group: 'lists',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'checklist',
            content: [
              {
                type: 'checklistItem',
                attrs: { label: '' },
                content: [{ type: 'text', text: ' ' }],
              },
            ],
          })
          .run();
      },
    },
    {
      id: 'slash-quote',
      label: l.quote,
      hint: l.quoteHint,
      icon: icon(ICON_QUOTE),
      group: 'blocks',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).wrapIn('quote').run();
      },
    },
    {
      id: 'slash-note',
      label: l.note,
      hint: l.noteHint,
      icon: icon(ICON_NOTE),
      group: 'blocks',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'professionalNote',
            attrs: { noteKind: 'tip' },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: ' ' }] },
            ],
          })
          .run();
      },
    },
    {
      id: 'slash-step',
      label: l.step,
      hint: l.stepHint,
      icon: icon(ICON_STEP),
      group: 'blocks',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'practicalStep',
            attrs: { stepNumber: 1, title: '' },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: ' ' }] },
            ],
          })
          .run();
      },
    },
    {
      id: 'slash-cta',
      label: l.cta,
      hint: l.ctaHint,
      icon: icon(ICON_CTA),
      group: 'blocks',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'cta',
            attrs: { ctaKind: 'suggest_topic', targetId: null, label: null },
          })
          .run();
      },
    },
    {
      id: 'slash-related',
      label: l.related,
      hint: l.relatedHint,
      icon: icon(ICON_RELATED),
      group: 'blocks',
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'relatedResource',
            attrs: { contentResourceId: null },
          })
          .run();
      },
    },
    {
      id: 'slash-image',
      label: l.image,
      hint: l.imageHint,
      icon: icon(ICON_IMAGE),
      group: 'media',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        onInsertImage?.();
      },
    },
  ];
}
