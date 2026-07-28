import { useState, useCallback, useRef } from 'react';
import type { FileEntry } from '../../../shared/types';
import { joinPath, parentPath, getFileKind } from '../utils/fileUtils';
import { useTransferQueue } from './useTransferQueue';

export interface FileOpenResult {
    kind: 'text' | 'image';
    name: string;
    path: string;
    content: string; // text content or base64 data URL for images
}

export interface Toast {
    id: string;
    message: string;
    type: 'error' | 'success' | 'info';
}

let _toastId = 0;

export function useFileBrowser(connectionId: string) {
    const [currentPath, setCurrentPath] = useState('/');
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [openingFile, setOpeningFile] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [openFile, setOpenFile] = useState<FileOpenResult | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [directoryRevision, setDirectoryRevision] = useState(0);

    const pathCacheRef = useRef<Record<string, FileEntry[]>>({});
    const transferQueue = useTransferQueue();

    // ── Toast helpers ────────────────────────────────────────────────────────────
    const pushToast = useCallback((message: string, type: Toast['type'] = 'error') => {
        const id = String(++_toastId);
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
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

    const listDirectories = useCallback(async (path: string, force = false): Promise<FileEntry[]> => {
        const entries = await fetchDirectory(path, force);
        return entries.filter(entry => entry.type === 'd' && entry.name !== '.' && entry.name !== '..');
    }, [fetchDirectory]);

    const loadFiles = useCallback(async (path: string, force = false) => {
        const el = window as any;

        setLoading(true);
        try {
            let resolvedPath = path;
            if (path === '.') {
                resolvedPath = await el.electron.getPwd(connectionId);
            }

            const newFiles = await fetchDirectory(resolvedPath, force);
            setFiles(newFiles);
            setCurrentPath(resolvedPath);
            if (force) setDirectoryRevision(revision => revision + 1);
        } catch (err: any) {
            pushToast(`无法加载目录: ${err?.message ?? err}`);
            setFiles([]);
        } finally {
            setLoading(false);
            setHasLoaded(true);
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
        const el = window as any;
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
            const content = await el.electron.sftpReadFile(connectionId, path);
            if (kind === 'image') {
                // Content from sftpReadFile is a base64 string for binary files
                const ext = entry.name.split('.').pop()?.toLowerCase() ?? 'png';
                const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
                setOpenFile({ kind: 'image', name: entry.name, path, content: `data:${mime};base64,${content}` });
            } else {
                setOpenFile({ kind: 'text', name: entry.name, path, content });
            }
        } catch (err: any) {
            pushToast(`无法打开文件: ${err?.message ?? err}`);
        } finally {
            setOpeningFile(false);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    const closeFile = useCallback(() => setOpenFile(null), []);

    const saveFile = useCallback(async (path: string, content: string) => {
        const el = window as any;
        try {
            await el.electron.sftpWriteFile(connectionId, path, content);
            pushToast('保存成功', 'success');
        } catch (err: any) {
            pushToast(`保存失败: ${err?.message ?? err}`);
        }
    }, [connectionId, pushToast]);

    // ── Create ───────────────────────────────────────────────────────────────────
    const createFolder = useCallback(async (name: string) => {
        const el = window as any;
        const newPath = joinPath(currentPath, name);
        try {
            await el.electron.sftpMkdir(connectionId, newPath);
            pathCacheRef.current[currentPath] = undefined as any;
            await loadFiles(currentPath, true);
        } catch (err: any) {
            pushToast(`创建文件夹失败: ${err?.message ?? err}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    const createFile = useCallback(async (name: string) => {
        const el = window as any;
        const newPath = joinPath(currentPath, name);
        try {
            await el.electron.sftpWriteFile(connectionId, newPath, '');
            pathCacheRef.current[currentPath] = undefined as any;
            await loadFiles(currentPath, true);
        } catch (err: any) {
            pushToast(`创建文件失败: ${err?.message ?? err}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    // ── Delete ───────────────────────────────────────────────────────────────────
    const deleteEntry = useCallback(async (entry: FileEntry) => {
        const el = window as any;
        const path = joinPath(currentPath, entry.name);
        try {
            await el.electron.sftpDelete(connectionId, path);
            pathCacheRef.current[currentPath] = undefined as any;
            await loadFiles(currentPath, true);
        } catch (err: any) {
            pushToast(`删除失败: ${err?.message ?? err}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    // ── Rename ───────────────────────────────────────────────────────────────────
    const renameEntry = useCallback(async (entry: FileEntry, newName: string) => {
        const el = window as any;
        const oldPath = joinPath(currentPath, entry.name);
        const newPath = joinPath(currentPath, newName);
        try {
            await el.electron.sftpRename(connectionId, oldPath, newPath);
            pathCacheRef.current[currentPath] = undefined as any;
            await loadFiles(currentPath, true);
        } catch (err: any) {
            pushToast(`重命名失败: ${err?.message ?? err}`);
        }
    }, [connectionId, currentPath, loadFiles, pushToast]);

    // ── Download ─────────────────────────────────────────────────────────────────
    const downloadEntry = useCallback(async (entry: FileEntry) => {
        const el = window as any;
        // Pass the server filename as default so the save dialog pre-fills it
        const localPath = await el.electron.saveDialog(entry.name);
        if (!localPath) return;

        const remotePath = joinPath(currentPath, entry.name);
        const tid = transferQueue.addTransfer(entry.name, 'download');
        try {
            await el.electron.sftpDownload(connectionId, remotePath, localPath);
            transferQueue.markDone(tid);
        } catch (err: any) {
            transferQueue.markError(tid, err?.message ?? String(err));
            pushToast(`下载失败: ${err?.message ?? err}`);
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
        } catch (err: any) {
            pushToast(`无法读取本地文件路径: ${err?.message ?? err}`);
            return;
        }

        if (!filePath) return;

        filename ??= filePath.split(/[\\/]/).pop() ?? 'file';
        const remotePath = joinPath(currentPath, filename);
        const tid = transferQueue.addTransfer(filename, 'upload');
        try {
            await window.electron.sftpUpload(connectionId, filePath, remotePath);
            transferQueue.markDone(tid);
            pathCacheRef.current[currentPath] = undefined as any;
            await loadFiles(currentPath, true);
        } catch (err: any) {
            transferQueue.markError(tid, err?.message ?? String(err));
            pushToast(`上传失败: ${err?.message ?? err}`);
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
        directoryRevision,
        transfers: transferQueue.transfers,
        activeTransferCount: transferQueue.activeCount,
        // File ops
        loadFiles, listDirectories, refresh, navigateTo, navigateUp, navigateInto,
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
