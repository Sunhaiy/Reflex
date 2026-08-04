import { useState, useCallback, useMemo } from 'react';

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'active' | 'done' | 'error';

export interface TransferItem {
    id: string;
    name: string;
    direction: TransferDirection;
    status: TransferStatus;
    progress: number; // 0-100
    error?: string;
    startedAt: number;
    completedAt?: number;
    localPath: string;
    remotePath: string;
    transferred: number;
    total: number;
}

let _id = 0;
function nextId() { return String(++_id); }

const MAX_HISTORY = 20;

export function useTransferQueue() {
    const [transfers, setTransfers] = useState<TransferItem[]>([]);

    const addTransfer = useCallback((name: string, direction: TransferDirection, localPath: string, remotePath: string): string => {
        const id = nextId();
        setTransfers(prev => [
            { id, name, direction, status: 'active', progress: 0, startedAt: Date.now(), localPath, remotePath, transferred: 0, total: 0 },
            ...prev,
        ]);
        return id;
    }, []);

    const updateProgress = useCallback((id: string, progress: number, transferred: number, total: number) => {
        setTransfers(prev => prev.map(t => t.id === id ? { ...t, progress, transferred, total } : t));
    }, []);

    const markDone = useCallback((id: string) => {
        setTransfers(prev => {
            const updated = prev.map(t =>
                t.id === id ? { ...t, status: 'done' as const, progress: 100, completedAt: Date.now() } : t
            );
            // Trim old completed items beyond MAX_HISTORY
            const active = updated.filter(t => t.status === 'active');
            const done = updated.filter(t => t.status !== 'active').slice(0, MAX_HISTORY);
            return [...active, ...done];
        });
    }, []);

    const markError = useCallback((id: string, error: string) => {
        setTransfers(prev => prev.map(t =>
            t.id === id ? { ...t, status: 'error' as const, error, completedAt: Date.now() } : t
        ));
    }, []);

    const restart = useCallback((id: string) => {
        setTransfers(prev => prev.map(t => t.id === id ? {
            ...t,
            status: 'active' as const,
            error: undefined,
            completedAt: undefined,
            startedAt: Date.now(),
        } : t));
    }, []);

    const clearHistory = useCallback(() => {
        setTransfers(prev => prev.filter(t => t.status === 'active'));
    }, []);

    const activeCount = transfers.filter(t => t.status === 'active').length;

    // Memoised because the callers wrap it in useCallback. A fresh object literal here
    // changed identity on every render and invalidated all of them, which defeated the
    // memoisation on everything the file browser hands those callbacks to.
    return useMemo(
        () => ({ transfers, activeCount, addTransfer, updateProgress, markDone, markError, restart, clearHistory }),
        [activeCount, addTransfer, clearHistory, markDone, markError, restart, transfers, updateProgress],
    );
}
