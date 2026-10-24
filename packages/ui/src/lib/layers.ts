/**
 * Stacking for portalled popups (Select, Menu).
 *
 * Base UI renders a popup's portal inside the nearest parent portal, so a
 * popup opened from `DialogContent` lands in the dialog's portal element.
 * The dialog sets `--z-popup` one above `--z-dialog` there; popups read it
 * and fall back to `--z-dropdown` everywhere else. Literal class strings so
 * Tailwind generates them.
 */

/** Positioner class for a portalled popup. */
export const POPUP_LAYER = 'z-[var(--z-popup,var(--z-dropdown))]';

/** Set on a dialog's portal element: popups inside it layer above the dialog. */
export const POPUP_LAYER_ABOVE_DIALOG = '[--z-popup:calc(var(--z-dialog)+1)]';
