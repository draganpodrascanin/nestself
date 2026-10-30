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
export { BlockHandleComponent } from './BlockHandle.tsx';
export type { BlockHandleLabels, BlockHandleProps } from './BlockHandle.tsx';

// Legacy toolbar (kept for backward compatibility)
export { Toolbar, DEFAULT_TOOLBAR_LABELS } from './Toolbar.tsx';
export type { ToolbarProps, ToolbarLabels } from './Toolbar.tsx';
