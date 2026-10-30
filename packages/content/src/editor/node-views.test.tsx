/**
 * Node view tests (T-C1.12, Phase B).
 *
 * Verifies that node view components render with correct attributes and
 * respond to user interaction. Since these are React node views used inside
 * Tiptap, we test them in isolation with mocked Tiptap props.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ProfessionalNoteView,
  PracticalStepView,
  CtaView,
  RelatedResourceView,
  ImageView,
  ChecklistItemView,
} from './node-views.tsx';

// ---------------------------------------------------------------------------
// Minimal mock for ReactNodeViewProps
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal mock, not worth matching the full Tiptap type
function makeMockProps(attrs: Record<string, unknown> = {}, editable = true): any {
  return {
    node: {
      attrs,
      type: { name: 'test' },
      content: { size: 0 },
      textContent: '',
      isBlock: true,
      isLeaf: false,
      isInline: false,
      isText: false,
      isAtom: false,
      childCount: 0,
      nodeSize: 2,
    },
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    selected: false,
    editor: {
      isEditable: editable,
      view: { state: { doc: { nodeSize: 10 } } },
    },
    getPos: () => 0,
    extension: {},
    HTMLAttributes: {},
  };
}

// ---------------------------------------------------------------------------
// ProfessionalNoteView
// ---------------------------------------------------------------------------

describe('ProfessionalNoteView', () => {
  it('renders with the correct note kind', () => {
    const props = makeMockProps({ noteKind: 'warning' });
    const { container } = render(<ProfessionalNoteView {...props} />);
    const aside = container.querySelector('[data-note-kind="warning"]');
    expect(aside).toBeTruthy();
  });

  it('shows a select for the kind when editable', () => {
    const props = makeMockProps({ noteKind: 'tip' }, true);
    render(<ProfessionalNoteView {...props} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('does not show select when not editable', () => {
    const props = makeMockProps({ noteKind: 'tip' }, false);
    render(<ProfessionalNoteView {...props} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('calls updateAttributes when kind changes via combobox', async () => {
    const user = userEvent.setup();
    const props = makeMockProps({ noteKind: 'tip' }, true);
    render(<ProfessionalNoteView {...props} />);

    // Open the custom combobox
    const combobox = screen.getByRole('combobox');
    await user.click(combobox);

    // Pick the "warning" option from the listbox
    const option = screen.getByRole('option', { name: /warning/i });
    await user.click(option);
    expect(props.updateAttributes).toHaveBeenCalledWith({ noteKind: 'warning' });
  });
});

// ---------------------------------------------------------------------------
// PracticalStepView
// ---------------------------------------------------------------------------

describe('PracticalStepView', () => {
  it('renders step number', () => {
    const props = makeMockProps({ stepNumber: 3, title: 'Test step' });
    render(<PracticalStepView {...props} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows editable title input when editable', () => {
    const props = makeMockProps({ stepNumber: 1, title: 'Do this' }, true);
    render(<PracticalStepView {...props} />);
    const input = screen.getByPlaceholderText('Step title');
    expect(input).toHaveValue('Do this');
  });

  it('shows title as text when not editable', () => {
    const props = makeMockProps({ stepNumber: 1, title: 'Do this' }, false);
    render(<PracticalStepView {...props} />);
    expect(screen.getByText('Do this')).toBeInTheDocument();
  });

  it('calls updateAttributes when title changes', async () => {
    const user = userEvent.setup();
    const props = makeMockProps({ stepNumber: 1, title: '' }, true);
    render(<PracticalStepView {...props} />);

    const input = screen.getByPlaceholderText('Step title');
    await user.type(input, 'New');
    expect(props.updateAttributes).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ChecklistItemView
// ---------------------------------------------------------------------------

describe('ChecklistItemView', () => {
  it('renders unchecked checkbox', () => {
    const props = makeMockProps({ label: 'Item one' }, true);
    render(<ChecklistItemView {...props} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('renders checked when label starts with [x]', () => {
    const props = makeMockProps({ label: '[x] Done item' }, true);
    render(<ChecklistItemView {...props} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('toggles check state on click', async () => {
    const user = userEvent.setup();
    const props = makeMockProps({ label: 'Unchecked' }, true);
    render(<ChecklistItemView {...props} />);

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(props.updateAttributes).toHaveBeenCalledWith({ label: '[x] Unchecked' });
  });

  it('disables checkbox when not editable', () => {
    const props = makeMockProps({ label: 'Read only' }, false);
    render(<ChecklistItemView {...props} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// CtaView
// ---------------------------------------------------------------------------

describe('CtaView', () => {
  it('renders CTA kind label in the button', () => {
    const props = makeMockProps({ ctaKind: 'suggest_topic', label: null }, false);
    render(<CtaView {...props} />);
    // When not editable, only the button preview shows the kind label (no select)
    expect(screen.getByText('Suggest topic')).toBeInTheDocument();
  });

  it('shows custom label in the button when set', () => {
    const props = makeMockProps({ ctaKind: 'suggest_topic', label: 'Get Started' }, false);
    render(<CtaView {...props} />);
    expect(screen.getByText('Get Started')).toBeInTheDocument();
  });

  it('shows kind selector when editable', () => {
    const props = makeMockProps({ ctaKind: 'suggest_topic', label: null }, true);
    render(<CtaView {...props} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls updateAttributes when kind changes and Done is clicked', async () => {
    const user = userEvent.setup();
    const props = makeMockProps({ ctaKind: 'suggest_topic', label: null }, true);
    render(<CtaView {...props} />);

    // Open the custom combobox inside the CTA dialog
    const combobox = screen.getByRole('combobox', { name: 'Action' });
    await user.click(combobox);

    // Pick the "open_content" option from the listbox
    const option = screen.getByRole('option', { name: /open.content/i });
    await user.click(option);

    // Click "Done" to commit the change (the dialog uses local form state)
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.updateAttributes).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RelatedResourceView
// ---------------------------------------------------------------------------

describe('RelatedResourceView', () => {
  it('renders resource ID when set', () => {
    const props = makeMockProps({ contentResourceId: 'res_123' }, false);
    render(<RelatedResourceView {...props} />);
    expect(screen.getByText('res_123')).toBeInTheDocument();
  });

  it('shows (none) when resource ID is null', () => {
    const props = makeMockProps({ contentResourceId: null }, false);
    render(<RelatedResourceView {...props} />);
    expect(screen.getByText('(none)')).toBeInTheDocument();
  });

  it('shows resource title or ID when editable', () => {
    const props = makeMockProps({ contentResourceId: 'res_123', contentResourceTitle: 'My Resource' }, true);
    render(<RelatedResourceView {...props} />);
    // The stored title is displayed instead of a bare text input
    expect(screen.getByText('My Resource')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ImageView
// ---------------------------------------------------------------------------

describe('ImageView', () => {
  it('renders placeholder when no assetId', () => {
    const props = makeMockProps({ mediaAssetId: null, alt: '', caption: '' });
    render(<ImageView {...props} />);
    expect(screen.getByText(/drop or paste/i)).toBeInTheDocument();
  });

  it('renders image preview when assetId set', () => {
    const props = makeMockProps({ mediaAssetId: 'asset_abc', alt: 'A photo', caption: '' });
    render(<ImageView {...props} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', 'A photo');
    expect(img).toHaveAttribute('src', '/api/ops/cms/media/asset_abc/original');
  });

  it('shows alt and caption inputs when editable', () => {
    const props = makeMockProps({ mediaAssetId: 'asset_abc', alt: 'Alt text', caption: 'Caption' }, true);
    render(<ImageView {...props} />);
    expect(screen.getByPlaceholderText('Alt text (required)')).toHaveValue('Alt text');
    expect(screen.getByPlaceholderText('Caption (optional)')).toHaveValue('Caption');
  });

  it('shows caption as figcaption when not editable', () => {
    const props = makeMockProps({ mediaAssetId: 'asset_abc', alt: '', caption: 'My caption' }, false);
    render(<ImageView {...props} />);
    expect(screen.getByText('My caption')).toBeInTheDocument();
  });

  it('calls updateAttributes when alt text changes', async () => {
    const user = userEvent.setup();
    const props = makeMockProps({ mediaAssetId: 'asset_abc', alt: '', caption: '' }, true);
    render(<ImageView {...props} />);

    const altInput = screen.getByPlaceholderText('Alt text (required)');
    await user.type(altInput, 'New alt');
    expect(props.updateAttributes).toHaveBeenCalled();
  });
});
