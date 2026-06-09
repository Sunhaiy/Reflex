import { X, ZoomIn, ZoomOut, RotateCw, Maximize2, Minimize2 } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from '../../hooks/useTranslation';

interface Props {
    name: string;
    src: string;
    onClose: () => void;
}

const W = 800, H = 560;

export function ImageViewer({ name, src, onClose }: Props) {
    const { t } = useTranslation();
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    const windowRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const dragStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
    const pos = useRef({ x: 0, y: 0 });

    // Center on mount using transform
    useEffect(() => {
        const x = Math.round((window.innerWidth - W) / 2);
        const y = Math.round((window.innerHeight - H) / 2);
        pos.current = { x, y };
        if (windowRef.current) {
            windowRef.current.style.transform = `translate(${x}px,${y}px)`;
        }
    }, []);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (isMaximized) return;
        isDragging.current = true;
        dragStart.current = { mx: e.clientX, my: e.clientY, tx: pos.current.x, ty: pos.current.y };
        e.preventDefault();
    }, [isMaximized]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!isDragging.current || !windowRef.current) return;
            const x = Math.max(0, Math.min(window.innerWidth - W, dragStart.current.tx + e.clientX - dragStart.current.mx));
            const y = Math.max(0, Math.min(window.innerHeight - 40, dragStart.current.ty + e.clientY - dragStart.current.my));
            pos.current = { x, y };
            windowRef.current.style.transform = `translate(${x}px,${y}px)`;
        };
        const onUp = () => { isDragging.current = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, []);

    return (
        <>
            {/* Semi-transparent backdrop */}
            <div className="fixed inset-0 z-[65] bg-black/30" onClick={onClose} />

            {/* Floating Window — positioned with transform, no left/top changes during drag */}
            <div
                ref={windowRef}
                className="z-[70] flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
                style={
                    isMaximized
                        ? { position: 'fixed', inset: 0, borderRadius: 0 }
                        : { position: 'fixed', left: 0, top: 0, width: W, height: H, willChange: 'transform' }
                }
                onClick={(e) => e.stopPropagation()}
            >
                {/* Title bar */}
                <div
                    className="flex items-center justify-between px-3 py-2 bg-card border-b border-border cursor-move select-none shrink-0"
                    onMouseDown={onMouseDown}
                    onDoubleClick={() => setIsMaximized(v => !v)}
                >
                    <span className="text-xs font-medium text-foreground truncate max-w-[400px]" title={name}>
                        🖼 {name}
                    </span>
                    <div className="flex items-center gap-0.5" onMouseDown={e => e.stopPropagation()}>
                        <button onClick={() => setScale(s => Math.max(0.1, s - 0.25))}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground" title={t('fileBrowser.zoomOut')}>
                            <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs w-10 text-center tabular-nums text-muted-foreground">
                            {Math.round(scale * 100)}%
                        </span>
                        <button onClick={() => setScale(s => Math.min(5, s + 0.25))}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground" title={t('fileBrowser.zoomIn')}>
                            <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setRotation(r => (r + 90) % 360)}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground ml-1" title={t('fileBrowser.rotate')}>
                            <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => { setScale(1); setRotation(0); }}
                            className="px-1.5 py-1 text-[10px] rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground ml-0.5">
                            1:1
                        </button>
                        <div className="w-px h-3.5 bg-border mx-1.5" />
                        <button onClick={() => setIsMaximized(v => !v)}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                            title={isMaximized ? t('fileBrowser.restore') : t('fileBrowser.maximize')}>
                            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={onClose}
                            className="p-1.5 rounded hover:bg-destructive/15 hover:text-destructive transition-colors text-muted-foreground">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Image area */}
                <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[repeating-conic-gradient(#80808018_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] relative">
                    {isLoading && !hasError && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs text-muted-foreground">{t('fileBrowser.loading')}</span>
                            </div>
                        </div>
                    )}
                    {hasError ? (
                        <div className="text-sm text-muted-foreground">{t('fileBrowser.imageLoadFailed')}</div>
                    ) : (
                        <img
                            src={src}
                            alt={name}
                            style={{
                                transform: `scale(${scale}) rotate(${rotation}deg)`,
                                transition: 'transform 0.2s ease',
                                opacity: isLoading ? 0 : 1
                            }}
                            className="max-w-none object-contain shadow-lg rounded transition-opacity duration-200"
                            draggable={false}
                            onLoad={() => setIsLoading(false)}
                            onError={() => { setIsLoading(false); setHasError(true); }}
                        />
                    )}
                </div>
            </div>
        </>
    );
}
