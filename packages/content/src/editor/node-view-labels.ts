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

/** A resource search result item shown in the CTA / related resource pickers. */
export interface ResourceSearchResult {
  id: string;
  title: string;
  /** Resource type (article, collection, ...) when the host knows it. */
  type?: string;
}

/**
 * Handler that the host app provides for searching CMS resources by title.
 * Used by the CTA and related resource pickers. It rejects on failure; the
 * picker shows the failure.
 */
export type ResourceSearchHandler = (
  query: string,
) => Promise<ResourceSearchResult[]>;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Labels consumed by React node views and block dialogs. Defaults are English fallbacks. */
export interface NodeViewLabels {
  noteType: string;
  noteKinds: Record<string, string>;
  stepTitle: string;
  checklistLabel: string;
  ctaDialog: string;
  ctaAction: string;
  ctaKinds: Record<string, string>;
  ctaContent: string;
  ctaCollection: string;
  ctaService: string;
  ctaServices: Record<string, string>;
  ctaButtonLabel: string;
  ctaButtonLabelHint: string;
  ctaTargetRequired: string;
  relatedDialog: string;
  relatedChoose: string;
  searchPlaceholder: string;
  searching: string;
  searchEmpty: string;
  searchError: string;
  done: string;
  cancel: string;
  close: string;
  imageAlt: string;
  imageCaption: string;
  imagePlaceholder: string;
  imageUploading: string;
  imageProcessing: string;
  imageUploadFailed: string;
}

export const DEFAULT_NODE_VIEW_LABELS: NodeViewLabels = {
  noteType: 'Note type',
  noteKinds: { tip: 'Tip', warning: 'Warning', disclaimer: 'Disclaimer' },
  stepTitle: 'Step title',
  checklistLabel: '',
  ctaDialog: 'Call to action',
  ctaAction: 'Action',
  ctaKinds: {
    suggest_topic: 'Suggest topic',
    open_content: 'Open content',
    open_collection: 'Open collection',
    open_service: 'Open service',
  },
  ctaContent: 'Content',
  ctaCollection: 'Collection',
  ctaService: 'Service',
  ctaServices: {
    library: 'Content library',
    general_questions: 'Ask a general question',
    event_interest: 'Express interest in an event',
  },
  ctaButtonLabel: 'Button label',
  ctaButtonLabelHint: 'Optional, up to 100 characters.',
  ctaTargetRequired: 'Choose what the button opens.',
  relatedDialog: 'Related resource',
  relatedChoose: 'Choose a resource',
  searchPlaceholder: 'Search by title',
  searching: 'Searching…',
  searchEmpty: 'No matching content',
  searchError: 'The search failed. Try again.',
  done: 'Done',
  cancel: 'Cancel',
  close: 'Close',
  imageAlt: 'Alt text',
  imageCaption: 'Caption',
  imagePlaceholder: 'Drop or paste an image, or click to upload',
  imageUploading: 'Uploading…',
  imageProcessing: 'Processing…',
  imageUploadFailed: 'The image could not be uploaded. Try again.',
};
