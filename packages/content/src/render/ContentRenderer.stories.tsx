/**
 * Storybook stories for ContentRenderer (T-C1.06).
 *
 * Demonstrates every block type, light and dark themes,
 * and a Cyrillic document produced with transliterateDocument.
 *
 * No external hosts for media — all media URLs use inline data URIs
 * or local placeholder paths. The `media` record drives which blocks render.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ContentDocument } from '../schema/document.ts';
import { transliterateDocument } from '../schema/transliterate.ts';

import { ContentRenderer } from './ContentRenderer.tsx';
import type { ContentRendererProps, MediaAssetMeta } from './types.ts';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

/** Media metadata for story assets. */
const storyMedia: Record<string, MediaAssetMeta> = {
  'nature-calm-01': {
    kind: 'image',
    renditions: ['detail_webp', 'detail_jpeg'],
    width: 800,
    height: 450,
    focalPoint: { x: 0.5, y: 0.4 },
  },
  'relaxation-audio-01': {
    kind: 'audio',
    renditions: ['audio'],
  },
  'exercise-video-01': {
    kind: 'video',
    renditions: ['video', 'poster_webp'],
  },
  'guide-pdf-01': {
    kind: 'pdf',
    renditions: ['pdf'],
  },
};

/**
 * Media URL resolver: generates a local placeholder SVG data URI
 * instead of referencing external hosts.
 */
const mediaUrl: ContentRendererProps['mediaUrl'] = (id, rendition) => {
  // Generate a simple inline SVG placeholder — no external hosts
  const label = encodeURIComponent(`${id} (${rendition})`);
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect width='800' height='450' fill='%23e2e8f0'/%3E%3Ctext x='400' y='225' text-anchor='middle' dy='.3em' fill='%2364748b' font-family='system-ui' font-size='14'%3E${label}%3C/text%3E%3C/svg%3E`;
};

const labels: ContentRendererProps['labels'] = {
  transcript: 'Transkript',
  noteWarning: 'Upozorenje',
  noteTip: 'Savet',
  noteDisclaimer: 'Napomena',
  noteDefault: 'Beleska',
  checklist: 'Lista za proveru',
  opensInNewTab: '(otvara se u novom tabu)',
  downloadPdf: 'Preuzmi PDF',
  imageUnavailable: 'Slika nije dostupna',
};

const resolveCta: ContentRendererProps['resolveCta'] = (cta) => ({
  kind: 'link',
  href: '#',
  label: cta.label ?? 'Take action',
});

const resolveRelated: ContentRendererProps['resolveRelated'] = (id) => ({
  title: `Povezano: ${id}`,
  href: `#${id}`,
  description: 'Povezani sadrzaj.',
});

const resolveInternalLink: ContentRendererProps['resolveInternalLink'] = (id) =>
  `/content/${id}`;

// ---------------------------------------------------------------------------
// Shared default props
// ---------------------------------------------------------------------------

const sharedProps: Omit<ContentRendererProps, 'document'> = {
  media: storyMedia,
  mediaUrl,
  resolveCta,
  resolveRelated,
  resolveInternalLink,
  labels,
  documentKey: 'story-doc-1',
};

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
        {...sharedProps}
      />
    </div>
  ),
};

export const WithHeadingOffset: StoryObj = {
  render: () => (
    <div className="max-w-[var(--reading-width,42rem)] mx-auto">
      <h1 className="text-text type-screen-title mb-6">Article Title (h1)</h1>
      <ContentRenderer
        document={fullDocument()}
        {...sharedProps}
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
          {...sharedProps}
          documentKey="story-cyrillic"
        />
      </div>
    );
  },
};

export const DarkMode: StoryObj = {
  globals: {
    mode: 'dark',
  },
  render: () => (
    <div className="max-w-[var(--reading-width,42rem)] mx-auto">
      <ContentRenderer
        document={fullDocument()}
        {...sharedProps}
        documentKey="story-dark"
      />
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
        {...sharedProps}
        documentKey="story-minimal"
      />
    </div>
  ),
};
