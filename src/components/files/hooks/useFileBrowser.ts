import { useState, useCallback, useEffect, useRef } from 'react';
import type { FileEntry, TextFileEncoding } from '../../../shared/types';
import { errorMessage } from '../../../lib/errors';
import { log } from '../../../lib/logger';
import {
    decodeText,
    detectImageMime,
    detectTextEncoding,
    getFileKind,
    isProbablyBinary,
    joinPath,
    parentPath,
} from '../utils/fileUtils';
import { useTransferQueue } from './useTransferQueue';
import type { TransferItem } from './useTransferQueue';
import { useTranslation } from '../../../hooks/useTranslation';

export interface FileOpenResult {
    kind: 'text' | 'image';
    name: string;
    path: string;
    entry: FileEntry;
    /** Decoded text, or an object URL for images. */
    content: string;
    /** Kept so the text can be re-decoded when the user picks another encoding. */
    bytes: Uint8Array<ArrayBuffer>;
    encoding?: TextFileEncoding;
}

export interface Toast {
    id: string;
    message: string;
    type: 'error' | 'success' | 'info';
}

let _toastId = 0;

function validateEntryName(name: string, invalidMessage: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\0]/.test(trimmed)) {
        throw new Error(invalidMessage);
    }
    return trimmed;
}

/**
 * How long a listing may be served from memory. Long enough that stepping into a folder
 * and back is instant, short enough that a file created in the terminal shows up without
 * the user reaching for refresh.
 */
const LISTING_TTL_MS = 30_000;

/** How many dropped files may be uploading at once. */
const UPLOAD_CONCURRENCY = 3;

interface CachedListing {
    entries: FileEntry[];
    at: number;
}

