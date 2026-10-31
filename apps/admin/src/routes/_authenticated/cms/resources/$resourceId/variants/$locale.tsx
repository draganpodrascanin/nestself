/**
 * CMS variant editor route (WRK-R-30, T-C1.12).
 *
 * Editor + metadata form for a single locale variant with autosave,
 * conflict handling, submit/approve/publish actions, and content preview.
 *
 * sr-Cyrl is never authored: it shows a read-only preview derived from
 * the sr-Latn variant via transliteration (C-28).
 *
 * CTA ruling: authored as a `cta` block in the body; no separate metadata
 * field. On save the CTA is extracted from the body and sent in the DTO.
 *
 * API mode: loads the resource + variant via `getResource`, saves with
 * `saveRevision` (If-Match ETag), and routes submit/approve/publish
 * through the CMS API. Sample mode falls back to fixture data.
 */
import { createFileRoute, redirect, useBlocker, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { can } from '@nestself/contracts';
import type { ContentDocument } from '@nestself/content/schema';
import {
  validateContentDocument,
  transliterateDocument,
  transliterateText as transliterateFn,
} from '@nestself/content/schema';
import { ContentEditor } from '@nestself/content/editor';
import type { ContentEditorHandle, ContentEditorLabels, ImageUploadHandler, ResourceSearchHandler } from '@nestself/content/editor';
import { ContentRenderer } from '@nestself/content/render';
import type { ContentRendererLabels } from '@nestself/content/render';
import { createCmsApi, ApiError } from '@nestself/api-client';
import type { RevisionResponse, VariantResponse, ResourceDetailResponse } from '@nestself/api-client';
import type { RevisionUpdateRequest } from '@nestself/contracts';
import {
  Heading,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Alert,
  AlertDialog,
  AlertDialogContent,
  FormErrorSummary,
  Accordion,
  AccordionItem,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  useToast,
  cn,
  m,
  AnimatePresence,
  MotionFeatures,
  useMotionPreset,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import {
  SAMPLE_CONTENT_RESOURCES,
} from '@nestself/sample-data';
import type { SampleContentVariant, SampleAuthoredLocale } from '@nestself/sample-data';
import { isSampleDataMode } from '../../../../../../data-source';
import { useAuth } from '../../../../../../auth';
import { api } from '../../../../../../api';
import { useImageUpload } from '../../../../../../features/cms/use-image-upload';

// ---------------------------------------------------------------------------
// Preview width presets (FMT-R-24, WRK-R-35)
// ---------------------------------------------------------------------------

const PREVIEW_WIDTHS = [
  { key: 'phone', width: 320 },
  { key: 'mobile', width: 390 },
  { key: 'desktop', width: 1440 },
] as const;

type PreviewWidthKey = (typeof PREVIEW_WIDTHS)[number]['key'];

// ---------------------------------------------------------------------------
// Autosave status
// ---------------------------------------------------------------------------

type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

// ---------------------------------------------------------------------------
// Proposed audience (required on submit)
//
// The editor offers "all eligible organisations". An organisation or unit
// audience already stored on the revision is kept exactly as saved; picking
// organisations and units arrives with T-C2.02.
// ---------------------------------------------------------------------------

const RETURN_COMMENT_ID = 'return-comment';

type AudienceEntries = NonNullable<RevisionUpdateRequest['proposedAudience']>;
type AudienceChoice = 'all_eligible' | 'saved';

/** The reading-time field holds minutes; the API stores seconds. */
function minutesField(seconds: number | null | undefined): string {
  return seconds != null ? String(Math.round(seconds / 60)) : '';
}
const ALL_ELIGIBLE: AudienceEntries = [{ kind: 'all_eligible', includeDescendants: true }];

function isAllEligible(entries: AudienceEntries): boolean {
  return entries.length > 0 && entries.every((e) => e.kind === 'all_eligible');
}

// ---------------------------------------------------------------------------
// Locale configuration
// ---------------------------------------------------------------------------

const AUTHORED_LOCALES = ['sr-Latn', 'hu', 'en'] as const;
type AuthoredLocale = (typeof AUTHORED_LOCALES)[number];
const ALL_LOCALES = [...AUTHORED_LOCALES, 'sr-Cyrl'] as const;

// ---------------------------------------------------------------------------
// Conflict state (409 carries full server version in details)
// ---------------------------------------------------------------------------

interface ConflictState {
  active: boolean;
  serverLockVersion?: number;
  serverTitle?: string;
  serverSummary?: string;
  serverOutcome?: string;
  serverDurationSeconds?: number;
  serverBody?: ContentDocument;
  serverUpdatedAt?: string;
}

// ---------------------------------------------------------------------------
// Empty document for new variants
// ---------------------------------------------------------------------------

const EMPTY_DOCUMENT: ContentDocument = {
  type: 'doc',
  schemaVersion: 1,
  content: [{ type: 'paragraph', content: [] }],
} as unknown as ContentDocument;

// ---------------------------------------------------------------------------
// Noop media / CTA / related resolvers for preview
// ---------------------------------------------------------------------------

const noopMediaUrl = () => '';
const noopResolveCta = () => null;
const noopResolveRelated = () => null;
const noopResolveInternalLink = () => null;

/**
 * Collect unique contentResourceId values from `relatedResource` nodes
 * in the body so the API can populate `relatedResourceIds` on the
 * revision — the library detail endpoint resolves from that column.
 */
function extractRelatedResourceIds(doc: ContentDocument): string[] {
  const ids = new Set<string>();
  const content = (doc as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return [];
  for (const node of content) {
    const n = node as { type?: string; attrs?: Record<string, unknown> };
    if (n.type === 'relatedResource' && typeof n.attrs?.contentResourceId === 'string') {
      ids.add(n.attrs.contentResourceId as string);
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Page-level loading state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not-found' }
  | {
      status: 'ready';
      resource: ResourceDetailResponse;
      variant: VariantResponse;
      revision: RevisionResponse;
    };

// ---------------------------------------------------------------------------
// CMS API singleton (outside component to avoid re-creation on each render)
// ---------------------------------------------------------------------------

const cmsApi = createCmsApi(api);

// ---------------------------------------------------------------------------
// Autosave interval
// ---------------------------------------------------------------------------

const AUTOSAVE_DELAY_MS = 1_000;
/** Minimum time the "Saving…" indicator stays visible so the transition is
 *  perceivable by users and observable by automated tests. */
const MIN_SAVING_DISPLAY_MS = 400;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function VariantEditorPage() {
  const { t } = useTranslation(['cms', 'common', 'library']);
  const params = Route.useParams();
  const { resourceId, locale: routeLocale } = params;
  const { principal, effectiveActions } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const canWrite = principal ? can(principal, 'content.write', undefined, effectiveActions) : false;
  const canReview = principal ? can(principal, 'content.review', undefined, effectiveActions) : false;
  const canPublish = principal ? can(principal, 'content.publish', undefined, effectiveActions) : false;

  const isDerivedLocale = routeLocale === 'sr-Cyrl';

  function buildSampleLoadState(): LoadState {
    const resource = SAMPLE_CONTENT_RESOURCES.find((r) => r.id === resourceId);
    if (!resource) return { status: 'not-found' };
    const sourceLocale = isDerivedLocale ? 'sr-Latn' : routeLocale;
    const variant: SampleContentVariant | undefined = resource.variants.find(
      (v) => v.locale === sourceLocale,
    );
    if (!variant) return { status: 'not-found' };
    // Fake a VariantResponse and RevisionResponse for sample mode
    return {
      status: 'ready',
      resource: {
        id: resource.id,
        type: resource.type,
        state: 'active',
        primaryCategoryId: resource.primaryCategoryId,
        ownerUserId: 'user_author',
        reviewPolicy: resource.reviewPolicy,
        reviewDiscipline: resource.reviewDiscipline,
        createdAt: '2026-10-01T08:00:00Z',
        updatedAt: '2026-10-01T08:00:00Z',
        variants: resource.variants.map((v) => ({
          id: v.id,
          contentResourceId: resource.id,
          locale: v.locale,
          slug: v.slug,
          localApplicability: null,
          createdAt: '2026-10-01T08:00:00Z',
        })),
      } as ResourceDetailResponse,
      variant: {
        id: variant.id,
        contentResourceId: resource.id,
        locale: variant.locale,
        slug: variant.slug,
        localApplicability: null,
        createdAt: '2026-10-01T08:00:00Z',
        revisions: [{
          id: `rev_${variant.id}`,
          contentVariantId: variant.id,
          revisionNumber: 1,
          state: 'draft' as const,
          body: variant.body as unknown as Record<string, unknown>,
          title: variant.title,
          summary: variant.summary,
          outcome: variant.outcome,
          durationSeconds: resource.durationSeconds,
          durationBand: resource.durationBand,
          difficulty: resource.difficulty,
          sources: null,
          proposedAudience: null,
          cta: null,
          relatedResourceIds: null,
          authorUserId: 'user_author',
          lastEditorUserId: 'user_author',
          lockVersion: 1,
          approvalHash: null,
          submittedAt: null,
          approvedAt: null,
          approvedByUserId: null,
          reviewDueAt: null,
          quicklyOutdated: false,
          createdAt: '2026-10-01T08:00:00Z',
          updatedAt: '2026-10-01T08:00:00Z',
        }],
      } as VariantResponse,
      revision: {
        id: `rev_${variant.id}`,
        contentVariantId: variant.id,
        revisionNumber: 1,
        state: 'draft' as const,
        body: variant.body as unknown as Record<string, unknown>,
        title: variant.title,
        summary: variant.summary,
        outcome: variant.outcome,
        durationSeconds: resource.durationSeconds,
        durationBand: resource.durationBand,
        difficulty: resource.difficulty,
        sources: null,
        proposedAudience: null,
        cta: null,
        relatedResourceIds: null,
        authorUserId: 'user_author',
        lastEditorUserId: 'user_author',
        lockVersion: 1,
        approvalHash: null,
        submittedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        reviewDueAt: null,
        quicklyOutdated: false,
        createdAt: '2026-10-01T08:00:00Z',
        updatedAt: '2026-10-01T08:00:00Z',
      } as RevisionResponse,
    };
  }

  // ─── API loading state ────────────────────────────────────────────
  // The load result is keyed by resource and locale, so a locale switch shows
  // the loading state instead of stale content (e.g. transliterating the
  // English title as if it were Serbian) without resetting state in an effect.
  const loadKey = `${resourceId}/${routeLocale}`;
  const [keyedLoad, setKeyedLoad] = useState<{ key: string; state: LoadState }>(() => ({
    key: loadKey,
    state: isSampleDataMode ? buildSampleLoadState() : { status: 'loading' },
  }));
  const loadState: LoadState =
    isSampleDataMode || keyedLoad.key === loadKey ? keyedLoad.state : { status: 'loading' };
  const setLoadState = useCallback(
    (state: LoadState) => setKeyedLoad({ key: loadKey, state }),
    [loadKey],
  );


  // ─── Fetch resource from API ──────────────────────────────────────
  useEffect(() => {
    if (isSampleDataMode) return;

    let cancelled = false;

    async function load() {
      try {
        const res = await cmsApi.getResource(resourceId);
        if (cancelled) return;

        const sourceLocale = isDerivedLocale ? 'sr-Latn' : routeLocale;
        const foundVariant = res.variants?.find((v) => v.locale === sourceLocale);
        if (!foundVariant) {
          setLoadState({ status: 'not-found' });
          return;
        }

        // Find the working revision (latest by revisionNumber, state=draft)
        const revisions = foundVariant.revisions ?? [];
        const workingRevision =
          revisions.find((r) => r.state === 'draft') ??
          revisions.sort((a, b) => b.revisionNumber - a.revisionNumber)[0];

        if (!workingRevision) {
          setLoadState({ status: 'not-found' });
          return;
        }

        setLoadState({
          status: 'ready',
          resource: res,
          variant: foundVariant,
          revision: workingRevision,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'not_found') {
          setLoadState({ status: 'not-found' });
        } else {
          setLoadState({ status: 'error', message: t('cms:editor.loadError') });
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [resourceId, routeLocale, isDerivedLocale, setLoadState, t]);

  // ─── Loading / error / not-found gates ────────────────────────────
  if (loadState.status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-border-control border-t-primary" />
        <p className="type-body text-text-secondary">{t('cms:editor.loading')}</p>
      </div>
    );
  }
  if (loadState.status === 'not-found') {
    // Offer to create the variant for authored locales (not sr-Cyrl).
    const isAuthoredMissing = !isDerivedLocale && AUTHORED_LOCALES.includes(routeLocale as AuthoredLocale);
    const handleCreateVariant = async () => {
      if (isSampleDataMode) {
        toast.add({ title: t('cms:sample.saveNotice'), tone: 'info' });
        return;
      }
      try {
        await cmsApi.addVariant(resourceId, routeLocale as AuthoredLocale);
        // Reload the page to pick up the new variant
        setLoadState({ status: 'loading' });
        const res = await cmsApi.getResource(resourceId);
        const foundVariant = res.variants?.find((v) => v.locale === routeLocale);
        if (!foundVariant) {
          setLoadState({ status: 'not-found' });
          return;
        }
        const revisions = foundVariant.revisions ?? [];
        const workingRevision =
          revisions.find((r) => r.state === 'draft') ??
          revisions.sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
        if (!workingRevision) {
          setLoadState({ status: 'not-found' });
          return;
        }
        setLoadState({
          status: 'ready',
          resource: res,
          variant: foundVariant,
          revision: workingRevision,
        });
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'unknown';
        toast.add({
          title: t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }),
          tone: 'danger',
        });
      }
    };
    return (
      <div className="flex flex-col gap-4 py-12">
        <Alert tone="warning">{t('cms:editor.notFound')}</Alert>
        {isAuthoredMissing && canWrite ? (
          <Button variant="primary" onClick={handleCreateVariant}>
            {t('cms:editor.createVariant', {
              defaultValue: 'Create {{locale}} variant',
              locale: t(`cms:detail.locale.${routeLocale}`, { defaultValue: routeLocale }),
            })}
          </Button>
        ) : null}
      </div>
    );
  }
  if (loadState.status === 'error') {
    return (
      <div className="flex flex-col gap-4 py-12">
        <Alert tone="danger">{loadState.message}</Alert>
      </div>
    );
  }

  // Data is ready
  return (
    <VariantEditorReady
      key={`${resourceId}-${routeLocale}`}
      resourceDetail={loadState.resource}
      variantDetail={loadState.variant}
      initialRevision={loadState.revision}
      resourceId={resourceId}
      routeLocale={routeLocale}
      isDerivedLocale={isDerivedLocale}
      canWrite={canWrite}
      canReview={canReview}
      canPublish={canPublish}
      t={t}
      toast={toast}
      navigate={navigate}
    />
  );
}

// ---------------------------------------------------------------------------
// Ready state editor (extracted so hooks are not conditional)
// ---------------------------------------------------------------------------

interface VariantEditorReadyProps {
  resourceDetail: ResourceDetailResponse;
  variantDetail: VariantResponse;
  initialRevision: RevisionResponse;
  resourceId: string;
  routeLocale: string;
  isDerivedLocale: boolean;
  canWrite: boolean;
  canReview: boolean;
  canPublish: boolean;
  t: ReturnType<typeof useTranslation<['cms', 'common', 'library']>>['t'];
  toast: ReturnType<typeof useToast>;
  navigate: ReturnType<typeof useNavigate>;
}

function VariantEditorReady({
  resourceDetail,
  variantDetail,
  initialRevision,
  resourceId,
  routeLocale,
  isDerivedLocale,
  canWrite,
  canReview,
  canPublish,
  t,
  toast,
  navigate,
}: VariantEditorReadyProps) {
  const editorHandleRef = useRef<ContentEditorHandle>(null);

  // ─── Locale tabs state ──────────────────────────────────────────
  const availableLocales = useMemo(() => {
    const authored = (resourceDetail.variants ?? []).map((v) => v.locale);
    // Always show all four locale tabs; mark missing ones
    return ALL_LOCALES.map((loc) => ({
      locale: loc,
      exists: loc === 'sr-Cyrl'
        ? authored.includes('sr-Latn') // sr-Cyrl derives from sr-Latn
        : authored.includes(loc),
      // Find the variant's latest revision state for the badge
      revisionState: loc === 'sr-Cyrl'
        ? (resourceDetail.variants?.find((v) => v.locale === 'sr-Latn')?.revisions?.[0]?.state ?? null)
        : (resourceDetail.variants?.find((v) => v.locale === loc)?.revisions?.[0]?.state ?? null),
    }));
  }, [resourceDetail.variants]);

  // ─── Editor state (initialized from the loaded revision) ──────────
  const [title, setTitle] = useState(initialRevision.title ?? '');
  // The title wraps like a heading: size the field to its text (a fallback
  // for browsers without `field-sizing: content`).
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);
  const [summary, setSummary] = useState(initialRevision.summary ?? '');
  const [outcome, setOutcome] = useState(initialRevision.outcome ?? '');
  const [duration, setDuration] = useState<string>(
    minutesField(initialRevision.durationSeconds),
  );
  // The audience stored on the revision, kept so a save never rewrites it.
  const savedAudience = useMemo<AudienceEntries | null>(() => {
    const pa = initialRevision.proposedAudience as AudienceEntries | null;
    return pa && pa.length > 0 ? pa : null;
  }, [initialRevision.proposedAudience]);
  // Null until chosen, so the required check fires on submit.
  const [proposedAudience, setProposedAudience] = useState<AudienceEntries | null>(savedAudience);
  const [sources, setSources] = useState<Array<{ label: string; url: string }>>(() => {
    const raw = initialRevision.sources as Array<{ label: string; url?: string }> | null;
    return raw?.map((s) => ({ label: s.label, url: s.url ?? '' })) ?? [];
  });
  const [bodyDoc, setBodyDoc] = useState<ContentDocument>(
    (initialRevision.body as unknown as ContentDocument) ?? EMPTY_DOCUMENT,
  );
  const [revisionState, setRevisionState] = useState(initialRevision.state);

  // For sr-Cyrl, transliterate the document and metadata
  const displayTitle = isDerivedLocale ? transliterateText(title) : title;
  const displaySummary = isDerivedLocale ? transliterateText(summary) : summary;
  const displayOutcome = isDerivedLocale ? transliterateText(outcome) : outcome;
  const displayBody = isDerivedLocale ? transliterateDocument(bodyDoc, 'sr-Cyrl') : bodyDoc;

  // ─── IDs needed for API calls ─────────────────────────────────────
  const variantId = variantDetail.id;
  const revisionId = initialRevision.id;

  // ─── Autosave state ───────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const lockVersionRef = useRef(initialRevision.lockVersion);
  const [conflict, setConflict] = useState<ConflictState>({ active: false });
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflightRef = useRef(false);
  const trailingRef = useRef(false);
  const savingStartRef = useRef(0);
  const dirtyRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  // ─── Preview state ────────────────────────────────────────────────
  const [showPreview, setShowPreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<PreviewWidthKey>('mobile');

  // ─── Validation state ─────────────────────────────────────────────
  const [validationErrors, setValidationErrors] = useState<
    Array<{ id: string; label: string; message: string }>
  >([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // ─── Properties panel state ───────────────────────────────────────
  const [propsOpen, setPropsOpen] = useState<string[]>([]);

  // ─── Renderer labels ──────────────────────────────────────────────
  const rendererLabels: ContentRendererLabels = {
    transcript: t('library:renderer.transcript', { defaultValue: 'Transcript' }),
    noteWarning: t('library:renderer.noteWarning', { defaultValue: 'Warning' }),
    noteTip: t('library:renderer.noteTip', { defaultValue: 'Tip' }),
    noteDisclaimer: t('library:renderer.noteDisclaimer', { defaultValue: 'Disclaimer' }),
    noteDefault: t('library:renderer.noteDefault', { defaultValue: 'Note' }),
    checklist: t('library:renderer.checklist', { defaultValue: 'Checklist' }),
    opensInNewTab: t('library:renderer.opensInNewTab', { defaultValue: 'Opens in a new tab' }),
    downloadPdf: t('library:renderer.downloadPdf', { defaultValue: 'Download PDF' }),
    imageUnavailable: t('library:renderer.imageUnavailable', { defaultValue: 'Image unavailable' }),
  };

  // ─── Editor labels (Notion-style menus, bubble menu, block handle) ─
  const editorLabels: ContentEditorLabels = {
    editorLabel: t('cms:editor.toolbar.toolbar', { defaultValue: 'Content editor' }),
    slashMenu: {
      placeholder: t('cms:editor.slash.placeholder', { defaultValue: 'Filter blocks...' }),
      empty: t('cms:editor.slash.empty', { defaultValue: 'No matching blocks' }),
      groupText: t('cms:editor.slash.groupText', { defaultValue: 'Text' }),
      groupLists: t('cms:editor.slash.groupLists', { defaultValue: 'Lists' }),
      groupBlocks: t('cms:editor.slash.groupBlocks', { defaultValue: 'Blocks' }),
      groupMedia: t('cms:editor.slash.groupMedia', { defaultValue: 'Media' }),
    },
    slashItems: {
      paragraph: t('cms:editor.slash.paragraph', { defaultValue: 'Paragraph' }),
      paragraphHint: t('cms:editor.slash.paragraphHint', { defaultValue: 'Plain text' }),
      heading2: t('cms:editor.toolbar.heading', { defaultValue: 'Heading 2' }),
      heading2Hint: t('cms:editor.slash.heading2Hint', { defaultValue: 'Section heading' }),
      heading3: t('cms:editor.toolbar.heading3', { defaultValue: 'Heading 3' }),
      heading3Hint: t('cms:editor.slash.heading3Hint', { defaultValue: 'Subsection' }),
      bulletList: t('cms:editor.toolbar.bulletList'),
      bulletListHint: t('cms:editor.slash.bulletListHint', { defaultValue: 'Unordered list' }),
      numberedList: t('cms:editor.toolbar.orderedList'),
      numberedListHint: t('cms:editor.slash.numberedListHint', { defaultValue: 'Ordered list' }),
      checklist: t('cms:editor.toolbar.checklist', { defaultValue: 'Checklist' }),
      checklistHint: t('cms:editor.slash.checklistHint', { defaultValue: 'Checkable items' }),
      quote: t('cms:editor.toolbar.quote'),
      quoteHint: t('cms:editor.slash.quoteHint', { defaultValue: 'Blockquote' }),
      note: t('cms:editor.toolbar.note', { defaultValue: 'Professional note' }),
      noteHint: t('cms:editor.slash.noteHint', { defaultValue: 'Tip, warning or info' }),
      step: t('cms:editor.toolbar.step', { defaultValue: 'Practical step' }),
      stepHint: t('cms:editor.slash.stepHint', { defaultValue: 'Numbered instruction' }),
      cta: t('cms:editor.toolbar.cta', { defaultValue: 'Call to action' }),
      ctaHint: t('cms:editor.slash.ctaHint', { defaultValue: 'Action button' }),
      related: t('cms:editor.toolbar.related', { defaultValue: 'Related resource' }),
      relatedHint: t('cms:editor.slash.relatedHint', { defaultValue: 'Link to another article' }),
      image: t('cms:editor.toolbar.image'),
      imageHint: t('cms:editor.slash.imageHint', { defaultValue: 'Upload or paste' }),
    },
    bubbleMenu: {
      format: t('cms:editor.bubble.format'),
      bold: t('cms:editor.toolbar.bold'),
      link: t('cms:editor.toolbar.link'),
      linkUrl: t('cms:editor.toolbar.linkUrl'),
      linkInsert: t('cms:editor.toolbar.linkInsert'),
      linkRemove: t('cms:editor.toolbar.linkRemove'),
      linkInvalid: t('cms:editor.toolbar.linkInvalid', {
        defaultValue: 'Only https:// links and internal references are allowed.',
      }),
      turnInto: t('cms:editor.bubble.turnInto', { defaultValue: 'Turn into' }),
      paragraph: t('cms:editor.slash.paragraph', { defaultValue: 'Paragraph' }),
      heading2: t('cms:editor.toolbar.heading', { defaultValue: 'Heading 2' }),
      heading3: t('cms:editor.toolbar.heading3', { defaultValue: 'Heading 3' }),
      quote: t('cms:editor.toolbar.quote'),
    },
    blockHandle: {
      addBlock: t('cms:editor.block.add', { defaultValue: 'Add block' }),
      dragBlock: t('cms:editor.block.drag', { defaultValue: 'Drag or open menu' }),
      turnInto: t('cms:editor.bubble.turnInto', { defaultValue: 'Turn into' }),
      duplicate: t('cms:editor.block.duplicate', { defaultValue: 'Duplicate' }),
      delete: t('cms:editor.block.delete', { defaultValue: 'Delete' }),
      moveUp: t('cms:editor.block.moveUp', { defaultValue: 'Move up' }),
      moveDown: t('cms:editor.block.moveDown', { defaultValue: 'Move down' }),
      paragraph: t('cms:editor.slash.paragraph', { defaultValue: 'Paragraph' }),
      heading2: t('cms:editor.toolbar.heading', { defaultValue: 'Heading 2' }),
      heading3: t('cms:editor.toolbar.heading3', { defaultValue: 'Heading 3' }),
      quote: t('cms:editor.toolbar.quote'),
    },
    nodeView: {
      noteType: t('cms:editor.nodeView.noteType'),
      noteKinds: {
        tip: t('cms:editor.nodeView.noteKindTip'),
        warning: t('cms:editor.nodeView.noteKindWarning'),
        disclaimer: t('cms:editor.nodeView.noteKindDisclaimer'),
      },
      stepTitle: t('cms:editor.nodeView.stepTitle'),
      checklistLabel: '',
      ctaDialog: t('cms:editor.toolbar.cta'),
      ctaAction: t('cms:editor.nodeView.ctaAction'),
      ctaKinds: {
        suggest_topic: t('cms:editor.nodeView.ctaKindSuggestTopic'),
        open_content: t('cms:editor.nodeView.ctaKindOpenContent'),
        open_collection: t('cms:editor.nodeView.ctaKindOpenCollection'),
        open_service: t('cms:editor.nodeView.ctaKindOpenService'),
      },
      ctaContent: t('cms:editor.nodeView.ctaContent'),
      ctaCollection: t('cms:editor.nodeView.ctaCollection'),
      ctaService: t('cms:editor.nodeView.ctaService'),
      ctaServices: {
        library: t('cms:editor.nodeView.serviceLibrary'),
        general_questions: t('cms:editor.nodeView.serviceGeneralQuestions'),
        event_interest: t('cms:editor.nodeView.serviceEventInterest'),
      },
      ctaButtonLabel: t('cms:editor.nodeView.ctaButtonLabel'),
      ctaButtonLabelHint: t('cms:editor.nodeView.ctaButtonLabelHint'),
      ctaTargetRequired: t('cms:editor.nodeView.ctaTargetRequired'),
      relatedDialog: t('cms:editor.toolbar.related'),
      relatedChoose: t('cms:editor.nodeView.relatedChoose'),
      searchPlaceholder: t('cms:editor.nodeView.searchPlaceholder'),
      searching: t('cms:editor.nodeView.searching'),
      searchEmpty: t('cms:editor.nodeView.searchEmpty'),
      searchError: t('cms:editor.nodeView.searchError'),
      done: t('cms:editor.nodeView.done'),
      cancel: t('common:action.cancel'),
      close: t('common:nav.close'),
      imageAlt: t('cms:editor.image.altText'),
      imageCaption: t('cms:editor.nodeView.imageCaptionLabel'),
      imagePlaceholder: t('cms:editor.nodeView.imagePlaceholder'),
      imageUploading: t('cms:editor.image.uploading'),
      imageProcessing: t('cms:editor.image.processing'),
      imageUploadFailed: t('cms:editor.image.uploadFailed'),
    },
  };

  // ─── Core save function (one-in-flight with trailing) ─────────────
  const doSave = useCallback(async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.saveNotice'), tone: 'info' });
      setSaveStatus('saved');
      dirtyRef.current = false;
      setIsDirty(false);
      return;
    }

    if (conflict.active) return; // pause autosave during conflict

    if (inflightRef.current) {
      // Another save is in-flight: mark trailing
      trailingRef.current = true;
      return;
    }

    inflightRef.current = true;
    // flushSync forces the 'saving' indicator to render synchronously
    // before the async save call, so fast local saves don't skip the
    // transient "Saving..." state entirely.
    savingStartRef.current = Date.now();
    flushSync(() => {
      setSaveStatus('saving');
      setActionError(null);
    });

    try {
      const relIds = extractRelatedResourceIds(bodyDoc);
      const resp = await cmsApi.saveRevision(variantId, revisionId, {
        title,
        summary,
        outcome: outcome || null,
        durationSeconds: duration ? parseInt(duration, 10) * 60 : null,
        proposedAudience: proposedAudience ?? [],
        sources: sources.filter((s) => s.label.trim()),
        body: bodyDoc as unknown as Record<string, unknown>,
        ...(relIds.length > 0 ? { relatedResourceIds: relIds } : {}),
      } as RevisionUpdateRequest, lockVersionRef.current);

      // Keep the "Saving…" indicator visible for MIN_SAVING_DISPLAY_MS so the
      // transition is perceivable by users and observable by automated tests.
      const elapsed = Date.now() - savingStartRef.current;
      if (elapsed < MIN_SAVING_DISPLAY_MS) {
        await new Promise((r) => setTimeout(r, MIN_SAVING_DISPLAY_MS - elapsed));
      }

      lockVersionRef.current = resp.lockVersion;
      setSaveStatus('saved');
      // Only clear dirty if no typing happened during the save
      if (!trailingRef.current) {
        dirtyRef.current = false;
        setIsDirty(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'content_edit_conflict') {
        const details = (err as ApiError & { details?: Record<string, unknown> }).details;
        setConflict({
          active: true,
          serverLockVersion: (details?.lockVersion as number) ?? undefined,
          serverTitle: (details?.title as string) ?? undefined,
          serverSummary: (details?.summary as string) ?? undefined,
          serverOutcome: (details?.outcome as string) ?? undefined,
          serverDurationSeconds: (details?.durationSeconds as number) ?? undefined,
          serverBody: (details?.body as ContentDocument) ?? undefined,
          serverUpdatedAt: (details?.updatedAt as string) ?? undefined,
        });
        setSaveStatus('conflict');
      } else {
        setSaveStatus('error');
        const code = (err as { code?: string }).code ?? 'unknown';
        setActionError(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
      }
    } finally {
      inflightRef.current = false;

      // If a trailing save was queued, fire it now (use the ref for fresh state)
      if (trailingRef.current) {
        trailingRef.current = false;
        // Next tick to avoid recursion
        setTimeout(() => { void doSaveRef.current(); }, 0);
      }
    }
  }, [bodyDoc, conflict.active, duration, outcome, proposedAudience, revisionId, sources, summary, t, title, toast, variantId]);

  // Keep doSave ref up to date for the timeout callback
  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // ─── Debounced autosave scheduler ─────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (isDerivedLocale) return;
    dirtyRef.current = true;
    setIsDirty(true);
    clearTimeout(saveTimeoutRef.current);
    if (!isSampleDataMode) {
      setSaveStatus('idle');
    }
    saveTimeoutRef.current = setTimeout(() => {
      void doSaveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, [isDerivedLocale]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimeoutRef.current);
  }, []);

  // ─── Flush pending save on unmount ────────────────────────────────
  useEffect(() => {
    return () => {
      if (dirtyRef.current && !isSampleDataMode && !isDerivedLocale) {
        // Fire the save synchronously before leaving
        clearTimeout(saveTimeoutRef.current);
        void doSaveRef.current();
      }
    };
  }, [isDerivedLocale]);

  // ─── Navigation blocking (useBlocker + beforeunload) ──────────────
  useBlocker({
    shouldBlockFn: () => dirtyRef.current && !isSampleDataMode,
    enableBeforeUnload: () => dirtyRef.current && !isSampleDataMode,
    disabled: isDerivedLocale || isSampleDataMode,
  });

  // ─── Metadata change handler ──────────────────────────────────────
  const handleFieldChange = () => {
    scheduleSave();
  };

  // ─── Body change handler ──────────────────────────────────────────
  const handleBodyChange = (doc: ContentDocument) => {
    setBodyDoc(doc);
    scheduleSave();
  };

  // ─── Image upload ─────────────────────────────────────────────────
  const imageUpload = useImageUpload({
    ownerCategoryId: resourceDetail.primaryCategoryId ?? 'uncategorized',
    onReady: (assetId) => {
      editorHandleRef.current?.insertImageNode(assetId);
      toast.add({ title: t('cms:editor.saved'), tone: 'success' });
    },
  });

  const handleInsertImage = () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.uploadNotice'), tone: 'info' });
      return;
    }
    imageUpload.pickAndUpload();
  };

  // Image upload handler for the node view (the ImageView triggers the file
  // input itself; this handler runs the upload + poll cycle and returns the
  // assetId and preview URL).
  const imageUploadHandler: ImageUploadHandler = useCallback(
    async (file, onStatus) => {
      onStatus(t('cms:editor.image.uploading'));

      const metadata = {
        kind: 'image' as const,
        ownerCategoryId: resourceDetail.primaryCategoryId ?? 'uncategorized',
        licenseKind: 'owned' as const,
      };

      // The node view shows a rejection's message, so map API codes to copy.
      const result = await cmsApi.uploadMedia(file, metadata).catch((err: unknown) => {
        const code = (err as { code?: string }).code ?? 'unknown';
        throw new Error(t(`cms:error.${code}`, { defaultValue: t('cms:editor.image.uploadFailed') }));
      });
      const previewUrl = `/api/ops/cms/media/${result.assetId}/original`;

      // The upload response includes the actual asset state from the DB.
      // When processing ran synchronously (dev/test, no Redis), it is
      // already 'ready' and we can skip polling.
      if (result.state === 'ready') {
        return { assetId: result.assetId, previewUrl };
      }

      onStatus(t('cms:editor.image.processing'));

      // Poll the preview endpoint (content.preview permission, which all
      // authors have) instead of the detail endpoint (media.manage).
      // Returns 200 when ready, 409 when not yet processed.
      const MAX_POLLS = 30;
      const POLL_MS = 2_000;
      for (let i = 0; i < MAX_POLLS; i++) {
        try {
          const resp = await fetch(previewUrl, {
            method: 'HEAD',
            credentials: 'include',
          });
          if (resp.ok) {
            return { assetId: result.assetId, previewUrl };
          }
        } catch {
          // Network error during poll — keep trying
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      throw new Error(t('cms:error.media_not_ready'));
    },
    [resourceDetail.primaryCategoryId, t],
  );

  const resourceSearchHandler: ResourceSearchHandler = useCallback(
    async (query) => {
      const result = await cmsApi.listResources({ q: query, limit: 10 });
      return result.items
        .filter((r) => r.title)
        .map((r) => ({ id: r.id, title: r.title!, type: r.type }));
    },
    [],
  );

  // ─── Validate before submit ───────────────────────────────────────
  const validateForSubmit = (): boolean => {
    const errs: typeof validationErrors = [];

    if (!title.trim()) {
      errs.push({
        id: 'title',
        label: t('cms:editor.titleField'),
        message: t('cms:editor.validation.titleRequired'),
      });
    }
    if (title.length > 200) {
      errs.push({
        id: 'title',
        label: t('cms:editor.titleField'),
        message: t('cms:editor.validation.titleTooLong'),
      });
    }
    if (summary.length > 500) {
      errs.push({
        id: 'summary',
        label: t('cms:editor.summary'),
        message: t('cms:editor.validation.summaryTooLong'),
      });
    }
    if (outcome.length > 300) {
      errs.push({
        id: 'outcome',
        label: t('cms:editor.outcome'),
        message: t('cms:editor.validation.outcomeTooLong'),
      });
    }

    // Audience required before submit
    if (!proposedAudience) {
      errs.push({
        id: 'proposedAudience',
        label: t('cms:editor.proposedAudience'),
        message: t('cms:editor.validation.audienceRequired'),
      });
    }

    // Validate body
    const bodyResult = validateContentDocument(bodyDoc);
    if (!bodyResult.ok) {
      for (const error of bodyResult.errors) {
        errs.push({
          id: error.path ?? 'body',
          label: t('cms:editor.body'),
          message: t(`cms:editor.validation.${error.code ?? 'bodyInvalid'}`, {
            defaultValue: error.message,
          }),
        });
      }
    }

    setValidationErrors(errs);
    return errs.length === 0;
  };

  // ─── Submit for review ────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!validateForSubmit()) return;

    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.submitNotice'), tone: 'info' });
      return;
    }

    // Flush any pending save first
    clearTimeout(saveTimeoutRef.current);
    if (dirtyRef.current) {
      await doSaveRef.current();
    }

    setActionError(null);
    try {
      const updated = await cmsApi.submitRevision(revisionId);
      setRevisionState(updated.state);
      toast.add({ title: t('cms:editor.submitted'), tone: 'success' });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      const details = (err as { details?: Record<string, unknown> }).details;
      const fieldName = (details?.field as string) ?? '';
      setActionError(t(`cms:error.${code}`, { field: fieldName, defaultValue: t('cms:error.unknown') }));
    }
  };

  // ─── Approve ──────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.approveNotice'), tone: 'info' });
      return;
    }

    setActionError(null);
    try {
      const updated = await cmsApi.approveRevision(revisionId);
      setRevisionState(updated.state);
      toast.add({ title: t('cms:editor.approved'), tone: 'success' });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      setActionError(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
    }
  };

  // ─── Return for changes ──────────────────────────────────────────
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnErrors, setReturnErrors] = useState<FormError[]>([]);
  const [returnPending, setReturnPending] = useState(false);
  const returnFormRef = useRef<HTMLFormElement>(null);
  // The confirm button of AlertDialogContent also closes the dialog; while a
  // confirm is handled that close is ignored, so a failure stays on screen.
  const confirmingRef = useRef(false);

  const holdDialogOpen = () => {
    confirmingRef.current = true;
    queueMicrotask(() => {
      confirmingRef.current = false;
    });
  };

  const closeReturnDialog = () => {
    setReturnErrors([]);
    setReturnDialogOpen(false);
  };

  const failReturn = (message: string) =>
    setReturnErrors([{ id: RETURN_COMMENT_ID, label: t('cms:editor.returnComment'), message }]);

  const handleReturnForChanges = async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.saveNotice'), tone: 'info' });
      closeReturnDialog();
      return;
    }

    const comment = String(
      new FormData(returnFormRef.current ?? undefined).get('comment') ?? '',
    ).trim();
    if (!comment) {
      failReturn(t('cms:editor.returnCommentRequired'));
      return;
    }

    setReturnErrors([]);
    setReturnPending(true);
    try {
      const updated = await cmsApi.returnForChanges(revisionId, comment);
      setRevisionState(updated.state);
      toast.add({ title: t('cms:editor.returnedForChanges'), tone: 'success' });
      closeReturnDialog();
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      failReturn(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
    } finally {
      setReturnPending(false);
    }
  };

  // ─── Publish dialog ──────────────────────────────────────────────
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishPending, setPublishPending] = useState(false);

  const closePublishDialog = () => {
    setPublishError(null);
    setPublishDialogOpen(false);
  };

  const handlePublish = async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.publishNotice'), tone: 'info' });
      closePublishDialog();
      return;
    }

    // The approved revision's proposed audience is the widest the API accepts (C-12).
    if (!proposedAudience) {
      setPublishError(t('cms:editor.validation.audienceRequired'));
      return;
    }

    setPublishError(null);
    setPublishPending(true);
    try {
      await cmsApi.publishNow({ resourceId, audience: proposedAudience });
      toast.add({ title: t('cms:detail.publishSuccess'), tone: 'success' });
      closePublishDialog();
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      setPublishError(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
    } finally {
      setPublishPending(false);
    }
  };

  // ─── New working revision ─────────────────────────────────────────
  const handleNewRevision = async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.saveNotice'), tone: 'info' });
      return;
    }

    setActionError(null);
    try {
      const newRev = await cmsApi.createNewRevision(variantId);
      lockVersionRef.current = newRev.lockVersion;
      setTitle(newRev.title ?? '');
      setSummary(newRev.summary ?? '');
      setOutcome(newRev.outcome ?? '');
      setDuration(minutesField(newRev.durationSeconds));
      setBodyDoc((newRev.body as unknown as ContentDocument) ?? EMPTY_DOCUMENT);
      setRevisionState(newRev.state);
      toast.add({ title: t('cms:editor.newRevision'), tone: 'success' });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      setActionError(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
    }
  };

  // ─── Conflict resolution ──────────────────────────────────────────
  const handleReloadServer = () => {
    if (conflict.serverTitle != null) setTitle(conflict.serverTitle);
    if (conflict.serverSummary != null) setSummary(conflict.serverSummary);
    if (conflict.serverOutcome != null) setOutcome(conflict.serverOutcome);
    if (conflict.serverDurationSeconds != null) setDuration(minutesField(conflict.serverDurationSeconds));
    if (conflict.serverBody != null) {
      setBodyDoc(conflict.serverBody);
      editorHandleRef.current?.setContent(conflict.serverBody);
    }
    if (conflict.serverLockVersion != null) lockVersionRef.current = conflict.serverLockVersion;
    setConflict({ active: false });
    setSaveStatus('idle');
    dirtyRef.current = false;
    setIsDirty(false);
  };

  const handleOverwrite = () => {
    if (conflict.serverLockVersion != null) lockVersionRef.current = conflict.serverLockVersion;
    setConflict({ active: false });
    setSaveStatus('idle');
    // Re-save with our content and the server's lockVersion
    scheduleSave();
  };

  // ─── Source management ────────────────────────────────────────────
  const addSource = () => {
    setSources((s) => [...s, { label: '', url: '' }]);
    handleFieldChange();
  };

  const removeSource = (index: number) => {
    setSources((s) => s.filter((_, i) => i !== index));
    handleFieldChange();
  };

  const updateSource = (index: number, field: 'label' | 'url', value: string) => {
    setSources((s) => s.map((src, i) => (i === index ? { ...src, [field]: value } : src)));
    handleFieldChange();
  };

  // ─── Dialog / preview motion ──────────────────────────────────────
  const previewMotion = useMotionPreset('disclosure');
  const currentPreviewWidth = PREVIEW_WIDTHS.find((p) => p.key === previewWidth)?.width ?? 390;

  // ─── Save status indicator ────────────────────────────────────────
  const saveStatusLabel = {
    idle: isDirty ? t('cms:editor.unsaved') : '',
    saving: t('cms:editor.saving'),
    saved: t('cms:editor.saved'),
    offline: t('cms:error.network'),
    conflict: t('cms:error.content_edit_conflict'),
    error: t('cms:editor.autosaveError'),
  }[saveStatus];

  const saveStatusTone =
    saveStatus === 'error' || saveStatus === 'conflict'
      ? 'text-danger'
      : saveStatus === 'saved'
        ? 'text-success'
        : 'text-text-secondary';

  // ─── Audience options ─────────────────────────────────────────────
  const audienceChoice: AudienceChoice | '' =
    proposedAudience == null ? '' : isAllEligible(proposedAudience) ? 'all_eligible' : 'saved';
  const audienceLabel = (entries: AudienceEntries | null) =>
    entries == null
      ? t('cms:editor.audienceNone')
      : isAllEligible(entries)
        ? t('cms:editor.audienceAll')
        : t('cms:editor.audienceSaved', { count: entries.length });
  const audienceOptions = [
    { value: 'all_eligible', label: t('cms:editor.audienceAll') },
    ...(savedAudience && !isAllEligible(savedAudience)
      ? [{ value: 'saved', label: audienceLabel(savedAudience) }]
      : []),
  ];

  // ─── Revision state badge ─────────────────────────────────────────
  const revisionStateBadge = revisionState
    ? t(`cms:detail.revisionState.${revisionState}`, { defaultValue: revisionState })
    : null;

  // ─── Whether editing is allowed ───────────────────────────────────
  const editable = canWrite && !isDerivedLocale && (revisionState === 'draft' || revisionState === 'changes_requested');

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Heading level={1}>{t('cms:editor.title')}</Heading>
          {revisionStateBadge ? (
            <span className="type-metadata rounded-full bg-surface-raised px-2 py-0.5 text-text-secondary">
              {revisionStateBadge}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {saveStatusLabel ? (
            <span className={cn('type-metadata', saveStatusTone)}>
              {saveStatusLabel}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? t('cms:editor.previewClose') : t('cms:editor.preview')}
          </Button>
        </div>
      </div>

      {/* Locale tabs */}
      <Tabs
        value={routeLocale}
        onValueChange={(value) => {
          if (value && value !== routeLocale) {
            void navigate({
              to: '/cms/resources/$resourceId/variants/$locale',
              params: { resourceId, locale: value },
            });
          }
        }}
      >
        <TabList label={t('cms:detail.variants')}>
          {availableLocales.map(({ locale, exists, revisionState: revState }) => (
            <Tab
              key={locale}
              value={locale}
              className={cn(!exists && 'opacity-50')}
            >
              {t(`cms:detail.locale.${locale}`, { defaultValue: locale })}
              {revState ? (
                <span className="ml-1 type-metadata text-text-secondary">
                  ({t(`cms:detail.revisionState.${revState}`, { defaultValue: revState })})
                </span>
              ) : null}
            </Tab>
          ))}
        </TabList>

        {/* Only render the current locale's panel */}
        <TabPanel value={routeLocale}>
          {/* Derived locale notice */}
          {isDerivedLocale ? (
            <Alert tone="info" className="mb-4">
              {t('cms:editor.derivedLocaleNotice')}
            </Alert>
          ) : null}

          {/* Conflict notice */}
          {conflict.active ? (
            <Alert tone="warning" title={t('cms:error.content_edit_conflict')} className="mb-4">
              {conflict.serverUpdatedAt ? (
                <p className="type-metadata text-text-secondary mt-1">
                  {t('cms:editor.conflictUpdatedAt', {
                    time: new Date(conflict.serverUpdatedAt).toLocaleTimeString(),
                    defaultValue: 'Server version updated at {{time}}',
                  })}
                </p>
              ) : null}
              <div className="mt-2 flex gap-3">
                <Button variant="secondary" size="sm" onClick={handleReloadServer}>
                  {t('cms:error.conflict_reload')}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleOverwrite}>
                  {t('cms:error.conflict_overwrite')}
                </Button>
              </div>
            </Alert>
          ) : null}

          {/* Action error */}
          {actionError ? (
            <Alert tone="danger" className="mb-4">{actionError}</Alert>
          ) : null}

          {/* Validation errors */}
          {validationErrors.length > 0 ? (
            <FormErrorSummary
              title={t('cms:editor.validation.title')}
              errors={validationErrors}
              className="mb-4"
            />
          ) : null}

          <div className="flex gap-6">
            {/* Main editor column */}
            <div className="flex-1 min-w-0 flex flex-col gap-6">
              {/* The writing sheet: title, properties and body on one white
                  card, with a left gutter the block handle sits in. */}
              <div
                data-testid="writing-sheet"
                className="mx-auto flex w-full max-w-[52rem] flex-col gap-6 rounded-control border border-border-subtle bg-surface py-10 pr-10 pl-16 shadow-low"
              >
              {/* Title — large borderless heading input (Notion-style) */}
              {isDerivedLocale ? (
                <p className="w-full p-0 type-display text-text">{displayTitle}</p>
              ) : (
                <textarea
                  id="title"
                  ref={titleRef}
                  rows={1}
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); handleFieldChange(); }}
                  // One field, many lines: a long title wraps inside the sheet
                  // instead of being cut off, and Enter never adds a line.
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                  placeholder={t('cms:editor.titlePlaceholder')}
                  readOnly={!editable}
                  aria-label={t('cms:editor.titleField')}
                  aria-required
                  className="field-sizing-content w-full resize-none overflow-hidden border-0 bg-transparent p-0 type-display text-text placeholder:text-text-secondary focus:outline-none"
                />
              )}

              {/* Collapsible properties panel */}
              {!isDerivedLocale ? (
                <Accordion
                  multiple
                  value={propsOpen}
                  onValueChange={setPropsOpen}
                  className="border-y border-border-subtle"
                >
                  <AccordionItem
                    value="properties"
                    title={t('cms:editor.propertiesPanel', { defaultValue: 'Properties' })}
                    headingLevel={3}
                  >
                    <div className="flex flex-col gap-4">
                      <Field label={t('cms:editor.summary')} id="summary">
                        <textarea
                          value={summary}
                          onInput={(e) => { setSummary((e.target as HTMLTextAreaElement).value); handleFieldChange(); }}
                          placeholder={t('cms:editor.summaryPlaceholder')}
                          readOnly={!editable}
                          rows={3}
                          className="min-h-24 px-3 py-2 resize-y rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                        />
                      </Field>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label={t('cms:editor.outcome')} id="outcome">
                          <Input
                            value={outcome}
                            onChange={(e) => { setOutcome(e.target.value); handleFieldChange(); }}
                            placeholder={t('cms:editor.outcomePlaceholder')}
                            readOnly={!editable}
                          />
                        </Field>

                        <Field label={t('cms:editor.duration')} id="duration">
                          <Input
                            type="number"
                            value={duration}
                            onChange={(e) => { setDuration(e.target.value); handleFieldChange(); }}
                            placeholder={t('cms:editor.durationPlaceholder')}
                            readOnly={!editable}
                          />
                        </Field>
                      </div>

                      <Field label={t('cms:editor.proposedAudience')} id="proposedAudience">
                        <Select
                          options={audienceOptions}
                          value={audienceChoice}
                          onValueChange={(v) => {
                            setProposedAudience(v === 'saved' ? savedAudience : ALL_ELIGIBLE);
                            handleFieldChange();
                          }}
                          disabled={!editable}
                        />
                      </Field>

                      {/* Sources */}
                      <div>
                        <Heading level={4}>{t('cms:editor.sources')}</Heading>
                        {sources.map((source, i) => (
                          <div key={i} className="mt-3 flex items-end gap-3">
                            <Field label={t('cms:editor.sourcesLabel')} className="flex-1">
                              <Input
                                value={source.label}
                                onChange={(e) => updateSource(i, 'label', e.target.value)}
                                readOnly={!editable}
                              />
                            </Field>
                            <Field label={t('cms:editor.sourcesUrl')} className="flex-1">
                              <Input
                                value={source.url}
                                onChange={(e) => updateSource(i, 'url', e.target.value)}
                                readOnly={!editable}
                              />
                            </Field>
                            {editable ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeSource(i)}
                              >
                                {t('cms:editor.removeSource')}
                              </Button>
                            ) : null}
                          </div>
                        ))}
                        {editable ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-3"
                            onClick={addSource}
                          >
                            {t('cms:editor.addSource')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </AccordionItem>
                </Accordion>
              ) : null}

              {/* sr-Cyrl read-only metadata */}
              {isDerivedLocale ? (
                <div className="flex flex-col gap-4 border-y border-border-subtle py-4">
                  <p className="type-label text-text-secondary">{t('cms:editor.summary')}</p>
                  <p className="type-body text-text">{displaySummary || '-'}</p>
                  <p className="type-label text-text-secondary">{t('cms:editor.outcome')}</p>
                  <p className="type-body text-text">{displayOutcome || '-'}</p>
                </div>
              ) : null}

              {/* Body editor */}
              <div>
                <Heading level={3} className="sr-only">{t('cms:editor.body')}</Heading>
                <div>
                  {isDerivedLocale ? (
                    <div className="rounded-control border border-border-control bg-surface p-4 min-h-[300px]">
                      <ContentRenderer
                        document={displayBody}
                        media={{}}
                        mediaUrl={noopMediaUrl}
                        resolveCta={noopResolveCta}
                        resolveRelated={noopResolveRelated}
                        resolveInternalLink={noopResolveInternalLink}
                        labels={rendererLabels}
                        documentKey={`${resourceId}-${routeLocale}-derived`}
                        headingOffset={0}
                      />
                    </div>
                  ) : (
                    <ContentEditor
                      initialDocument={bodyDoc}
                      onChange={handleBodyChange}
                      editable={editable}
                      placeholder={t('cms:editor.bodyPlaceholder')}
                      blockPlaceholder={t('cms:editor.blockPlaceholder')}
                      headingPlaceholder={t('cms:editor.headingPlaceholder')}
                      labels={editorLabels}
                      onInsertImage={handleInsertImage}
                      imageUploadHandler={imageUploadHandler}
                      resourceSearchHandler={resourceSearchHandler}
                      editorRef={editorHandleRef}
                    />
                  )}

                  {/* Image upload status */}
                  {imageUpload.phase !== 'idle' && imageUpload.phase !== 'ready' ? (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      {imageUpload.phase === 'uploading' || imageUpload.phase === 'processing' ? (
                        <>
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border-control border-t-primary" />
                          <span className="text-text-secondary">{imageUpload.progressLabel}</span>
                        </>
                      ) : null}
                      {imageUpload.phase === 'picking' ? (
                        <span className="text-text-secondary">{t('cms:editor.image.upload')}</span>
                      ) : null}
                      {imageUpload.phase === 'error' ? (
                        <Alert tone="danger" className="flex-1">
                          {imageUpload.error}
                          <Button
                            variant="secondary"
                            size="sm"
                            className="ml-2"
                            onClick={imageUpload.reset}
                          >
                            {t('cms:editor.toolbar.undo')}
                          </Button>
                        </Alert>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              </div>

              {/* Actions */}
              {!isDerivedLocale ? (
                <div className="mx-auto flex w-full max-w-[52rem] gap-3">
                  {canWrite && editable ? (
                    <Button variant="primary" onClick={handleSubmit}>
                      {t('cms:editor.submit')}
                    </Button>
                  ) : null}
                  {canReview && revisionState === 'in_review' ? (
                    <>
                      <Button variant="secondary" onClick={handleApprove}>
                        {t('cms:editor.approve')}
                      </Button>
                      <Button variant="ghost" onClick={() => setReturnDialogOpen(true)}>
                        {t('cms:editor.returnChanges')}
                      </Button>
                    </>
                  ) : null}
                  {canPublish && revisionState === 'approved' ? (
                    <Button variant="primary" onClick={() => setPublishDialogOpen(true)}>
                      {t('cms:detail.publishNow')}
                    </Button>
                  ) : null}
                  {canWrite && (revisionState === 'approved' || revisionState === 'superseded') ? (
                    <Button variant="secondary" onClick={handleNewRevision}>
                      {t('cms:editor.newRevision')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Preview panel */}
            <MotionFeatures>
              <AnimatePresence>
                {showPreview ? (
                  <m.div
                    {...previewMotion}
                    className="w-[400px] shrink-0 flex flex-col gap-4 overflow-hidden"
                  >
                    {/* Width switcher */}
                    <div className="flex gap-2">
                      {PREVIEW_WIDTHS.map((pw) => (
                        <Button
                          key={pw.key}
                          variant={previewWidth === pw.key ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => setPreviewWidth(pw.key)}
                        >
                          {t(`cms:editor.previewWidth.${pw.key}`)}
                        </Button>
                      ))}
                    </div>

                    {/* Preview frame */}
                    <div
                      className="overflow-x-auto rounded-control border border-border-subtle bg-surface"
                      style={{ maxHeight: 'calc(100vh - 200px)' }}
                    >
                      <div
                        data-testid="preview-frame"
                        className="mx-auto overflow-y-auto p-4"
                        style={{ width: `${currentPreviewWidth}px` }}
                      >
                        <h1 className="type-screen-title text-text">
                          {displayTitle || t('cms:editor.titlePlaceholder')}
                        </h1>
                        {displayOutcome ? (
                          <p className="mt-2 type-metadata text-text-secondary">{displayOutcome}</p>
                        ) : null}

                        <div className="mt-6">
                          <ContentRenderer
                            document={displayBody}
                            media={{}}
                            mediaUrl={noopMediaUrl}
                            resolveCta={noopResolveCta}
                            resolveRelated={noopResolveRelated}
                            resolveInternalLink={noopResolveInternalLink}
                            labels={rendererLabels}
                            documentKey={`preview-${resourceId}-${routeLocale}`}
                            headingOffset={0}
                          />
                        </div>
                      </div>
                    </div>
                  </m.div>
                ) : null}
              </AnimatePresence>
            </MotionFeatures>
          </div>
        </TabPanel>
      </Tabs>

      <AlertDialog
        open={returnDialogOpen}
        onOpenChange={(next) => {
          if (next || confirmingRef.current || returnPending) return;
          closeReturnDialog();
        }}
      >
        <AlertDialogContent
          title={t('cms:editor.returnChanges')}
          description={t('cms:editor.returnDescription')}
          confirmLabel={t('cms:editor.returnChanges')}
          cancelLabel={t('common:action.cancel')}
          onConfirm={() => {
            holdDialogOpen();
            void handleReturnForChanges();
          }}
          confirmPending={returnPending}
        >
          <form
            ref={returnFormRef}
            noValidate
            onSubmit={(e) => e.preventDefault()}
            className="space-y-4"
          >
            <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={returnErrors} />
            <Field
              id={RETURN_COMMENT_ID}
              label={t('cms:editor.returnComment')}
              error={returnErrors[0]?.message}
              required
            >
              <Textarea
                name="comment"
                rows={4}
                placeholder={t('cms:editor.returnCommentPlaceholder')}
                onChange={() => { if (returnErrors.length) setReturnErrors([]); }}
              />
            </Field>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={publishDialogOpen}
        onOpenChange={(next) => {
          if (next || confirmingRef.current || publishPending) return;
          closePublishDialog();
        }}
      >
        <AlertDialogContent
          title={t('cms:editor.publishDialog')}
          description={t('cms:editor.publishConfirm')}
          confirmLabel={t('cms:detail.publishNow')}
          cancelLabel={t('common:action.cancel')}
          onConfirm={() => {
            holdDialogOpen();
            void handlePublish();
          }}
          confirmPending={publishPending}
        >
          <div className="space-y-4">
            {publishError ? <Alert tone="danger">{publishError}</Alert> : null}
            <dl className="space-y-1">
              <dt className="type-label text-text">{t('cms:editor.proposedAudience')}</dt>
              <dd className="text-text-secondary">{audienceLabel(proposedAudience)}</dd>
            </dl>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Simple sr-Latn -> sr-Cyrl text transliteration for metadata strings.
 * Wraps the real function with a safe fallback.
 */
function transliterateText(text: string): string {
  try {
    return transliterateFn(text);
  } catch {
    return text;
  }
}

// Suppress unused type references (used only in sample data)
void (0 as unknown as SampleContentVariant);
void (0 as unknown as SampleAuthoredLocale);
void (0 as unknown as AuthoredLocale);

export const Route = createFileRoute(
  '/_authenticated/cms/resources/$resourceId/variants/$locale',
)({
  beforeLoad: async ({ context }) => {
    const { resolveRouteAuth } = await import('../../../../../../auth');
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    const hasAccess =
      principal &&
      (can(principal, 'content.write', undefined, effectiveActions) ||
        can(principal, 'content.review', undefined, effectiveActions) ||
        can(principal, 'content.preview', undefined, effectiveActions));
    if (!hasAccess) {
      throw redirect({ to: '/cms/resources' });
    }
  },
  component: VariantEditorPage,
});
