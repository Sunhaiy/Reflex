import { useState, useCallback, useEffect, useRef } from 'react';
import type { FileEntry } from '../../../shared/types';
import { joinPath, parentPath, getFileKind } from '../utils/fileUtils';
import { useTransferQueue } from './useTransferQueue';

export interface FileOpenResult {
    kind: 'text' | 'image';
    name: string;
    path: string;
    entry: FileEntry;
    content: string; // text content or base64 data URL for images
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

function validateEntryName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('名称不能为空');
    if (trimmed === '.' || trimmed === '..') throw new Error('名称不能是 . 或 ..');
    if (/[\\/\0]/.test(trimmed)) throw new Error('名称不能包含路径分隔符');
    return trimmed;
}

export function useFileBrowser(connectionId: string) {
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
        setLoading(true);
        try {
            let resolvedPath = path;
            if (path === '.') {
                resolvedPath = await window.electron.getPwd(connectionId);
            }

            const newFiles = await fetchDirectory(resolvedPath, force);
            if (requestId !== latestRequestRef.current) return;
            setFiles(newFiles);
            setCurrentPath(resolvedPath);
        } catch (error: unknown) {
            if (requestId !== latestRequestRef.current) return;
            pushToast(`无法加载目录: ${errorMessage(error)}`);
            setFiles([]);
        } finally {
            if (requestId === latestRequestRef.current) {
                setLoading(false);
                setHasLoaded(true);
            }
        }
    }, [connectionId, fetchDirectory, pushToast]);

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
            pushToast(`"${entry.name}" 是二进制文件，无法在编辑器中打开`, 'info');
            return;
        }

        // Size guard: refuse to open files > 5MB
        if (entry.size > 5 * 1024 * 1024) {
            pushToast(`文件超过 5MB，无法在编辑器中打开`, 'info');
            return;
        }

        setOpeningFile(true);
        try {
            const content = await window.electron.sftpReadFile(connectionId, path);
            if (kind === 'image') {
                // Content from sftpReadFile is a base64 string for binary files
                const ext = entry.name.split('.').pop()?.toLowerCase() ?? 'png';
                const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
                setOpenFile({ kind: 'image', name: entry.name, path, entry, content: `data:${mime};base64,${content}` });
            } else {
                setOpenFile({ kind: 'text', name: entry.name, path, entry, content });
            }
        } catch (error: unknown) {
            pushToast(`无法打开文件: ${errorMessage(error)}`);
        } finally {
            setOpeningFile(false);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    const closeFile = useCallback(() => setOpenFile(null), []);

    const saveFile = useCallback(async (path: string, content: string) => {
        try {
            await window.electron.sftpWriteFile(connectionId, path, content);
            pushToast('保存成功', 'success');
        } catch (error: unknown) {
            pushToast(`保存失败: ${errorMessage(error)}`);
            throw error;
        }
    }, [connectionId, pushToast]);

    // ── Create ───────────────────────────────────────────────────────────────────
    const createFolder = useCallback(async (name: string) => {
        try {
            const newPath = joinPath(currentPath, validateEntryName(name));
            await window.electron.sftpMkdir(connectionId, newPath);
            delete pathCacheRef.current[currentPath];
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`创建文件夹失败: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    const createFile = useCallback(async (name: string) => {
        try {
            const newPath = joinPath(currentPath, validateEntryName(name));
            await window.electron.sftpWriteFile(connectionId, newPath, '');
            delete pathCacheRef.current[currentPath];
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`创建文件失败: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    // ── Delete ───────────────────────────────────────────────────────────────────
    const deleteEntry = useCallback(async (entry: FileEntry) => {
        const path = joinPath(currentPath, entry.name);
        try {
            await window.electron.sftpDelete(connectionId, path);
            delete pathCacheRef.current[currentPath];
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`删除失败: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    // ── Rename ───────────────────────────────────────────────────────────────────
    const renameEntry = useCallback(async (entry: FileEntry, newName: string) => {
        const oldPath = joinPath(currentPath, entry.name);
        try {
            const safeName = validateEntryName(newName);
            if (safeName === entry.name) return;
            const newPath = joinPath(currentPath, safeName);
            await window.electron.sftpRename(connectionId, oldPath, newPath);
            delete pathCacheRef.current[currentPath];
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            pushToast(`重命名失败: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    // ── Download ─────────────────────────────────────────────────────────────────
    const downloadEntry = useCallback(async (entry: FileEntry) => {
        // Pass the server filename as default so the save dialog pre-fills it
        const localPath = await window.electron.saveDialog(entry.name);
        if (!localPath) return;

        const remotePath = joinPath(currentPath, entry.name);
        const tid = transferQueue.addTransfer(entry.name, 'download');
        try {
            await window.electron.sftpDownload(connectionId, remotePath, localPath);
            transferQueue.markDone(tid);
        } catch (error: unknown) {
            transferQueue.markError(tid, errorMessage(error));
            pushToast(`下载失败: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, transferQueue, pushToast]);

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
            pushToast(`无法读取本地文件路径: ${errorMessage(error)}`);
            return;
        }

        if (!filePath) return;

        filename ??= filePath.split(/[\\/]/).pop() ?? 'file';
        const remotePath = joinPath(currentPath, filename);
        const tid = transferQueue.addTransfer(filename, 'upload');
        try {
            await window.electron.sftpUpload(connectionId, filePath, remotePath);
            transferQueue.markDone(tid);
            delete pathCacheRef.current[currentPath];
            await loadFiles(currentPath, true);
        } catch (error: unknown) {
            transferQueue.markError(tid, errorMessage(error));
            pushToast(`上传失败: ${errorMessage(error)}`);
        }
    }, [connectionId, currentPath, loadFiles, transferQueue, pushToast]);

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
        openFileEntry, closeFile, saveFile,
        createFolder, createFile,
        deleteEntry, renameEntry,
        downloadEntry, uploadFile, uploadDroppedFiles,
        // Toast
        dismissToast,
        // Transfer history
        clearTransferHistory: transferQueue.clearHistory,
    };
}
