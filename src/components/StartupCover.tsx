import { useEffect, useRef, useState } from 'react';
import { ShaderBackground } from './ui/shadow-blending';
import { useBootReady } from '../lib/bootProgress';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';

/**
 * The cover holds for this long even when the restore finishes sooner, so startup has a
 * steady, deliberate beat instead of a flash whose length varies run to run. It also
 * spans the moment the window takes its final size, hiding that reflow.
 */
const MIN_COVER_MS = 2000;
/** Never trap the user behind the cover if a boot step never settles. */
const MAX_COVER_MS = 6000;
const FADE_MS = 380;

/**
 * Set true to pin the cover for design review: it stops dismissing itself, and Esc or a
 * click gets past it. Must stay false in normal builds.
 */
const HOLD_COVER = false;

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function StartupCover({ appearanceReady }: { appearanceReady: boolean }) {
    const [phase, setPhase] = useState<'visible' | 'leaving' | 'gone'>('visible');
    const [version, setVersion] = useState('');
    const mountedAtRef = useRef(Date.now());
    const [reducedMotion] = useState(prefersReducedMotion);
    const [shownAt, setShownAt] = useState<number | null>(null);

    const { t } = useTranslation();
    const ready = useBootReady();

    useEffect(() => {
        window.electron.getVersion().then(setVersion).catch(() => undefined);
    }, []);

    // The window stays hidden until this fires. Waiting on document.fonts means the
    // first frame the user ever sees already has the real typeface — otherwise the
    // wordmark painted in a fallback and swapped a moment later. Two frames of slack
    // let the paint actually land, and the timeout keeps a slow font from holding the
    // whole window back.
    useEffect(() => {
        if (!appearanceReady) return undefined;

        let done = false;
        let fontTimer: ReturnType<typeof setTimeout> | undefined;
        const announce = () => {
            if (done) return;
            done = true;
            setShownAt(Date.now());
            window.electron.signalFirstFrame();
        };

        const timeout = setTimeout(announce, 1200);
        const fonts = document.fonts?.ready ?? Promise.resolve();
        void fonts.then(() => {
            // Two frames normally, but a hidden window can have its rAF throttled, so a
            // short timer races it — otherwise the reveal would wait for the 1.2s cap.
            requestAnimationFrame(() => requestAnimationFrame(announce));
            fontTimer = setTimeout(announce, 80);
        }).catch(announce);

        return () => {
            done = true;
            clearTimeout(timeout);
            if (fontTimer) clearTimeout(fontTimer);
        };
    }, [appearanceReady]);

    useEffect(() => {
        if (phase !== 'visible' || HOLD_COVER) return;
        const now = Date.now();
        const deadline = Math.max(0, MAX_COVER_MS - (now - mountedAtRef.current));
        // Until the window is actually on screen only the failsafe applies.
        const remaining = ready && shownAt !== null
            ? Math.min(deadline, Math.max(0, MIN_COVER_MS - (now - shownAt)))
            : deadline;
        const timer = setTimeout(() => setPhase('leaving'), remaining);
        return () => clearTimeout(timer);
    }, [phase, ready, shownAt]);

    // Escape hatch while the cover is pinned for review.
    useEffect(() => {
        if (!HOLD_COVER || phase !== 'visible') return;
        const dismiss = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setPhase('leaving');
        };
        window.addEventListener('keydown', dismiss);
        return () => window.removeEventListener('keydown', dismiss);
    }, [phase]);

    useEffect(() => {
        if (phase !== 'leaving') return;
        const timer = setTimeout(() => setPhase('gone'), FADE_MS);
        return () => clearTimeout(timer);
    }, [phase]);

    if (phase === 'gone') return null;

    return (
        <div
            className={cn(
                'fixed inset-0 z-[200] overflow-hidden transition-opacity ease-out',
                phase === 'leaving' ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
            style={{ transitionDuration: `${FADE_MS}ms` }}
            onClick={HOLD_COVER ? () => setPhase('leaving') : undefined}
            role="status"
            aria-live="polite"
            aria-label={t('boot.loading')}
        >
            {/* Base layer: also what shows when WebGL is unavailable, since the shader
                canvas simply stays transparent in that case. */}
            <div className="cover-fallback absolute inset-0" />

            {!reducedMotion && (
                <div className="absolute inset-0">
                    <ShaderBackground className="h-full w-full" />
                </div>
            )}

            {/* Keep the branded cover dark and stable regardless of the saved app theme. */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    background: 'radial-gradient(62% 52% at 50% 46%, rgb(9 9 11 / 0.78),'
                        + ' rgb(9 9 11 / 0.36) 55%, transparent 78%)',
                }}
            />

            <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
                <div>
                    <h1 className="text-[clamp(38px,6vw,62px)] font-semibold leading-none tracking-[-0.045em] text-white">
                        Reflex
                    </h1>
                    <p className="mx-auto mt-4 max-w-[380px] text-[13px] leading-5 text-white/45">
                        {t('boot.tagline')}
                    </p>
                </div>
            </div>

            {version && (
                <div className="absolute bottom-6 right-7 font-mono text-[10px] text-white/35">
                    v{version}
                </div>
            )}
        </div>
    );
}
