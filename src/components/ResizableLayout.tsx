import { useRef, useState, useEffect } from 'react';

interface ResizableLayoutProps {
    leftContent: React.ReactNode;
    middleContent: React.ReactNode;
    rightContent: React.ReactNode;
    defaultLeftWidth?: number;
    defaultRightWidth?: number;
}

/** Wide enough for mode, model, effort, and context controls to remain on one row. */
const MIN_RIGHT_WIDTH = 420;

export function ResizableLayout({
    leftContent,
    middleContent,
    rightContent,
    defaultLeftWidth = 270,
    defaultRightWidth = 320
}: ResizableLayoutProps) {
    const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
    const [rightWidth, setRightWidth] = useState(Math.max(defaultRightWidth, MIN_RIGHT_WIDTH));

    const layoutRef = useRef<HTMLDivElement>(null);
    const isResizingLeft = useRef(false);
    const isResizingRight = useRef(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!layoutRef.current) return;
            const bounds = layoutRef.current.getBoundingClientRect();

            if (isResizingLeft.current) {
                const newWidth = e.clientX - bounds.left;
                if (newWidth > 150 && newWidth < 600) {
                    setLeftWidth(newWidth);
                }
            }

            if (isResizingRight.current) {
                const newWidth = bounds.right - e.clientX;
                if (newWidth >= MIN_RIGHT_WIDTH && newWidth < 600) {
                    setRightWidth(newWidth);
                }
            }
        };

        const handleMouseUp = () => {
            if (isResizingLeft.current || isResizingRight.current) {
                // Trigger a resize event so xterm-addon-fit can catch up
                window.dispatchEvent(new Event('resize'));
            }
            isResizingLeft.current = false;
            isResizingRight.current = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const startResizeLeft = () => {
        isResizingLeft.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const startResizeRight = () => {
        isResizingRight.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    return (
        <div ref={layoutRef} className="flex h-full w-full overflow-hidden bg-transparent p-2">
            <div style={{ width: leftWidth }} className="glass-panel flex min-w-0 flex-shrink-0 flex-col overflow-hidden rounded-2xl">
                {leftContent}
            </div>

            <div
                className="group relative z-20 w-2 shrink-0 cursor-col-resize"
                onMouseDown={startResizeLeft}
            >
                <div className="absolute inset-y-3 left-[3px] w-0.5 rounded-full transition-colors group-hover:bg-primary/35" />
            </div>

            <div className="glass-panel flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background/48">
                {middleContent}
            </div>

            <div
                className="group relative z-20 w-2 shrink-0 cursor-col-resize"
                onMouseDown={startResizeRight}
            >
                <div className="absolute inset-y-3 left-[3px] w-0.5 rounded-full transition-colors group-hover:bg-primary/35" />
            </div>

            <div
                style={{ width: rightWidth, minWidth: MIN_RIGHT_WIDTH }}
                className="glass-panel flex flex-shrink-0 flex-col overflow-hidden rounded-2xl"
            >
                {rightContent}
            </div>
        </div>
    );
}
