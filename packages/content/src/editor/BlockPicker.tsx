/**
 * Block picker: the grouped, filterable list of block types.
 *
 * Two entry points share it:
 * - the slash menu ("/"): the editor keeps focus, the text typed after "/" is
 *   the `query`, and the Suggestion plugin forwards keys through
 *   `keydownHandlerRef`;
 * - the "+" block handle: standalone, with its own filter input that takes
 *   focus and handles the keys itself.
 *
 * Keyboard: Arrow keys move, Enter picks, Escape closes, typing filters.
 * Accessibility: a listbox; standalone adds a combobox input that controls it.
 * Animation: popover preset per the Motion rule (mounted by the caller's
 * AnimatePresence so the exit plays). Colour: semantic tokens only.
 */
'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { m, useMotionPreset } from '@nestself/ui';
import type { SlashMenuItem, SlashMenuLabels } from './SlashMenu.tsx';

export interface BlockPickerProps {
  items: SlashMenuItem[];
  labels: SlashMenuLabels;
  onSelect: (item: SlashMenuItem) => void;
  onClose: () => void;
  /** Viewport position of the top-left corner. */
  position: { x: number; y: number };
  /** Slash mode: the text typed after "/". Omit for the standalone picker. */
  query?: string;
  /** Slash mode: receives the editor's keydown events while the menu is open. */
  keydownHandlerRef?: React.MutableRefObject<((event: KeyboardEvent) => boolean) | null>;
}

export function filterBlockItems(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) || (item.hint && item.hint.toLowerCase().includes(q)),
  );
}

export function BlockPicker({
  items,
  labels,
  onSelect,
  onClose,
  position,
  query: slashQuery,
  keydownHandlerRef,
}: BlockPickerProps) {
  const standalone = slashQuery === undefined;
  const [ownQuery, setOwnQuery] = useState('');
  const query = standalone ? ownQuery : slashQuery;
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const popoverMotion = useMotionPreset('popover');

  const filtered = useMemo(() => filterBlockItems(items, query), [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, SlashMenuItem[]>();
    for (const item of filtered) {
      const group = map.get(item.group) ?? [];
      group.push(item);
      map.set(item.group, group);
    }
    return map;
  }, [filtered]);

  const flatItems = useMemo(() => {
    const result: SlashMenuItem[] = [];
    for (const [, group] of groups) result.push(...group);
    return result;
  }, [groups]);

  // Reset the active index when the filter changes (adjusting state during
  // render, https://react.dev/learn/you-might-not-need-an-effect).
  const [indexQuery, setIndexQuery] = useState(query);
  if (indexQuery !== query) {
    setIndexQuery(query);
    setActiveIndex(0);
  }

  const safeIndex = flatItems.length > 0 ? Math.min(activeIndex, flatItems.length - 1) : 0;

  const handleKey = useCallback(
    (event: { key: string; preventDefault: () => void }): boolean => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (flatItems.length > 0 ? (i + 1) % flatItems.length : 0));
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (flatItems.length > 0 ? (i - 1 + flatItems.length) % flatItems.length : 0));
        return true;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = flatItems[safeIndex];
        if (item) onSelect(item);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return true;
      }
      return false;
    },
    [flatItems, safeIndex, onSelect, onClose],
  );

  // Slash mode: the Suggestion plugin forwards the editor's keys here.
  useEffect(() => {
    if (!keydownHandlerRef) return;
    keydownHandlerRef.current = handleKey;
    return () => {
      keydownHandlerRef.current = null;
    };
  }, [keydownHandlerRef, handleKey]);

  // Standalone: the filter input takes focus before the picker paints, so a
  // key pressed right after the click already reaches it.
  useLayoutEffect(() => {
    if (standalone) inputRef.current?.focus();
  }, [standalone]);

  // Standalone: a click elsewhere closes the picker, and so does Escape
  // wherever focus is (the "+" button keeps it until the input mounts).
  useEffect(() => {
    if (!standalone) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [standalone, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const groupLabel = (key: string) => {
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
  };

  const activeId = flatItems[safeIndex]?.id;

  return (
    <m.div
      ref={rootRef}
      {...popoverMotion}
      data-block-picker=""
      className="fixed z-[var(--z-dropdown)] w-72 overflow-hidden rounded-control border border-border-subtle bg-surface shadow-menu"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      {standalone ? (
        <div className="border-b border-border-subtle p-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={labels.placeholder}
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            placeholder={labels.placeholder}
            value={ownQuery}
            onChange={(e) => setOwnQuery(e.target.value)}
            onKeyDown={handleKey}
            className="min-h-9 w-full rounded-control border border-border-control bg-surface px-3 type-body text-text placeholder:text-text-secondary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
        </div>
      ) : null}
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        tabIndex={-1}
        aria-label={labels.placeholder}
        aria-activedescendant={standalone ? undefined : activeId}
        className="max-h-80 overflow-y-auto"
      >
        {flatItems.length === 0 ? (
          <div className="px-3 py-4 text-center type-metadata text-text-secondary">{labels.empty}</div>
        ) : (
          Array.from(groups.entries()).map(([group, groupItems]) => (
            <div key={group} role="group" aria-label={groupLabel(group)}>
              <div className="px-3 pt-2 pb-1 type-metadata font-[var(--font-weight-label)] text-text-secondary">
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
                    tabIndex={-1}
                    aria-selected={isActive}
                    data-active={isActive}
                    className={[
                      'gap-3 px-3 py-2 flex w-full items-center text-left',
                      'transition-colors duration-[var(--motion-fast)] ease-standard',
                      'hover:bg-tint focus-visible:outline-none',
                      isActive ? 'bg-tint' : '',
                    ].join(' ')}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onMouseDown={(e) => e.preventDefault()} // keep focus where it is
                    onClick={() => onSelect(item)}
                  >
                    <span className="h-8 w-8 flex shrink-0 items-center justify-center rounded-control border border-border-subtle bg-surface text-text-secondary">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate type-body text-text">{item.label}</span>
                      {item.hint ? (
                        <span className="block truncate type-metadata text-text-secondary">{item.hint}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </m.div>
  );
}
