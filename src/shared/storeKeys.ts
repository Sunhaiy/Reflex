/**
 * Every setting the renderer may read or write, in one place.
 *
 * This list used to live only in the main process as a permission check, while the
 * renderer passed bare strings. Adding a setting meant remembering to register it in a
 * file you were not editing — and forgetting once made `store-get` reject, which took
 * the whole restore down with it and emptied the server list. Typing the key against
 * this array turns that into a compile error instead.
 */
export const STORE_KEYS = [
  'connections',
  'connectionDraft',
  'lastConnectedAt',
  'openSessions',
  'autoReconnect',
  'appearance',
  'accentColor',
  'opacity',
  'radiusScale',
  'language',
  'uiFontFamily',
  'terminalFontFamily',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'cursorStyle',
  'cursorBlink',
  'rendererType',
  'scrollback',
  'brightBold',
  'bookmarks',
  'usageStats',
  'windowState',
  // Read only, to migrate installs that predate `appearance`.
  'baseTheme',
  'terminalTheme',
] as const;

export type StoreKey = typeof STORE_KEYS[number];
