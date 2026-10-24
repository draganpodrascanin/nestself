/**
 * Storybook stories for ContentRenderer (T-C1.06).
 *
 * Demonstrates every block type, light and dark themes,
 * and a Cyrillic document produced with transliterateDocument.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ContentDocument } from '../schema/document.ts';
import { transliterateDocument } from '../schema/transliterate.ts';

import { ContentRenderer } from './ContentRenderer.tsx';
import type { ContentRendererProps } from './types.ts';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mediaUrl: ContentRendererProps['mediaUrl'] = (id, rendition) =>
  `https://placehold.co/800x450?text=${id}+${rendition}`;

const resolveCta: ContentRendererProps['resolveCta'] = (cta) => ({
  href: '#',
  label: cta.label ?? 'Take action',
  isLink: cta.ctaKind === 'open_content',
});

const resolveRelated: ContentRendererProps['resolveRelated'] = (id) => ({
  title: `Related: ${id}`,
  href: `#${id}`,
  description: 'A related content resource.',
});

const resolveInternalLink: ContentRendererProps['resolveInternalLink'] = (id) =>
  `/content/${id}`;

// ---------------------------------------------------------------------------
// Sample document with every block type
// ---------------------------------------------------------------------------

function fullDocument(): ContentDocument {
  return {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'sectionHeading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Upravljanje stresom na poslu' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Stres je ' },
          { type: 'text', text: 'normalna reakcija', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' organizma na pritisak. Ovaj tekst koristi ' },
          { type: 'text', text: 'kursiv', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' i ' },
          {
            type: 'text',
            text: 'link ka resursu',
            marks: [{ type: 'link', attrs: { href: 'nestself:content/stress-101' } }],
          },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Prva linija' },
          { type: 'hardBreak' },
          { type: 'text', text: 'Druga linija' },
        ],
      },
      {
        type: 'sectionHeading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Tehnike za opustanje' }],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Duboko disanje' }] }] },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Progresivna muskularana relaksacija' }] },
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pocnite od stopala' }] }] },
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nastavite ka glavi' }] }] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Identifikujte okidac' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primenite tehniku' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Procenite efekat' }] }] },
        ],
      },
      {
        type: 'quote',
        attrs: { attribution: 'Hans Selye' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stres nije ono sto vam se desava, vec kako na to reagujete.' }] }],
      },
      {
        type: 'image',
        attrs: {
          mediaAssetId: 'nature-calm-01',
          alt: 'Mirna suma sa suncem koje prodire kroz lisce',
          caption: 'Boravak u prirodi smanjuje nivo kortizola',
        },
      },
      {
        type: 'professionalNote',
        attrs: { noteKind: 'warning' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ako osecate intenzivan stres duze od dve nedelje, obratite se strucnom licu.' }] }],
      },
      {
        type: 'professionalNote',
        attrs: { noteKind: 'tip' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pokusajte da svaki dan izdvojite bar 10 minuta za opustanje.' }] }],
      },
      {
        type: 'professionalNote',
        attrs: { noteKind: 'disclaimer' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ovaj tekst je informativnog karaktera i ne zamenjuje profesionalni savet.' }] }],
      },
      {
        type: 'practicalStep',
        attrs: { stepNumber: 1, title: 'Duboko disanje' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Udahnite kroz nos, zadrzite 4 sekunde, izdahnite kroz usta.' }] }],
      },
      {
        type: 'practicalStep',
        attrs: { stepNumber: 2, title: 'Skeniranje tela' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Zatvorite oci i obratite paznju na svaki deo tela redom.' }] }],
      },
      {
        type: 'checklist',
        content: [
          { type: 'checklistItem', attrs: { label: 'Provezbaite duboko disanje' }, content: [{ type: 'text', text: 'Provezbaite duboko disanje' }] },
          { type: 'checklistItem', attrs: { label: 'Zapisite tri stvari za koje ste zahvalni' }, content: [{ type: 'text', text: 'Zapisite tri stvari za koje ste zahvalni' }] },
          { type: 'checklistItem', attrs: { label: 'Napravite pauzu od ekrana' }, content: [{ type: 'text', text: 'Napravite pauzu od ekrana' }] },
        ],
      },
      {
        type: 'approvedMedia',
        attrs: { mediaAssetId: 'relaxation-audio-01', kind: 'audio', caption: 'Vodjena meditacija za opustanje' },
      },
      {
        type: 'transcript',
        attrs: { mediaAssetId: 'relaxation-audio-01' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Zatvorite oci i udahnite duboko...' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Zamislite mirno mesto gde se osecate sigurno...' }] },
        ],
      },
      {
        type: 'approvedMedia',
        attrs: { mediaAssetId: 'exercise-video-01', kind: 'video', caption: 'Jutarnja yoga za energiju' },
      },
      {
        type: 'transcript',
        attrs: { mediaAssetId: 'exercise-video-01' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Pocnite u stavu planine...' }] },
        ],
      },
      {
        type: 'approvedMedia',
        attrs: { mediaAssetId: 'guide-pdf-01', kind: 'pdf', caption: 'Prirucnik za upravljanje stresom' },
      },
      {
        type: 'relatedResource',
        attrs: { contentResourceId: 'sleep-hygiene' },
      },
      {
        type: 'cta',
        attrs: { ctaKind: 'open_content', targetId: 'sleep-hygiene', label: 'Procitajte vise o higijeni sna' },
      },
    ],
  } as ContentDocument;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: 'Content/ContentRenderer',
  parameters: {
    layout: 'padded',
  },
};
export default meta;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const AllBlocks: StoryObj = {
  render: () => (
    <div className="max-w-[var(--reading-width,42rem)] mx-auto">
      <ContentRenderer
        document={fullDocument()}
        mediaUrl={mediaUrl}
        resolveCta={resolveCta}
        resolveRelated={resolveRelated}
        resolveInternalLink={resolveInternalLink}
      />
    </div>
  ),
};

export const WithHeadingOffset: StoryObj = {
  render: () => (
    <div className="max-w-[var(--reading-width,42rem)] mx-auto">
      <h1 className="text-text type-heading-lg mb-6">Article Title (h1)</h1>
      <ContentRenderer
        document={fullDocument()}
        mediaUrl={mediaUrl}
        resolveCta={resolveCta}
        resolveRelated={resolveRelated}
        resolveInternalLink={resolveInternalLink}
        headingOffset={1}
      />
    </div>
  ),
};

export const CyrillicDocument: StoryObj = {
  render: () => {
    const cyrillic = transliterateDocument(fullDocument(), 'sr-Cyrl');
    return (
      <div className="max-w-[var(--reading-width,42rem)] mx-auto">
        <ContentRenderer
          document={cyrillic}
          mediaUrl={mediaUrl}
          resolveCta={resolveCta}
          resolveRelated={resolveRelated}
          resolveInternalLink={resolveInternalLink}
        />
      </div>
    );
  },
};

export const DarkMode: StoryObj = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: () => (
    <div data-theme="dark" className="bg-surface p-6">
      <div className="max-w-[var(--reading-width,42rem)] mx-auto">
        <ContentRenderer
          document={fullDocument()}
          mediaUrl={mediaUrl}
          resolveCta={resolveCta}
          resolveRelated={resolveRelated}
          resolveInternalLink={resolveInternalLink}
        />
      </div>
    </div>
  ),
};

export const MinimalDocument: StoryObj = {
  render: () => (
    <div className="max-w-[var(--reading-width,42rem)] mx-auto">
      <ContentRenderer
        document={{
          type: 'doc',
          schemaVersion: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A simple paragraph.' }] },
          ],
        }}
        mediaUrl={mediaUrl}
        resolveCta={resolveCta}
        resolveRelated={resolveRelated}
        resolveInternalLink={resolveInternalLink}
      />
    </div>
  ),
};
