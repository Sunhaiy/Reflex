import { ActivityLog } from './ActivityLog';
import { useActivityLines } from '../lib/activityStore';

/**
 * Terminal connect overlay. Every line is a real ssh2 event streamed from the main
 * process — handshake algorithms, server banner, auth result and shell open.
 */
export function TerminalConnecting({ connectionId }: { connectionId: string }) {
    const lines = useActivityLines('session', connectionId);

    return (
        <div className="absolute inset-0 z-30 bg-[hsl(var(--background))]">
            <ActivityLog lines={lines} placeholder="Opening connection..." />
        </div>
    );
}
