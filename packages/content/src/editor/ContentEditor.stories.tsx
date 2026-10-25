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