export function useFileBrowser(connectionId: string) {
    const { t } = useTranslation();
    const [currentPath, setCurrentPath] = useState('/');
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [openingFile, setOpeningFile] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [openFile, setOpenFile] = useState<FileOpenResult | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);

    const pathCacheRef = useRef<Map<string, CachedListing>>(new Map());
    const latestRequestRef = useRef(0);
    const toastTimersRef = useRef<Set<number>>(new Set());
    const objectUrlRef = useRef<string | null>(null);
    const transferQueue = useTransferQueue();

    useEffect(() => window.electron.onSftpTransferProgress(({ transferId, progress, transferred, total }) => {
        transferQueue.updateProgress(transferId, progress, transferred, total);
    }), [transferQueue.updateProgress]);

    useEffect(() => () => {
        toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        toastTimersRef.current.clear();
    }, []);

    /** An object URL pins its blob in memory until it is revoked, so every path revokes. */
    const releaseObjectUrl = useCallback(() => {
        if (!objectUrlRef.current) return;
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
    }, []);

    useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

    // ── Toast helpers ────────────────────────────────────────────────────────────
    const pushToast = useCallback((message: string, type: Toast['type'] = 'error') => {
        const id = String(++_toastId);
        setToasts(prev => [...prev, { id, message, type }]);
        const timer = window.setTimeout(() => {
            toastTimersRef.current.delete(timer);
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
        toastTimersRef.current.add(timer);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // ── Directory listing ─────────────────────────────────────────────────────────
    const fetchDirectory = useCallback(async (path: string, force = false): Promise<FileEntry[]> => {
        const cached = pathCacheRef.current.get(path);
        if (!force && cached && Date.now() - cached.at < LISTING_TTL_MS) return cached.entries;

        const list = await window.electron.sftpList(connectionId, path);
        const entries: FileEntry[] = Array.isArray(list) ? list : [];
        pathCacheRef.current.set(path, { entries, at: Date.now() });
        return entries;
    }, [connectionId]);

    const loadFiles = useCallback(async (path: string, force = false) => {
        const requestId = ++latestRequestRef.current;
        const startedAt = performance.now();
        setLoading(true);
        try {
            const newFiles = await fetchDirectory(path, force);
            if (requestId !== latestRequestRef.current) return;
            log.info(`[FileBrowser] Listed ${path}: ${newFiles.length} entries in ${Math.round(performance.now() - startedAt)}ms`);
            setFiles(newFiles);
            setCurrentPath(path);
        } catch (error: unknown) {
            if (requestId !== latestRequestRef.current) return;
            log.error(`[FileBrowser] Listing ${path} failed`, error);
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
            setFiles([]);
        } finally {
            if (requestId === latestRequestRef.current) {
                setLoading(false);
                setHasLoaded(true);
            }
        }
    }, [fetchDirectory, pushToast, t]);

    // Only this directory is stale — wiping the whole cache meant every parent had to be
    // fetched again on the way back up.
    const refresh = useCallback(() => {
        pathCacheRef.current.delete(currentPath);
        loadFiles(currentPath, true);
    }, [currentPath, loadFiles]);

    const navigateTo = useCallback((path: string) => loadFiles(path), [loadFiles]);
    const navigateUp = useCallback(() => loadFiles(parentPath(currentPath)), [currentPath, loadFiles]);

    const navigateInto = useCallback((entry: FileEntry) => {
        if (entry.type === 'd') loadFiles(joinPath(currentPath, entry.name));
    }, [currentPath, loadFiles]);

    // ── File open ────────────────────────────────────────────────────────────────
    const openFileEntry = useCallback(async (entry: FileEntry) => {
        const path = joinPath(currentPath, entry.name);
        const kind = getFileKind(entry.name, entry.type);

        if (kind === 'folder') {
            loadFiles(path);
            return;
        }

        if (kind === 'binary') {
            pushToast(t('fileBrowser.cannotPreview'), 'info');
            return;
        }

        // Size guard: refuse to open files > 5MB
        if (entry.size > 5 * 1024 * 1024) {
            pushToast(t('fileBrowser.cannotPreview'), 'info');
            return;
        }

        setOpeningFile(true);
        try {
            const { bytes } = await window.electron.sftpReadFile(connectionId, path);
            const imageMime = detectImageMime(entry.name, bytes);
            releaseObjectUrl();

            if (imageMime) {
                // An object URL rather than a data URL: the bytes are handed to the
                // image decoder as they are, with no base64 string in between.
                const url = URL.createObjectURL(new Blob([bytes], { type: imageMime }));
                objectUrlRef.current = url;
                setOpenFile({ kind: 'image', name: entry.name, path, entry, bytes, content: url });
                return;
            }

            if (isProbablyBinary(bytes)) {
                pushToast(t('fileBrowser.cannotPreview'), 'info');
                return;
            }

            const encoding = detectTextEncoding(bytes);
            setOpenFile({
                kind: 'text',
                name: entry.name,
                path,
                entry,
                bytes,
                encoding,
                content: decodeText(bytes, encoding),
            });
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
        } finally {
            setOpeningFile(false);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, releaseObjectUrl, t]);

    const closeFile = useCallback(() => {
        releaseObjectUrl();
        setOpenFile(null);
    }, [releaseObjectUrl]);

    const setFileEncoding = useCallback((encoding: TextFileEncoding) => {
        setOpenFile((current) => {
            if (!current || current.kind !== 'text') return current;
            return { ...current, encoding, content: decodeText(current.bytes, encoding) };
        });
    }, []);

    const saveFile = useCallback(async (path: string, content: string, encoding: TextFileEncoding = 'utf-8') => {
        try {
            await window.electron.sftpWriteFile(connectionId, path, content, encoding);
            pushToast(t('common.success'), 'success');
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
            throw error;
        }
    }, [connectionId, pushToast, t]);

    // ── Create ───────────────────────────────────────────────────────────────────
    const createFolder = useCallback(async (name: string) => {
        try {
            const newPath = joinPath(currentPath, validateEntryName(name, t('fileBrowser.invalidName')));
            await window.electron.sftpMkdir(connectionId, newPath);
            pathCacheRef.current.delete(currentPath);
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, t]);

    const createFile = useCallback(async (name: string) => {
        try {
            const newPath = joinPath(currentPath, validateEntryName(name, t('fileBrowser.invalidName')));
            await window.electron.sftpWriteFile(connectionId, newPath, '');
            pathCacheRef.current.delete(currentPath);
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, t]);

    // ── Delete ───────────────────────────────────────────────────────────────────
    const deleteEntry = useCallback(async (entry: FileEntry) => {
        const path = joinPath(currentPath, entry.name);
        try {
            await window.electron.sftpDelete(connectionId, path);
            pathCacheRef.current.delete(currentPath);
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, t]);

    // ── Rename ───────────────────────────────────────────────────────────────────
    const renameEntry = useCallback(async (entry: FileEntry, newName: string) => {
        const oldPath = joinPath(currentPath, entry.name);
        try {
            const safeName = validateEntryName(newName, t('fileBrowser.invalidName'));
            if (safeName === entry.name) return;
            const newPath = joinPath(currentPath, safeName);
            await window.electron.sftpRename(connectionId, oldPath, newPath);
            pathCacheRef.current.delete(currentPath);
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, t]);

    // ── Download ─────────────────────────────────────────────────────────────────
    const downloadEntry = useCallback(async (entry: FileEntry) => {
        // Pass the server filename as default so the save dialog pre-fills it
        const localPath = await window.electron.saveDialog(entry.name);
        if (!localPath) return;

        const remotePath = joinPath(currentPath, entry.name);
        const tid = transferQueue.addTransfer(entry.name, 'download', localPath, remotePath);
        try {
            await window.electron.sftpDownload(connectionId, remotePath, localPath, tid);
            transferQueue.markDone(tid);
        } catch (error: unknown) {
            transferQueue.markError(tid, errorMessage(error));
            pushToast(`${t('fileBrowser.download')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, transferQueue, pushToast, t]);

    // ── Upload ───────────────────────────────────────────────────────────────────
    const uploadFile = useCallback(async (fileOrPath?: File | string) => {
        let filePath: string | undefined;
        let filename: string | undefined;

        try {
            if (fileOrPath instanceof File) {
                filePath = window.electron.getPathForFile(fileOrPath);
                filename = fileOrPath.name;
            } else {
                filePath = fileOrPath ?? await window.electron.openDialog();
            }
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
            return;
        }

        if (!filePath) return;

        filename ??= filePath.split(/[\\/]/).pop() ?? 'file';
        const remotePath = joinPath(currentPath, filename);
        const tid = transferQueue.addTransfer(filename, 'upload', filePath, remotePath);
        try {
            await window.electron.sftpUpload(connectionId, filePath, remotePath, tid);
            transferQueue.markDone(tid);
            pathCacheRef.current.delete(currentPath);
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            transferQueue.markError(tid, errorMessage(error));
            pushToast(`${t('fileBrowser.upload')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, transferQueue, pushToast, t]);

    const retryTransfer = useCallback(async (transfer: TransferItem) => {
        transferQueue.restart(transfer.id);
        try {
            if (transfer.direction === 'download') {
                await window.electron.sftpResumeDownload(connectionId, transfer.remotePath, transfer.localPath, transfer.id);
            } else {
                await window.electron.sftpResumeUpload(connectionId, transfer.localPath, transfer.remotePath, transfer.id);
                pathCacheRef.current.delete(currentPath);
                await loadFiles(currentPath, true);
            }
            transferQueue.markDone(transfer.id);
        } catch (error: unknown) {
            transferQueue.markError(transfer.id, errorMessage(error));
            pushToast(`${t('fileBrowser.resumeTransfer')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, t, transferQueue]);

    const openTransferLocation = useCallback((transfer: TransferItem) => {
        if (transfer.direction === 'download' && transfer.localPath) {
            void window.electron.showItemInFolder(transfer.localPath);
        }
    }, []);

    // ── Drop upload ──────────────────────────────────────────────────────────────
    /**
     * Three at a time. Strictly sequential spent most of its time on the per-file round
     * trip when a folder of small files was dropped, and going fully parallel would open
     * a channel per file against a server that may cap them.
     */
    const uploadDroppedFiles = useCallback(async (nativeFiles: File[]) => {
        const queue = [...nativeFiles];
        const worker = async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
                await uploadFile(next);
            }
        };
        await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker));
    }, [uploadFile]);

    return {
        // State
        currentPath, files, loading, openingFile, hasLoaded, openFile, toasts,
        transfers: transferQueue.transfers,
        activeTransferCount: transferQueue.activeCount,
        // File ops
        loadFiles, refresh, navigateTo, navigateUp, navigateInto,
        openFileEntry, closeFile, setFileEncoding, saveFile,
        createFolder, createFile,
        deleteEntry, renameEntry,
        downloadEntry, uploadFile, uploadDroppedFiles,
        // Toast
        dismissToast,
        // Transfer history
        clearTransferHistory: transferQueue.clearHistory,
        retryTransfer,
        openTransferLocation,
    };
}
