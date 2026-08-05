import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, File01Icon, FileCorruptIcon, FileScriptIcon, Folder01Icon, Image01Icon } from "@hugeicons/core-free-icons";
import { memo } from 'react';
import { FileEntry } from '../../shared/types';
import { getFileKind } from './utils/fileUtils';
import { cn } from '../../lib/utils';

interface Props {
    file: FileEntry;
    isSelected: boolean;
    /** Absolute placement from the virtualiser; the row is positioned, not stacked. */
    style?: React.CSSProperties;
    /** Present only during the first skeleton-to-content reveal. */
    revealIndex?: number;
    onClick: (file: FileEntry) => void;
    onDoubleClick: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}

function getIcon(file: FileEntry) {
    const kind = getFileKind(file.name, file.type);
    const cls = 'w-4 h-4 shrink-0';
    switch (kind) {
        case 'folder': return <HugeiconsIcon icon={Folder01Icon} className={cn(cls, 'text-foreground/80')} />;
        case 'image': return <HugeiconsIcon icon={Image01Icon} className={cn(cls, 'text-muted-foreground')} />;
        case 'text': return <HugeiconsIcon icon={FileScriptIcon} className={cn(cls, 'text-muted-foreground')} />;
        case 'binary': return <HugeiconsIcon icon={FileCorruptIcon} className={cn(cls, 'text-muted-foreground/45')} />;
        default: return <HugeiconsIcon icon={File01Icon} className={cn(cls, 'text-muted-foreground/60')} />;
    }
}

export const FileItem = memo(function FileItem({
    file,
    isSelected,
    style,
    revealIndex,
    onClick,
    onDoubleClick,
    onContextMenu,
}: Props) {
    const revealStyle = revealIndex === undefined ? style : {
        ...style,
        animationDelay: `${Math.min(revealIndex, 7) * 22}ms`,
        animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    };
    return (
        <div
            role="button"
            tabIndex={0}
            aria-selected={isSelected}
            style={revealStyle}
            className={cn(
                // The explicit height is what the virtualiser's row pitch is measured
                // against, so it must not be left to the padding to imply.
                'group mx-1 grid h-7 cursor-default select-none grid-cols-[24px_minmax(0,1fr)] items-center rounded-lg px-2 text-xs outline-none transition-colors',
                revealIndex !== undefined
                    && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 fill-mode-backwards',
                isSelected
                    ? 'bg-foreground/[0.09] text-foreground'
                    : 'hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.055]',
            )}
            onClick={() => onClick(file)}
            onDoubleClick={() => onDoubleClick(file)}
            onContextMenu={e => onContextMenu(e, file)}
            onKeyDown={(event) => {
                if (event.key === 'Enter') onDoubleClick(file);
                if (event.key === ' ') {
                    event.preventDefault();
                    onClick(file);
                }
            }}
        >
            {/* Icon */}
            <div className="flex justify-center">{getIcon(file)}</div>

            {/* Name */}
            <div className="flex min-w-0 items-center gap-1 pl-1">
                <span className="truncate font-medium text-foreground/90 group-hover:text-foreground">
                    {file.name}
                </span>
                {file.type === 'd' && (
                    <HugeiconsIcon icon={ArrowRight01Icon} className="w-3 h-3 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
            </div>

        </div>
    );
});
