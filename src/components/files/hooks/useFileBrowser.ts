import { useState, useCallback, useEffect, useRef } from 'react';
import type { FileEntry, TextFileEncoding } from '../../../shared/types';
import { log } from '../../../lib/logger';
import {
    base64ToBytes,
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
    content: string; // decoded text or a data URL for images
    rawBase64: string;
    encoding?: TextFileEncoding;
}

export interface Toast {
    id: string;
    message: string;
    type: 'error' | 'success' | 'info';
}

let _toastId = 0;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function validateEntryName(name: string, invalidMessage: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\0]/.test(trimmed)) {
        throw new Error(invalidMessage);
    }
    return trimmed;
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

    const pathCacheRef = useRef<Record<string, FileEntry[]>>({});
    const latestRequestRef = useRef(0);
    const toastTimersRef = useRef<Set<number>>(new Set());
    const transferQueue = useTransferQueue();

    useEffect(() => window.electron.onSftpTransferProgress(({ transferId, progress, transferred, total }) => {
        transferQueue.updateProgress(transferId, progress, transferred, total);
    }), [transferQueue.updateProgress]);

    useEffect(() => () => {
        toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        toastTimersRef.current.clear();
    }, []);

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
        if (!force && pathCacheRef.current[path]) return pathCacheRef.current[path];

        const list = await window.electron.sftpList(connectionId, path);
        const entries: FileEntry[] = Array.isArray(list) ? list : [];
        pathCacheRef.current[path] = entries;
        return entries;
    }, [connectionId]);

    const loadFiles = useCallback(async (path: string, force = false) => {
        const requestId = ++latestRequestRef.current;
        const startedAt = performance.now();
        setLoading(true);
        try {
            let resolvedPath = path;
            if (path === '.') {
                resolvedPath = await window.electron.getPwd(connectionId);
            }

            const newFiles = await fetchDirectory(resolvedPath, force);
            if (requestId !== latestRequestRef.current) return;
            log.info(`[FileBrowser] Listed ${resolvedPath}: ${newFiles.length} entries in ${Math.round(performance.now() - startedAt)}ms`);
            setFiles(newFiles);
            setCurrentPath(resolvedPath);
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
    }, [connectionId, fetchDirectory, pushToast, t]);

    const refresh = useCallback(() => {
        pathCacheRef.current = {};
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
            const payload = await window.electron.sftpReadFile(connectionId, path);
            const bytes = base64ToBytes(payload.base64);
            const imageMime = detectImageMime(entry.name, bytes);

            if (imageMime) {
                setOpenFile({
                    kind: 'image',
                    name: entry.name,
                    path,
                    entry,
                    rawBase64: payload.base64,
                    content: `data:${imageMime};base64,${payload.base64}`,
                });
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
                rawBase64: payload.base64,
                encoding,
                content: decodeText(bytes, encoding),
            });
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
        } finally {
            setOpeningFile(false);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, t]);

    const closeFile = useCallback(() => setOpenFile(null), []);

    const setFileEncoding = useCallback((encoding: TextFileEncoding) => {
        setOpenFile((current) => {
            if (!current || current.kind !== 'text') return current;
            return {
                ...current,
                encoding,
                content: decodeText(base64ToBytes(current.rawBase64), encoding),
            };
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
            delete pathCacheRef.current[currentPath];
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`${t('common.error')}: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast, t]);

    const createFile = useCallback(async (name: string) => {
        try {
            const newPath = joinPath(currentPath, validateEntryName(name, t('fileBrowser.invalidName')));
            await window.electron.sftpWriteFile(connectionId, newPath, '');
            delete pathCacheRef.current[currentPath];
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
            delete pathCacheRef.current[currentPath];
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
            delete pathCacheRef.current[currentPath];
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
            delete pathCacheRef.current[currentPath];
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
                delete pathCacheRef.current[currentPath];
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
    const uploadDroppedFiles = useCallback(async (nativeFiles: File[]) => {
        for (const file of nativeFiles) {
            await uploadFile(file);
        }
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
