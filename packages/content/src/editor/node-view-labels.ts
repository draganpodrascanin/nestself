/**
 * Labels consumed by React node views for translatable strings.
 * Extracted into its own file to avoid circular imports between
 * editor-extensions.ts and node-views.tsx.
 */

// ---------------------------------------------------------------------------
// Image upload handler — injected from the host app
// ---------------------------------------------------------------------------

/** Result from a completed image upload. */
export interface ImageUploadResult {
  assetId: string;
  /** URL the editor can use to display the image (e.g. /api/ops/cms/media/:id/original). */
  previewUrl: string;
}

/**
 * Upload handler that the host app provides to the content editor.
 *
 * The handler receives the selected File and an `onStatus` callback for
 * intermediate status text (e.g. "Uploading", "Processing").  It resolves
 * with the assetId and a preview URL once the image is ready.
 */
export type ImageUploadHandler = (
  file: File,
  onStatus: (status: string) => void,
) => Promise<ImageUploadResult>;

// ---------------------------------------------------------------------------
// Resource search handler — injected from the host app
// ---------------------------------------------------------------------------

/** A resource search result item shown in the CTA / related resource combobox. */
export interface ResourceSearchResult {
  id: string;
  title: string;
}

/**
 * Handler that the host app provides for searching CMS resources by title.
 * Used by the CTA and RelatedResource node views.
 */
export type ResourceSearchHandler = (
  query: string,
) => Promise<ResourceSearchResult[]>;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Labels consumed by React node views. Defaults are English fallbacks. */
export interface NodeViewLabels {
  noteKinds: Record<string, string>;
  stepTitle: string;
  checklistLabel: string;
  ctaKinds: Record<string, string>;
  ctaLabelPlaceholder: string;
  relatedSearch: string;
  relatedEmpty: string;
  imageAlt: string;
  imageCaption: string;
  imagePlaceholder: string;
}

export const DEFAULT_NODE_VIEW_LABELS: NodeViewLabels = {
  noteKinds: { tip: 'Tip', warning: 'Warning', disclaimer: 'Disclaimer' },
  stepTitle: 'Step title',
  checklistLabel: '',
  ctaKinds: {
    suggest_topic: 'Suggest topic',
    open_content: 'Open content',
    open_collection: 'Open collection',
    open_service: 'Open service',
  },
  ctaLabelPlaceholder: 'Button label (optional, max 100)',
  relatedSearch: 'Resource ID',
  relatedEmpty: '(none)',
  imageAlt: 'Alt text (required)',
  imageCaption: 'Caption (optional)',
  imagePlaceholder: 'Drop or paste an image, or click to upload',
};
