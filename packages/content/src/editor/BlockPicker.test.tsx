/**
 * The standalone block picker (opened from the "+" handle) filters, moves
 * with the keyboard, picks and closes on its own; in slash mode it is a bare
 * listbox driven by the editor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockPicker } from './BlockPicker.tsx';
import { createSlashMenuItems } from './SlashMenu.tsx';
import { DEFAULT_EDITOR_LABELS } from './ContentEditor.tsx';

const items = createSlashMenuItems(DEFAULT_EDITOR_LABELS.slashItems);
const labels = DEFAULT_EDITOR_LABELS.slashMenu;

function renderStandalone() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <BlockPicker
      items={items}
      labels={labels}
      onSelect={onSelect}
      onClose={onClose}
      position={{ x: 10, y: 20 }}
    />,
  );
  return { onSelect, onClose };
}

describe('BlockPicker (standalone)', () => {
  it('focuses its filter input and lists every group', () => {
    renderStandalone();
    const input = screen.getByRole('combobox', { name: 'Filter blocks...' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    for (const group of ['Text', 'Lists', 'Blocks', 'Media']) {
      expect(screen.getByRole('group', { name: group })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('option')).toHaveLength(items.length);
  });

  it('filters by label and hint', async () => {
    const user = userEvent.setup();
    renderStandalone();
    await user.keyboard('head');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Heading 2Section heading',
      'Heading 3Subsection',
    ]);
    await user.keyboard('zzz');
    expect(screen.getByText('No matching blocks')).toBeInTheDocument();
  });

  it('picks the active option with the arrow keys and Enter', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderStandalone();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'slash-heading3' }));
  });

  it('picks with a click and closes on Escape or an outside click', async () => {
    const user = userEvent.setup();
    const { onSelect, onClose } = renderStandalone();
    await user.click(screen.getByRole('option', { name: /Professional note/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'slash-note' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('BlockPicker (slash mode)', () => {
  it('has no input and takes keys through the handler ref', () => {
    const onSelect = vi.fn();
    const ref = { current: null as ((e: KeyboardEvent) => boolean) | null };
    render(
      <BlockPicker
        items={items}
        labels={labels}
        onSelect={onSelect}
        onClose={vi.fn()}
        position={{ x: 0, y: 0 }}
        query="quo"
        keydownHandlerRef={ref}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => o.id)).toEqual(['slash-quote']);
    expect(ref.current?.({ key: 'Enter', preventDefault() {} } as KeyboardEvent)).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'slash-quote' }));
  });
});
