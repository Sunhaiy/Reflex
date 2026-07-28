import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    Loader2,
    RefreshCw,
} from 'lucide-react';
import type { FileEntry } from '../../shared/types';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { joinPath } from './utils/fileUtils';

interface DirectoryState {
    directories: FileEntry[];
    loaded: boolean;
    loading: boolean;
    error?: string;
}

interface Props {
    currentPath: string;
    revision: number;
    loadDirectories: (path: string, force?: boolean) => Promise<FileEntry[]>;
    onNavigate: (path: string) => void;
}

function getAncestorPaths(path: string): string[] {
    const segments = path.split('/').filter(Boolean);
    const paths = ['/'];
    let cursor = '';

    for (const segment of segments) {
        cursor += `/${segment}`;
        paths.push(cursor);
    }

    return paths;
}

export function DirectoryTree({ currentPath, revision, loadDirectories, onNavigate }: Props) {
    const { t } = useTranslation();
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['/']));
    const [directoryStates, setDirectoryStates] = useState<Record<string, DirectoryState>>({});
    const activeNodeRef = useRef<HTMLButtonElement>(null);
    const previousRevisionRef = useRef(revision);

    const loadChildren = useCallback(async (path: string, force = false) => {
        setDirectoryStates(previous => ({
            ...previous,
            [path]: {
                directories: previous[path]?.directories ?? [],
                loaded: previous[path]?.loaded ?? false,
                loading: true,
                error: undefined,
            },
        }));

        try {
            const directories = await loadDirectories(path, force);
            setDirectoryStates(previous => ({
                ...previous,
                [path]: { directories, loaded: true, loading: false },
            }));
        } catch (error: any) {
            setDirectoryStates(previous => ({
                ...previous,
                [path]: {
                    directories: previous[path]?.directories ?? [],
                    loaded: previous[path]?.loaded ?? false,
                    loading: false,
                    error: error?.message ?? String(error),
                },
            }));
        }
    }, [loadDirectories]);

    useEffect(() => {
        const ancestors = getAncestorPaths(currentPath);
        setExpandedPaths(previous => {
            const next = new Set(previous);
            ancestors.forEach(path => next.add(path));
            return next;
        });

        void (async () => {
            for (const path of ancestors) await loadChildren(path);
        })();
    }, [currentPath, loadChildren]);

    useEffect(() => {
        if (previousRevisionRef.current === revision) return;
        previousRevisionRef.current = revision;
        void (async () => {
            for (const path of getAncestorPaths(currentPath)) await loadChildren(path, true);
        })();
    }, [currentPath, loadChildren, revision]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            activeNodeRef.current?.scrollIntoView({ block: 'nearest' });
        });
        return () => cancelAnimationFrame(frame);
    }, [currentPath, directoryStates]);

    const toggleExpanded = useCallback((path: string) => {
        const shouldCollapse = expandedPaths.has(path);
        setExpandedPaths(previous => {
            const next = new Set(previous);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
        if (!shouldCollapse) void loadChildren(path);
    }, [expandedPaths, loadChildren]);

    const refreshExpanded = useCallback(async () => {
        for (const path of expandedPaths) await loadChildren(path, true);
    }, [expandedPaths, loadChildren]);

    const renderNode = (path: string, label: string, depth: number): React.ReactNode => {
        const state = directoryStates[path];
        const directories = state?.directories ?? [];
        const expanded = expandedPaths.has(path);
        const active = path === currentPath;
        const mayHaveChildren = !state?.loaded || directories.length > 0;

        return (
            <Fragment key={path}>
                <div
                    className={cn(
                        'group flex h-7 items-center pr-1 text-xs transition-colors',
                        active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                    style={{ paddingLeft: 4 + depth * 14 }}
                    title={path}
                >
                    <button
                        type="button"
                        className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent',
                            !mayHaveChildren && 'pointer-events-none opacity-25',
                        )}
                        onClick={() => toggleExpanded(path)}
                        tabIndex={-1}
                    >
                        {state?.loading
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : expanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <button
                        ref={active ? activeNodeRef : undefined}
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                        onClick={() => onNavigate(path)}
                    >
                        {expanded
                            ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                            : <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />}
                        <span className="truncate font-medium">{label}</span>
                        {state?.loaded && directories.length > 0 && (
                            <span
                                className="ml-auto rounded bg-muted/60 px-1 text-[9px] tabular-nums text-muted-foreground/70"
                                title={t('fileBrowser.subdirectories')}
                            >
                                {directories.length}
                            </span>
                        )}
                    </button>
                </div>
                {expanded && state?.error && (
                    <div
                        className="flex items-center gap-1 py-1 pr-2 text-[10px] text-destructive/80"
                        style={{ paddingLeft: 28 + depth * 14 }}
                        title={state.error}
                    >
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span className="truncate">{t('fileBrowser.treeLoadFailed')}</span>
                    </div>
                )}
                {expanded && directories.map(directory => (
                    renderNode(joinPath(path, directory.name), directory.name, depth + 1)
                ))}
            </Fragment>
        );
    };

    return (
        <aside className="flex w-52 min-w-[11rem] shrink-0 flex-col border-r border-border/60 bg-muted/5">
            <div className="flex h-8 shrink-0 items-center border-b border-border/50 px-2">
                <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {t('fileBrowser.directoryTree')}
                </span>
                <button
                    type="button"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={t('fileBrowser.refreshTree')}
                    onClick={() => void refreshExpanded()}
                >
                    <RefreshCw className="h-3 w-3" />
                </button>
            </div>
            <div className="flex-1 overflow-auto py-1">
                {renderNode('/', t('fileBrowser.root'), 0)}
            </div>
        </aside>
    );
}
