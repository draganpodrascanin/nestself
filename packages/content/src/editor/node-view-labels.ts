/**
 * Labels consumed by React node views for translatable strings.
 * Extracted into its own file to avoid circular imports between
 * editor-extensions.ts and node-views.tsx.
 */

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
