import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { memo } from 'react';
import { FileEntry } from '../../shared/types';
import { FileItem } from './FileItem';
import { ConnectingLog } from '../ConnectingOverlay';
import { useTranslation } from '../../hooks/useTranslation';

type SortField = 'name' | 'size' | 'date';
type SortOrder = 'asc' | 'desc';

interface Props {
    files: FileEntry[];
    loading: boolean;
    hasLoaded: boolean;
    isCompact: boolean;
    sortField: SortField;
    sortOrder: SortOrder;
    filterQuery: string;
    selectedName: string | null;
    onToggleSort: (f: SortField) => void;
    onFileClick: (file: FileEntry) => void;
    onFileDoubleClick: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}

function SortIcon({ field, sortField, sortOrder }: { field: SortField; sortField: SortField; sortOrder: SortOrder }) {
    if (sortField !== field) return <span className="w-3 h-3 inline-block" />;
    return sortOrder === 'asc'
        ? <HugeiconsIcon icon={ArrowUp01Icon} className="w-3 h-3 inline-block" />
        : <HugeiconsIcon icon={ArrowDown01Icon} className="w-3 h-3 inline-block" />;
}

function sortFiles(files: FileEntry[], field: SortField, order: SortOrder, query: string): FileEntry[] {
    let result = files;
    if (query) {
        const q = query.toLowerCase();
        result = result.filter(f => f.name.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'd' ? -1 : 1;
        let cmp = 0;
        if (field === 'name') cmp = a.name.localeCompare(b.name);
        else if (field === 'size') cmp = a.size - b.size;
        else if (field === 'date') cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
        return order === 'asc' ? cmp : -cmp;
    });
}

export const FileList = memo(function FileList({
    files, loading, hasLoaded, isCompact, sortField, sortOrder, filterQuery, selectedName,
    onToggleSort, onFileClick, onFileDoubleClick, onContextMenu,
}: Props) {
    const { t } = useTranslation();
    const sorted = sortFiles(files, sortField, sortOrder, filterQuery);
    const hdrCls = 'flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors select-none';

    return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Header */}
            <div className="mx-1 mb-1 flex shrink-0 items-center rounded-lg bg-foreground/[0.035] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="w-6 shrink-0" />
                <div className={`flex-1 pl-1 ${hdrCls}`} onClick={() => onToggleSort('name')}>
                    {t('fileBrowser.name')} <SortIcon field="name" sortField={sortField} sortOrder={sortOrder} />
                </div>
                {!isCompact && (
                    <div className={`w-28 justify-end ${hdrCls}`} onClick={() => onToggleSort('date')}>
                        {t('fileBrowser.date')} <SortIcon field="date" sortField={sortField} sortOrder={sortOrder} />
                    </div>
                )}
                {!isCompact && (
                    <div className={`w-16 justify-end ${hdrCls}`} onClick={() => onToggleSort('size')}>
                        {t('fileBrowser.size')} <SortIcon field="size" sortField={sortField} sortOrder={sortOrder} />
                    </div>
                )}
            </div>

            {/* Body */}
            <div className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden pb-2">
                {!hasLoaded ? (
                    <ConnectingLog lines={[
                        { text: '> Initializing SFTP subsystem...', delay: 500 },
                        { text: '> Negotiating channel...', delay: 1200 },
                        { text: '> Opening directory...', delay: 2500 },
                    ]} />
                ) : sorted.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50 gap-2">
                        <HugeiconsIcon icon={Folder01Icon} className="w-10 h-10 opacity-30" />
                        <p className="text-xs">{filterQuery ? t('fileBrowser.noMatches') : t('fileBrowser.emptyFolder')}</p>
                    </div>
                ) : (
                    sorted.map((file) => (
                        <FileItem
                            key={file.name}
                            file={file}
                            isCompact={isCompact}
                            isSelected={selectedName === file.name}
                            onClick={onFileClick}
                            onDoubleClick={onFileDoubleClick}
                            onContextMenu={onContextMenu}
                        />
                    ))
                )}
            </div>
        </div>
    );
});
