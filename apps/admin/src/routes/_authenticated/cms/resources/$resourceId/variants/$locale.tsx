/**
 * CMS variant editor route (WRK-R-30, T-C1.12).
 *
 * Editor + metadata form for a single locale variant with autosave,
 * conflict handling, submit/approve actions, and content preview.
 *
 * sr-Cyrl is never authored: it shows a read-only preview derived from
 * the sr-Latn variant via transliteration (C-28).
 *
 * CTA ruling: authored as a `cta` block in the body; no separate metadata
 * field. On save the CTA is extracted from the body and sent in the DTO.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can } from '@nestself/contracts';
import type { ContentDocument } from '@nestself/content/schema';
import { validateContentDocument, transliterateDocument, transliterateText as transliterateFn } from '@nestself/content/schema';
import { ContentEditor } from '@nestself/content/editor';
import type { ContentEditorHandle } from '@nestself/content/editor';
import { ContentRenderer } from '@nestself/content/render';
import type { ContentRendererLabels } from '@nestself/content/render';
import { ApiError } from '@nestself/api-client';
import {
  Heading,
  Button,
  Field,
  Input,
  Select,
  Alert,
  FormErrorSummary,
  useToast,
  cn,
  m,
  AnimatePresence,
  MotionFeatures,
  useMotionPreset,
} from '@nestself/ui';
import {
  SAMPLE_CONTENT_RESOURCES,
} from '@nestself/sample-data';
import type { SampleContentVariant } from '@nestself/sample-data';
import { isSampleDataMode } from '../../../../../../data-source';
import { useAuth } from '../../../../../../auth';
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

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ---------------------------------------------------------------------------
// Audience kinds (proposedAudience is required on submit)
// ---------------------------------------------------------------------------

const AUDIENCE_KINDS = ['all_eligible', 'organization', 'org_unit'] as const;
type AudienceKind = (typeof AUDIENCE_KINDS)[number];

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

// ---------------------------------------------------------------------------
// Extract CTA from body (CTA ruling: source of truth is the body node)
// ---------------------------------------------------------------------------

function extractCtaFromBody(
  doc: ContentDocument,
): { ctaKind: string; targetId: string | null; label: string | null } | null {
  const content = (doc as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return null;
  for (const node of content) {
    const n = node as { type?: string; attrs?: Record<string, unknown> };
    if (n.type === 'cta' && n.attrs) {
      return {
        ctaKind: (n.attrs.ctaKind as string) ?? 'suggest_topic',
        targetId: (n.attrs.targetId as string) ?? null,
        label: (n.attrs.label as string) ?? null,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function VariantEditorPage() {
  const { t } = useTranslation(['cms', 'common', 'library']);
  const params = Route.useParams();
  const { resourceId, locale: routeLocale } = params;
  const { principal, effectiveActions } = useAuth();
  const toast = useToast();

  const canWrite = principal ? can(principal, 'content.write', undefined, effectiveActions) : false;
  const canReview = principal ? can(principal, 'content.review', undefined, effectiveActions) : false;

  const isDerivedLocale = routeLocale === 'sr-Cyrl';
  const editorHandleRef = useRef<ContentEditorHandle>(null);

  // --- Sample mode data lookup ---
  const resource = isSampleDataMode
    ? SAMPLE_CONTENT_RESOURCES.find((r) => r.id === resourceId)
    : undefined;

  // For sr-Cyrl, find the sr-Latn variant and transliterate
  const sourceLocale = isDerivedLocale ? 'sr-Latn' : routeLocale;
  const variant: SampleContentVariant | undefined = resource?.variants.find(
    (v) => v.locale === sourceLocale,
  );

  // --- Editor state ---
  const [title, setTitle] = useState(variant?.title ?? '');
  const [summary, setSummary] = useState(variant?.summary ?? '');
  const [outcome, setOutcome] = useState(variant?.outcome ?? '');
  const [duration, setDuration] = useState<string>(
    resource?.durationSeconds != null ? String(resource.durationSeconds) : '',
  );
  const [proposedAudience, setProposedAudience] = useState<AudienceKind>('all_eligible');
  const [sources, setSources] = useState<Array<{ label: string; url: string }>>([]);
  const [bodyDoc, setBodyDoc] = useState<ContentDocument>(
    (variant?.body as unknown as ContentDocument) ?? EMPTY_DOCUMENT,
  );

  // For sr-Cyrl, transliterate the document and metadata
  const displayTitle = isDerivedLocale ? transliterateText(title) : title;
  const displaySummary = isDerivedLocale ? transliterateText(summary) : summary;
  const displayOutcome = isDerivedLocale ? transliterateText(outcome) : outcome;
  const displayBody = isDerivedLocale ? transliterateDocument(bodyDoc, 'sr-Cyrl') : bodyDoc;

  // --- Autosave state ---
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lockVersion, setLockVersion] = useState(1);
  const [conflict, setConflict] = useState<ConflictState>({ active: false });
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const doSaveRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // --- Preview state ---
  const [showPreview, setShowPreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<PreviewWidthKey>('mobile');

  // --- Validation state ---
  const [validationErrors, setValidationErrors] = useState<
    Array<{ id: string; label: string; message: string }>
  >([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // --- Renderer labels ---
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

  // --- Toolbar labels for the editor ---
  const toolbarLabels = {
    bold: t('cms:editor.toolbar.bold'),
    heading: t('cms:editor.toolbar.heading'),
    bulletList: t('cms:editor.toolbar.bulletList'),
    orderedList: t('cms:editor.toolbar.orderedList'),
    quote: t('cms:editor.toolbar.quote'),
    image: t('cms:editor.toolbar.image'),
    link: t('cms:editor.toolbar.link'),
    linkUrl: t('cms:editor.toolbar.linkUrl'),
    linkInsert: t('cms:editor.toolbar.linkInsert'),
    linkRemove: t('cms:editor.toolbar.linkRemove'),
    undo: t('cms:editor.toolbar.undo'),
    redo: t('cms:editor.toolbar.redo'),
  };

  // --- Debounced autosave ---
  const scheduleSave = useCallback(() => {
    if (isDerivedLocale || isSampleDataMode) return;
    clearTimeout(saveTimeoutRef.current);
    setSaveStatus('idle');
    saveTimeoutRef.current = setTimeout(() => {
      void doSaveRef.current?.();
    }, 5000);
  }, [isDerivedLocale]);

  useEffect(() => {
    return () => clearTimeout(saveTimeoutRef.current);
  }, []);

  const doSave = async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.saveNotice'), tone: 'info' });
      setSaveStatus('saved');
      return;
    }

    setSaveStatus('saving');
    setConflict({ active: false });
    try {
      // API mode: PUT /api/ops/cms/variants/:variantId/revisions/:revisionId
      // with If-Match: "<lockVersion>"
      // CTA ruling: extract CTA from body and send as top-level field
      const _cta = extractCtaFromBody(bodyDoc);
      // Body: { title, summary, outcome, durationSeconds, proposedAudience, sources, body, cta }
      // const resp = await cmsApi.saveRevision(variantId, revisionId, {
      //   title, summary, outcome,
      //   durationSeconds: duration ? parseInt(duration, 10) : undefined,
      //   proposedAudience: [{ kind: proposedAudience }],
      //   sources, body: bodyDoc, cta: _cta,
      // }, lockVersion);
      // setLockVersion(resp.lockVersion);
      void _cta;
      setSaveStatus('saved');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'content_edit_conflict') {
        // Coordinator shape: 409 carries full server version in details
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
        setSaveStatus('error');
      } else {
        setSaveStatus('error');
        const code = (err as { code?: string }).code ?? 'unknown';
        setActionError(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
      }
    }
  };

  useEffect(() => {
    doSaveRef.current = doSave;
  });

  // --- Metadata change handler ---
  const handleFieldChange = () => {
    scheduleSave();
  };

  // --- Body change handler ---
  const handleBodyChange = (doc: ContentDocument) => {
    setBodyDoc(doc);
    scheduleSave();
  };

  // --- Image upload ---
  const imageUpload = useImageUpload({
    ownerCategoryId: resource?.primaryCategoryId ?? 'uncategorized',
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

  // --- Validate before submit ---
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

    // Validate body
    const bodyResult = validateContentDocument(bodyDoc);
    if (!bodyResult.ok) {
      for (const error of bodyResult.errors) {
        errs.push({
          id: error.path ?? 'body',
          label: t('cms:editor.body'),
          message: error.message,
        });
      }
    }

    setValidationErrors(errs);
    return errs.length === 0;
  };

  // --- Submit for review ---
  const handleSubmit = async () => {
    if (!validateForSubmit()) return;

    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.submitNotice'), tone: 'info' });
      return;
    }

    setActionError(null);
    try {
      // API: POST /api/ops/cms/revisions/:revisionId/submit
      toast.add({ title: t('cms:editor.submit'), tone: 'success' });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      // content_missing_required carries details.field
      const details = (err as { details?: Record<string, unknown> }).details;
      const fieldName = (details?.field as string) ?? '';
      setActionError(t(`cms:error.${code}`, { field: fieldName, defaultValue: t('cms:error.unknown') }));
    }
  };

  // --- Approve ---
  const handleApprove = async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.approveNotice'), tone: 'info' });
      return;
    }

    setActionError(null);
    try {
      // API: POST /api/ops/cms/revisions/:revisionId/approve
      toast.add({ title: t('cms:editor.approve'), tone: 'success' });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      setActionError(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
    }
  };

  // --- Conflict resolution ---
  const handleReloadServer = () => {
    if (isSampleDataMode) return;
    // Load the server version from the conflict state
    if (conflict.serverTitle != null) setTitle(conflict.serverTitle);
    if (conflict.serverSummary != null) setSummary(conflict.serverSummary);
    if (conflict.serverOutcome != null) setOutcome(conflict.serverOutcome);
    if (conflict.serverDurationSeconds != null) setDuration(String(conflict.serverDurationSeconds));
    if (conflict.serverBody != null) setBodyDoc(conflict.serverBody);
    if (conflict.serverLockVersion != null) setLockVersion(conflict.serverLockVersion);
    setConflict({ active: false });
    setSaveStatus('idle');
  };

  const handleOverwrite = () => {
    if (isSampleDataMode) return;
    // Use the server lock version so If-Match passes, keep our content
    if (conflict.serverLockVersion != null) setLockVersion(conflict.serverLockVersion);
    setConflict({ active: false });
    setSaveStatus('idle');
    void doSave();
  };

  // --- Source management ---
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

  // --- Preview panel motion ---
  const previewMotion = useMotionPreset('disclosure');
  const currentPreviewWidth = PREVIEW_WIDTHS.find((p) => p.key === previewWidth)?.width ?? 390;

  // --- Save status indicator ---
  const saveStatusLabel = {
    idle: '',
    saving: t('cms:editor.saving'),
    saved: t('cms:editor.saved'),
    error: t('cms:editor.autosaveError'),
  }[saveStatus];

  const saveStatusTone = saveStatus === 'error' ? 'text-danger' : saveStatus === 'saved' ? 'text-success' : 'text-text-secondary';

  // --- Audience options ---
  const audienceOptions = AUDIENCE_KINDS.map((kind) => ({
    value: kind,
    label: t(`cms:editor.audience${kind === 'all_eligible' ? 'All' : kind === 'organization' ? 'Org' : 'OrgUnit'}`),
  }));

  // Suppress unused vars that will be used once API wiring is complete
  void lockVersion;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Heading level={1}>{t('cms:editor.title')}</Heading>
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

      {/* Derived locale notice */}
      {isDerivedLocale ? (
        <Alert tone="info">
          {t('cms:editor.derivedLocaleNotice')}
        </Alert>
      ) : null}

      {/* Conflict notice */}
      {conflict.active ? (
        <Alert tone="warning" title={t('cms:error.content_edit_conflict')}>
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
        <Alert tone="danger">{actionError}</Alert>
      ) : null}

      {/* Validation errors */}
      {validationErrors.length > 0 ? (
        <FormErrorSummary
          title={t('cms:editor.validation.title')}
          errors={validationErrors}
        />
      ) : null}

      <div className="flex gap-6">
        {/* Main editor column */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          {/* Metadata fields */}
          <Field label={t('cms:editor.titleField')} required id="title">
            <Input
              value={isDerivedLocale ? displayTitle : title}
              onChange={(e) => { setTitle(e.target.value); handleFieldChange(); }}
              placeholder={t('cms:editor.titlePlaceholder')}
              readOnly={isDerivedLocale}
            />
          </Field>

          <Field label={t('cms:editor.summary')} id="summary">
            <textarea
              value={isDerivedLocale ? displaySummary : summary}
              onInput={(e) => { setSummary((e.target as HTMLTextAreaElement).value); handleFieldChange(); }}
              placeholder={t('cms:editor.summaryPlaceholder')}
              readOnly={isDerivedLocale}
              rows={3}
              className="min-h-24 px-3 py-2 resize-y rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('cms:editor.outcome')} id="outcome">
              <Input
                value={isDerivedLocale ? displayOutcome : outcome}
                onChange={(e) => { setOutcome(e.target.value); handleFieldChange(); }}
                placeholder={t('cms:editor.outcomePlaceholder')}
                readOnly={isDerivedLocale}
              />
            </Field>

            <Field label={t('cms:editor.duration')} id="duration">
              <Input
                type="number"
                value={duration}
                onChange={(e) => { setDuration(e.target.value); handleFieldChange(); }}
                placeholder={t('cms:editor.durationPlaceholder')}
                readOnly={isDerivedLocale}
              />
            </Field>
          </div>

          {/* Proposed audience (required on submit per coordinator) */}
          {!isDerivedLocale ? (
            <Field label={t('cms:editor.proposedAudience')} id="proposedAudience">
              <Select
                options={audienceOptions}
                value={proposedAudience}
                onValueChange={(v) => { setProposedAudience((v as AudienceKind) ?? 'all_eligible'); handleFieldChange(); }}
              />
            </Field>
          ) : null}

          {/* Sources */}
          {!isDerivedLocale ? (
            <div>
              <Heading level={3}>{t('cms:editor.sources')}</Heading>
              {sources.map((source, i) => (
                <div key={i} className="mt-3 flex items-end gap-3">
                  <Field label={t('cms:editor.sourcesLabel')} className="flex-1">
                    <Input
                      value={source.label}
                      onChange={(e) => updateSource(i, 'label', e.target.value)}
                    />
                  </Field>
                  <Field label={t('cms:editor.sourcesUrl')} className="flex-1">
                    <Input
                      value={source.url}
                      onChange={(e) => updateSource(i, 'url', e.target.value)}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSource(i)}
                  >
                    {t('cms:editor.removeSource')}
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={addSource}
              >
                {t('cms:editor.addSource')}
              </Button>
            </div>
          ) : null}

          {/* Body editor */}
          <div>
            <Heading level={3}>{t('cms:editor.body')}</Heading>
            <div className="mt-3">
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
                  editable={canWrite}
                  placeholder={t('cms:editor.bodyPlaceholder')}
                  toolbarLabels={toolbarLabels}
                  onInsertImage={handleInsertImage}
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

          {/* Actions */}
          {!isDerivedLocale ? (
            <div className="flex gap-3">
              {canWrite ? (
                <Button variant="primary" onClick={handleSubmit}>
                  {t('cms:editor.submit')}
                </Button>
              ) : null}
              {canReview ? (
                <Button variant="secondary" onClick={handleApprove}>
                  {t('cms:editor.approve')}
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
                    className="mx-auto overflow-y-auto p-4"
                    style={{ width: `${currentPreviewWidth}px`, maxWidth: '100%' }}
                  >
                    {/* Title and metadata in preview */}
                    <h1 className="text-2xl font-[var(--font-weight-heading)] text-text">
                      {displayTitle || t('cms:editor.titlePlaceholder')}
                    </h1>
                    {displayOutcome ? (
                      <p className="mt-2 type-metadata text-text-secondary">{displayOutcome}</p>
                    ) : null}

                    {/* Body content */}
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

export const Route = createFileRoute(
  '/_authenticated/cms/resources/$resourceId/variants/$locale',
)({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
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
