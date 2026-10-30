/**
 * Coarse browser and operating-system families. They pick the permission
 * help copy (CALL-03) and travel with client events (D-CW-13); versions and
 * the raw user agent never leave the browser.
 */

export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
export type OsFamily = 'windows' | 'macos' | 'ios' | 'android' | 'linux' | 'other';

export function detectBrowser(userAgent: string): BrowserFamily {
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return 'safari';
  return 'other';
}

export function detectOs(userAgent: string): OsFamily {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/Windows NT/.test(userAgent)) return 'windows';
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'macos';
  if (/Linux|X11/.test(userAgent)) return 'linux';
  return 'other';
}

/** The current browser's user agent, or an empty string outside a browser. */
export function currentUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}
