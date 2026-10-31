/**
 * Content editor -- Notion-style Tiptap 3 rich text editor for the CMS (T-C1.12).
 * Exported from @nestself/content/editor.
 */
export { ContentEditor, DEFAULT_EDITOR_LABELS } from './ContentEditor.tsx';
export type {
  ContentEditorProps,
  ContentEditorHandle,
  ContentEditorLabels,
} from './ContentEditor.tsx';
export { toContentDocument, fromContentDocument } from './converters.ts';
export { createEditorExtensions } from './editor-extensions.ts';
export type { EditorExtensionsOptions } from './editor-extensions.ts';
export { PasteNormalization } from './paste-handler.ts';

// Slash menu
export { createSlashMenuItems, createSlashMenuExtension, useSlashMenu } from './SlashMenu.tsx';
export type {
  SlashMenuItem,
  SlashMenuLabels,
  SlashMenuItemLabels,
} from './SlashMenu.tsx';

// Bubble menu
export { EditorBubbleMenu } from './EditorBubbleMenu.tsx';
export type { BubbleMenuLabels, EditorBubbleMenuProps } from './EditorBubbleMenu.tsx';

// Block handle
export { BlockHandleComponent, dropLineAt, moveBlock } from './BlockHandle.tsx';
export { BlockPicker, filterBlockItems } from './BlockPicker.tsx';
export type { BlockPickerProps } from './BlockPicker.tsx';
export { applyBlockPick, appliesInPlace } from './block-pick.ts';
export type { BlockHandleLabels, BlockHandleProps } from './BlockHandle.tsx';

// Node views
export {
  ProfessionalNoteView,
  PracticalStepView,
  ChecklistView,
  ChecklistItemView,
  CtaView,
  RelatedResourceView,
  ImageView,
  openImagePicker,
} from './node-views.tsx';
export { DEFAULT_NODE_VIEW_LABELS } from './node-view-labels.ts';
export type { NodeViewLabels, ImageUploadHandler, ImageUploadResult, ResourceSearchHandler, ResourceSearchResult } from './node-view-labels.ts';

// Call-to-action and related-resource dialogs
export { BlockDialogs, CtaDialog, RelatedDialog, ResourcePicker, openBlockDialog } from './BlockDialogs.tsx';
export type { BlockDialogRequest } from './BlockDialogs.tsx';

// Legacy toolbar (kept for backward compatibility)
export { Toolbar, DEFAULT_TOOLBAR_LABELS } from './Toolbar.tsx';
export type { ToolbarProps, ToolbarLabels } from './Toolbar.tsx';
