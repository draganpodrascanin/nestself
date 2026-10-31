/**
 * Block dialog tests: the call-to-action and related-resource pickers never
 * confirm an incomplete block, and every search state is visible.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CtaDialog, RelatedDialog, ResourcePicker } from './BlockDialogs.tsx';
import { DEFAULT_NODE_VIEW_LABELS as labels } from './node-view-labels.ts';

const RESULTS = [
  { id: 'res_1', title: 'A calmer end to the day', type: 'article' },
  { id: 'col_1', title: 'Calm at work', type: 'collection' },
];

function renderCta(overrides: Partial<React.ComponentProps<typeof CtaDialog>> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <CtaDialog
      open
      initial={undefined}
      initialTitle={null}
      labels={labels}
      search={vi.fn().mockResolvedValue(RESULTS)}
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onConfirm, onClose, dialog: screen.getByRole('dialog', { name: 'Call to action' }) };
}

describe('CtaDialog', () => {
  it('blocks Done with a visible error while the target is missing', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderCta();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Choose what the button opens.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms an open_content CTA with the picked resource and label', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderCta();
    await user.type(screen.getByRole('combobox', { name: 'Content' }), 'calm');
    await user.click(await screen.findByRole('option', { name: 'A calmer end to the day' }));
    await user.type(screen.getByRole('textbox', { name: /button label/i }), '  Read this too ');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onConfirm).toHaveBeenCalledWith(
      { ctaKind: 'open_content', targetId: 'res_1', label: 'Read this too' },
      'A calmer end to the day',
    );
  });

  it('confirms suggest_topic without a target', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderCta({
      initial: { ctaKind: 'suggest_topic', targetId: null, label: null },
    });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onConfirm).toHaveBeenCalledWith(
      { ctaKind: 'suggest_topic', targetId: null, label: null },
      null,
    );
  });

  it('offers the content capabilities for open_service', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderCta({
      initial: { ctaKind: 'open_service', targetId: null, label: null },
    });
    await user.click(screen.getByRole('combobox', { name: 'Service' }));
    await user.click(await screen.findByRole('option', { name: 'Ask a general question' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onConfirm).toHaveBeenCalledWith(
      { ctaKind: 'open_service', targetId: 'general_questions', label: null },
      null,
    );
  });

  it('cancel closes without confirming', async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderCta();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('RelatedDialog', () => {
  it('confirms the picked resource with its title', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RelatedDialog
        open
        initial={undefined}
        labels={labels}
        search={vi.fn().mockResolvedValue(RESULTS)}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Related resource' })).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'Content' }), 'calm');
    await user.click(await screen.findByRole('option', { name: 'A calmer end to the day' }));
    expect(onConfirm).toHaveBeenCalledWith({
      contentResourceId: 'res_1',
      contentResourceTitle: 'A calmer end to the day',
    });
  });
});

describe('ResourcePicker', () => {
  it('shows a failed search as an alert', async () => {
    const user = userEvent.setup();
    render(
      <ResourcePicker
        label="Content"
        labels={labels}
        search={vi.fn().mockRejectedValue(new Error('500'))}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('combobox', { name: 'Content' }), 'calm');
    expect(await screen.findByRole('alert')).toHaveTextContent('The search failed. Try again.');
  });

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    render(
      <ResourcePicker
        label="Content"
        labels={labels}
        search={vi.fn().mockResolvedValue([])}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('combobox', { name: 'Content' }), 'zzz');
    expect(await screen.findByText('No matching content')).toBeInTheDocument();
  });

  it('offers only results of the requested type', async () => {
    const user = userEvent.setup();
    render(
      <ResourcePicker
        label="Collection"
        labels={labels}
        search={vi.fn().mockResolvedValue(RESULTS)}
        type="collection"
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('combobox', { name: 'Collection' }), 'calm');
    expect(await screen.findByRole('option', { name: 'Calm at work' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'A calmer end to the day' }),
    ).not.toBeInTheDocument();
  });

  it('picks the active option with the keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ResourcePicker
        label="Content"
        labels={labels}
        search={vi.fn().mockResolvedValue(RESULTS)}
        selected={null}
        onSelect={onSelect}
      />,
    );
    await user.type(screen.getByRole('combobox', { name: 'Content' }), 'calm');
    await screen.findByRole('option', { name: 'Calm at work' });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(RESULTS[1]));
  });
});
