import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'main' | 'renderer';

const MAX_BYTES = 2 * 1024 * 1024;
const LOG_NAME = 'reflex.log';

let logDir = '';
let logFile = '';
let ready = false;
let currentSize = 0;

function ensureReady() {
    if (ready) return true;
    try {
        logDir = path.join(app.getPath('userData'), 'logs');
        logFile = path.join(logDir, LOG_NAME);
        fs.mkdirSync(logDir, { recursive: true });
        // Sized once here so appends never need a stat() syscall.
        try { currentSize = fs.statSync(logFile).size; } catch { currentSize = 0; }
        ready = true;
    } catch (error) {
        // Never let logging failures break the app.
        console.error('[Logger] Unable to prepare log directory:', error);
    }
    return ready;
}

/** Keeps one previous file so a crash loop cannot fill the disk. */
function rotateIfNeeded() {
    if (currentSize < MAX_BYTES) return;
    try {
        fs.renameSync(logFile, path.join(logDir, `${LOG_NAME}.1`));
        currentSize = 0;
    } catch {
        // Rotation failed — keep appending rather than losing the entry.
    }
}

/**
 * Writes are queued and flushed asynchronously. Synchronous appends here would block
 * the main process, and that is the same thread that pumps SSH terminal traffic, so a
 * slow disk showed up as input lag in the terminal.
 */
let queued: string[] = [];
let flushing = false;

function flushQueue() {
    if (flushing || queued.length === 0 || !ready) return;
    flushing = true;
    const chunk = queued.join('');
    queued = [];

    rotateIfNeeded();
    // Counted before the write resolves: a burst can be flushed as one large chunk, and
    // waiting for the callback would let the next rotation check read a stale size.
    currentSize += Buffer.byteLength(chunk);

    fs.promises.appendFile(logFile, chunk, 'utf8')
        .catch((error) => console.error('[Logger] Append failed:', error))
        .finally(() => {
            flushing = false;
            if (queued.length > 0) flushQueue();
        });
}

/** Drains anything still queued before the process exits. */
export function flushLogSync() {
    if (!ready || queued.length === 0) return;
    const chunk = queued.join('');
    queued = [];
    try {
        fs.appendFileSync(logFile, chunk, 'utf8');
    } catch {
        // Nothing useful left to do while shutting down.
    }
}

function formatDetail(detail: unknown): string {
    if (detail === undefined) return '';
    if (detail instanceof Error) return `\n${detail.stack || `${detail.name}: ${detail.message}`}`;
    if (typeof detail === 'string') return ` ${detail}`;
    try {
        return ` ${JSON.stringify(detail)}`;
    } catch {
        return ` ${String(detail)}`;
    }
}

export function writeLog(level: LogLevel, source: LogSource, message: string, detail?: unknown) {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${source}] ${message}${formatDetail(detail)}\n`;

    // Only problems go to stdout; routine progress would be a lot of synchronous
    // console writes on the same thread that pumps terminal traffic.
    if (level === 'error') console.error(line.trimEnd());
    else if (level === 'warn') console.warn(line.trimEnd());

    if (!ensureReady()) return;
    queued.push(line);
    flushQueue();
}

export const logger = {
    info: (message: string, detail?: unknown) => writeLog('info', 'main', message, detail),
    warn: (message: string, detail?: unknown) => writeLog('warn', 'main', message, detail),
    error: (message: string, detail?: unknown) => writeLog('error', 'main', message, detail),
};

export function getLogFilePath() {
    ensureReady();
    return logFile;
}

export function getLogDirectory() {
    ensureReady();
    return logDir;
}

export function readRecentLog(maxLines = 500) {
    if (!ensureReady()) return '';
    try {
        const lines = fs.readFileSync(logFile, 'utf8').split('\n');
        return lines.slice(-maxLines).join('\n');
    } catch {
        return '';
    }
}
