/**
 * Storybook stories for ContentEditor (T-C1.12).
 *
 * Shows the editor in editable and read-only states, with and without
 * initial content. Uses inline document fixtures, no external media.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import type { ContentDocument } from '../schema/document.ts';
import { CURRENT_SCHEMA_VERSION } from '../schema/document.ts';

import { ContentEditor } from './ContentEditor.tsx';
import type { ContentEditorProps } from './ContentEditor.tsx';

// ---------------------------------------------------------------------------
// Sample documents
// ---------------------------------------------------------------------------

const emptyDoc: ContentDocument = {
  type: 'doc',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  content: [],
} as unknown as ContentDocument;

const richDoc: ContentDocument = {
  type: 'doc',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  content: [
    {
      type: 'sectionHeading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Getting started' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This is a ' },
        { type: 'text', text: 'rich text', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' editor with a ' },
        {
          type: 'text',
          text: 'link',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'quote',
      attrs: { attribution: 'Viktor Frankl' },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Between stimulus and response there is a space.',
            },
          ],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'First point' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Second point' }],
            },
          ],
        },
      ],
    },
    {
      type: 'professionalNote',
      attrs: { noteKind: 'tip' },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This is a professional tip for the reader.',
            },
          ],
        },
      ],
    },
    {
      type: 'cta',
      attrs: { ctaKind: 'suggest_topic', targetId: null, label: null },
    },
  ],
} as unknown as ContentDocument;

/** Document containing every custom block type for visual testing. */
const allBlocksDoc: ContentDocument = {
  type: 'doc',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  content: [
    {
      type: 'sectionHeading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'All custom blocks' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Demonstrates every interactive node view.' }],
    },
    // Professional notes (all four kinds)
    {
      type: 'professionalNote',
      attrs: { noteKind: 'tip' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'This is a Tip note.' }] },
      ],
    },
    {
      type: 'professionalNote',
      attrs: { noteKind: 'warning' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'This is a Warning note.' }] },
      ],
    },
    {
      type: 'professionalNote',
      attrs: { noteKind: 'info' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'This is an Info note.' }] },
      ],
    },
    {
      type: 'professionalNote',
      attrs: { noteKind: 'disclaimer' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'This is a Disclaimer note.' }] },
      ],
    },
    // Practical steps
    {
      type: 'practicalStep',
      attrs: { stepNumber: 1, title: 'Take a deep breath' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Inhale for four seconds, hold for seven, exhale for eight.' }] },
      ],
    },
    {
      type: 'practicalStep',
      attrs: { stepNumber: 2, title: 'Journal your thoughts' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Write down three things you are grateful for today.' }] },
      ],
    },
    // Checklist
    {
      type: 'checklist',
      content: [
        { type: 'checklistItem', attrs: { label: '[x] Morning stretches' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Morning stretches' }] }] },
        { type: 'checklistItem', attrs: { label: 'Midday walk' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Midday walk' }] }] },
        { type: 'checklistItem', attrs: { label: 'Evening reflection' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evening reflection' }] }] },
      ],
    },
    // Image (no asset uploaded -- placeholder)
    {
      type: 'image',
      attrs: { mediaAssetId: null, alt: '', caption: '' },
    },
    // Related resource
    {
      type: 'relatedResource',
      attrs: { contentResourceId: 'res_stress_management_101' },
    },
    // CTA with label
    {
      type: 'cta',
      attrs: { ctaKind: 'open_content', targetId: null, label: 'Read more about stress management' },
    },
    // CTA without label
    {
      type: 'cta',
      attrs: { ctaKind: 'suggest_topic', targetId: null, label: null },
    },
  ],
} as unknown as ContentDocument;

// ---------------------------------------------------------------------------
// Wrapper with onChange tracking
// ---------------------------------------------------------------------------

function EditorWrapper(props: ContentEditorProps) {
  const [doc, setDoc] = useState<ContentDocument | undefined>(
    props.initialDocument,
  );

  return (
    <div className="max-w-3xl">
      <ContentEditor {...props} initialDocument={doc} onChange={setDoc} />
      <details className="mt-4">
        <summary className="type-metadata text-text-secondary cursor-pointer">
          Document JSON
        </summary>
        <pre className="mt-2 p-3 rounded-control bg-surface-raised text-xs overflow-x-auto">
          {JSON.stringify(doc, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

const meta = {
  title: 'Content/ContentEditor',
  component: ContentEditor,
  render: (args) => <EditorWrapper {...args} />,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof ContentEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Empty editor with placeholder text. */
export const Empty: Story = {
  args: {
    initialDocument: emptyDoc,
    placeholder: 'Start writing...',
  },
};

/** Editor pre-populated with rich content including headings, bold, links, lists, quotes and a CTA. */
export const WithContent: Story = {
  args: {
    initialDocument: richDoc,
    placeholder: 'Start writing...',
  },
};

/** Read-only mode hides the toolbar and disables editing. */
export const ReadOnly: Story = {
  args: {
    initialDocument: richDoc,
    editable: false,
  },
};

/** Custom toolbar labels (localised). */
export const CustomLabels: Story = {
  args: {
    initialDocument: emptyDoc,
    placeholder: 'Pocnite da pisete...',
    toolbarLabels: {
      bold: 'Podebljan',
      heading: 'Naslov',
      bulletList: 'Lista sa tackama',
      orderedList: 'Numerisana lista',
      quote: 'Citat',
      image: 'Slika',
      link: 'Veza',
      linkUrl: 'URL veze',
      linkInsert: 'Umetni vezu',
      linkRemove: 'Ukloni vezu',
      undo: 'Ponisti',
      redo: 'Ponovi',
    },
  },
};

/** Showcases every custom block type with interactive node views. */
export const AllBlocks: Story = {
  args: {
    initialDocument: allBlocksDoc,
    placeholder: 'Start writing...',
  },
};

/** All custom blocks in read-only mode (kind pickers and inputs hidden). */
export const AllBlocksReadOnly: Story = {
  args: {
    initialDocument: allBlocksDoc,
    editable: false,
  },
};
