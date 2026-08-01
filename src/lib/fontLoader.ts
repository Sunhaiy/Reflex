/**
 * Fonts are loaded on demand instead of all at once. Importing all 23 families up front
 * put ~200KB of CSS and 200-odd @font-face rules in the critical path, while only the
 * two the user actually picked are ever rendered. The rest arrive when the font picker
 * opens, or the moment a stack that needs them is applied.
 *
 * The three defaults stay eager (see main.tsx) so first paint never swaps typeface.
 */

// Keyed by the family name as it appears inside a stack string in fontStacks.ts.
const LOADERS: Record<string, () => Promise<unknown>> = {
    'Inter Variable': () => import('@fontsource-variable/inter/index.css'),
    'Noto Sans Variable': () => import('@fontsource-variable/noto-sans/index.css'),
    'Nunito Sans Variable': () => import('@fontsource-variable/nunito-sans/index.css'),
    'Figtree Variable': () => import('@fontsource-variable/figtree/index.css'),
    'Roboto Variable': () => import('@fontsource-variable/roboto/index.css'),
    'Raleway Variable': () => import('@fontsource-variable/raleway/index.css'),
    'DM Sans Variable': () => import('@fontsource-variable/dm-sans/index.css'),
    'Public Sans Variable': () => import('@fontsource-variable/public-sans/index.css'),
    'Outfit Variable': () => import('@fontsource-variable/outfit/index.css'),
    'Oxanium Variable': () => import('@fontsource-variable/oxanium/index.css'),
    'Instrument Sans Variable': () => import('@fontsource-variable/instrument-sans/index.css'),
    'Geist Mono Variable': () => import('@fontsource-variable/geist-mono/index.css'),
    'Roboto Mono Variable': () => import('@fontsource-variable/roboto-mono/index.css'),
    'Noto Serif Variable': () => import('@fontsource-variable/noto-serif/index.css'),
    'Roboto Slab Variable': () => import('@fontsource-variable/roboto-slab/index.css'),
    'Merriweather Variable': () => import('@fontsource-variable/merriweather/index.css'),
    'Lora Variable': () => import('@fontsource-variable/lora/index.css'),
    'Playfair Display Variable': () => import('@fontsource-variable/playfair-display/index.css'),
    'EB Garamond Variable': () => import('@fontsource-variable/eb-garamond/index.css'),
    'Instrument Serif': () => import('@fontsource/instrument-serif/400.css'),
};

const started = new Set<string>();

function load(family: string) {
    const loader = LOADERS[family];
    if (!loader || started.has(family)) return;
    started.add(family);
    // A font that fails to load falls back through the rest of its stack; nothing here
    // is worth interrupting the caller for.
    void loader().catch(() => started.delete(family));
}

/** Loads whichever families a CSS font-family stack names. */
export function ensureFontsFor(stack: string | undefined) {
    if (!stack) return;
    for (const family of Object.keys(LOADERS)) {
        if (stack.includes(family)) load(family);
    }
}

/** Used when the font picker opens, so every option previews in its own typeface. */
export function loadAllFonts() {
    for (const family of Object.keys(LOADERS)) load(family);
}
