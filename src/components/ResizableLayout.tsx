import { useRef, useState, useEffect } from 'react';

interface ResizableLayoutProps {
    leftContent: React.ReactNode;
    middleContent: React.ReactNode;
    rightContent: React.ReactNode;
    defaultLeftWidth?: number;
    defaultRightWidth?: number;
}

export function ResizableLayout({
    leftContent,
    middleContent,
    rightContent,
    defaultLeftWidth = 250,
    defaultRightWidth = 300
}: ResizableLayoutProps) {
    const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
    const [rightWidth, setRightWidth] = useState(defaultRightWidth);

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
                if (newWidth > 200 && newWidth < 600) {
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
        <div ref={layoutRef} className="flex h-full w-full overflow-hidden">
            {/* Left Panel */}
            <div style={{ width: leftWidth, padding: 'var(--panel-gap)' }} className="flex-shrink-0 flex flex-col min-w-0 overflow-hidden">
                {leftContent}
            </div>

            {/* Left Resizer */}
            <div
                className="w-1 cursor-col-resize hover:bg-primary/50 transition-colors bg-transparent relative z-10"
                onMouseDown={startResizeLeft}
            />

            {/* Middle Panel (Flexible) */}
            <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden" style={{ padding: 'var(--panel-gap)' }}>
                {middleContent}
            </div>

            {/* Right Resizer */}
            <div
                className="w-1 cursor-col-resize hover:bg-primary/50 transition-colors bg-transparent relative z-10"
                onMouseDown={startResizeRight}
            />

            {/* Right Panel */}
            <div style={{ width: rightWidth, padding: 'var(--panel-gap)' }} className="flex-shrink-0 flex flex-col min-w-0 overflow-hidden">
                {rightContent}
            </div>
        </div>
    );
}
