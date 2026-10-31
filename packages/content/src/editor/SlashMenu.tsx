/**
 * Slash command menu for the Notion-style content editor (T-C1.12).
 *
 * Opened by typing '/' in a paragraph. The list itself is `BlockPicker`
 * (shared with the "+" block handle); this file wires it to Tiptap's
 * Suggestion plugin, positioned through its `mount` API with Floating UI,
 * and defines the items.
 */
'use client';

import { openBlockDialog } from './BlockDialogs.tsx';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionFeatures } from '@nestself/ui';
import { BlockPicker, filterBlockItems } from './BlockPicker.tsx';
import { openImagePicker } from './node-views.tsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashMenuItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  group: string;
  /**
   * True for items that add a block (image, note, step, call to action,
   * related resource) rather than re-type the current one. The "+" handle
   * uses it to decide whether a pick replaces the hovered block or follows it.
   */
  insert?: boolean;
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
 * the React hook `useSlashMenu` handles the UI lifecycle.
 */
export function createSlashMenuExtension(suggestionConfig: Partial<SuggestionOptions>) {
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
 *
 * Keyboard events are forwarded from the Suggestion plugin's onKeyDown
 * through `keydownHandlerRef` to the popup component.
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

  // Ref for forwarding native keyboard events to the popup
  const keydownHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  const suggestionConfig: Partial<SuggestionOptions> = useMemo(
    () => ({
      items: ({ query }: { query: string }) => filterBlockItems(items, query),

      render: () => {
        return {
          onStart: (props: SuggestionProps) => {
            // Use Suggestion's mount API for Floating UI positioning
            const el = document.createElement('div');
            const unmount = props.mount?.(el, {
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
            setState({
              isOpen: false,
              query: '',
              position: null,
              range: null,
              editor: null,
            });
          },

          // Forward keyboard events to the popup component via the ref
          onKeyDown: (props: { event: globalThis.KeyboardEvent }) => {
            const handler = keydownHandlerRef.current;
            if (handler) {
              return handler(props.event);
            }
            // Fallback: swallow navigation keys to prevent ProseMirror from handling them
            if (
              props.event.key === 'ArrowDown' ||
              props.event.key === 'ArrowUp' ||
              props.event.key === 'Enter' ||
              props.event.key === 'Escape'
            ) {
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
    if (state.editor) {
      // Exit the Suggestion without deleting text — the typed query stays.
      const { tr } = state.editor.view.state;
      tr.setMeta(slashMenuPluginKey, { exit: true });
      state.editor.view.dispatch(tr);
    }
  }, [state.editor]);

  const popup =
    typeof document === 'undefined'
      ? null
      : createPortal(
          <MotionFeatures>
            <AnimatePresence>
              {state.isOpen && state.position ? (
                <BlockPicker
                  key="slash-menu"
                  items={items}
                  query={state.query}
                  labels={labels}
                  onSelect={handleSelect}
                  onClose={handleClose}
                  position={state.position}
                  keydownHandlerRef={keydownHandlerRef}
                />
              ) : null}
            </AnimatePresence>
          </MotionFeatures>,
          document.body,
        );

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
const ICON_H2 =
  'M152,56V176a8,8,0,0,1-16,0V124H48v52a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0v52h88V56a8,8,0,0,1,16,0Zm88,144H208l33.55-44.74a32,32,0,1,0-55.73-29.93,8,8,0,1,0,15.08,5.34,16.28,16.28,0,0,1,2.32-4.3,16,16,0,1,1,25.54,19.27L185.6,203.2A8,8,0,0,0,192,216h48a8,8,0,0,0,0-16Z';
const ICON_PARAGRAPH =
  'M208,56V88a8,8,0,0,1-16,0V64H136V192h24a8,8,0,0,1,0,16H96a8,8,0,0,1,0-16h24V64H64V88a8,8,0,0,1-16,0V56a8,8,0,0,1,8-8H200A8,8,0,0,1,208,56Z';
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
  _onInsertImage?: () => void,
): SlashMenuItem[] {
  return [
    {
      id: 'slash-paragraph',
      label: l.paragraph,
      hint: l.paragraphHint,
      icon: icon(ICON_PARAGRAPH),
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
        editor.chain().focus().deleteRange(range).setNode('sectionHeading', { level: 2 }).run();
      },
    },
    {
      id: 'slash-heading3',
      label: l.heading3,
      hint: l.heading3Hint,
      icon: icon(ICON_H3),
      group: 'text',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('sectionHeading', { level: 3 }).run();
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
      insert: true,
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
            content: [{ type: 'paragraph' }],
          })
          .run();
      },
    },
    {
      id: 'slash-step',
      insert: true,
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
            content: [{ type: 'paragraph' }],
          })
          .run();
      },
    },
    {
      id: 'slash-cta',
      insert: true,
      label: l.cta,
      hint: l.ctaHint,
      icon: icon(ICON_CTA),
      group: 'blocks',
      command: ({ editor, range }) => {
        // The block is inserted only once its dialog is confirmed.
        editor.chain().focus().deleteRange(range).run();
        openBlockDialog(editor, { type: 'cta', pos: null });
      },
    },
    {
      id: 'slash-related',
      insert: true,
      label: l.related,
      hint: l.relatedHint,
      icon: icon(ICON_RELATED),
      group: 'blocks',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        openBlockDialog(editor, { type: 'related', pos: null });
      },
    },
    {
      id: 'slash-image',
      insert: true,
      label: l.image,
      hint: l.imageHint,
      icon: icon(ICON_IMAGE),
      group: 'media',
      command: ({ editor, range }) => {
        // Open the file picker first (outside React) so the browser's
        // filechooser event fires synchronously.  The ImageView node
        // view consumes the pending file promise on mount.
        openImagePicker();

        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'image',
            attrs: { mediaAssetId: null, alt: '', caption: null },
          })
          .run();
      },
    },
  ];
}
