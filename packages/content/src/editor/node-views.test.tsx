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
import { BLOCK_DIALOG_EVENT } from './BlockDialogs.tsx';

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
      view: { state: { doc: { nodeSize: 10 } }, dom: document.createElement('div') },
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
    expect(screen.getByText('Suggest topic')).toBeInTheDocument();
  });

  it('shows custom label in the button when set', () => {
    const props = makeMockProps({ ctaKind: 'suggest_topic', label: 'Get Started' }, false);
    render(<CtaView {...props} />);
    expect(screen.getByText('Get Started')).toBeInTheDocument();
  });

  it('opens the configuration dialog for this node when clicked', async () => {
    const user = userEvent.setup();
    const props = makeMockProps({ ctaKind: 'open_content', targetId: 'res_1', label: 'Read more' }, true);
    props.getPos = () => 7;
    const onRequest = vi.fn();
    props.editor.view.dom.addEventListener(BLOCK_DIALOG_EVENT, (e: Event) => onRequest((e as CustomEvent).detail));
    render(<CtaView {...props} />);
    await user.click(screen.getByRole('button', { name: /call to action: read more/i }));
    expect(onRequest).toHaveBeenCalledWith({
      type: 'cta',
      pos: 7,
      attrs: { ctaKind: 'open_content', targetId: 'res_1', label: 'Read more' },
    });
  });

  it('cannot be opened when the editor is read-only', () => {
    const props = makeMockProps({ ctaKind: 'suggest_topic', label: null }, false);
    render(<CtaView {...props} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// RelatedResourceView
// ---------------------------------------------------------------------------

describe('RelatedResourceView', () => {
  it('shows the stored title, never the raw id', () => {
    const props = makeMockProps({ contentResourceId: 'res_123', contentResourceTitle: 'My Resource' }, false);
    render(<RelatedResourceView {...props} />);
    expect(screen.getByText('My Resource')).toBeInTheDocument();
    expect(screen.queryByText('res_123')).not.toBeInTheDocument();
  });

  it('asks for a resource when none is chosen', () => {
    const props = makeMockProps({ contentResourceId: null }, false);
    render(<RelatedResourceView {...props} />);
    expect(screen.getByText('Choose a resource')).toBeInTheDocument();
  });

  it('opens the picker for this node when clicked', async () => {
    const user = userEvent.setup();
    const props = makeMockProps({ contentResourceId: 'res_123', contentResourceTitle: 'My Resource' }, true);
    props.getPos = () => 3;
    const onRequest = vi.fn();
    props.editor.view.dom.addEventListener(BLOCK_DIALOG_EVENT, (e: Event) => onRequest((e as CustomEvent).detail));
    render(<RelatedResourceView {...props} />);
    await user.click(screen.getByRole('button'));
    expect(onRequest).toHaveBeenCalledWith({
      type: 'related',
      pos: 3,
      attrs: { contentResourceId: 'res_123', contentResourceTitle: 'My Resource' },
    });
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

  it('shows labelled alt text and caption inputs when editable', () => {
    const props = makeMockProps({ mediaAssetId: 'asset_abc', alt: 'Alt', caption: 'Cap' }, true);
    render(<ImageView {...props} />);
    expect(screen.getByRole('textbox', { name: 'Alt text' })).toHaveValue('Alt');
    expect(screen.getByRole('textbox', { name: 'Caption' })).toHaveValue('Cap');
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
    await user.type(screen.getByRole('textbox', { name: 'Alt text' }), 'New alt');
    expect(props.updateAttributes).toHaveBeenCalled();
  });
});
