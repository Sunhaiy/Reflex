type Level = 'info' | 'warn' | 'error';

function serialize(detail: unknown) {
    if (detail instanceof Error) {
        return { name: detail.name, message: detail.message, stack: detail.stack };
    }
    return detail;
}

function send(level: Level, message: string, detail?: unknown) {
    try {
        window.electron.logWrite(level, message, serialize(detail));
    } catch {
        // Logging must never throw into the caller's path.
    }
}

export const log = {
    info: (message: string, detail?: unknown) => send('info', message, detail),
    warn: (message: string, detail?: unknown) => send('warn', message, detail),
    error: (message: string, detail?: unknown) => send('error', message, detail),
};

/** Catches anything that escapes React so it still lands in the log file. */
export function installGlobalErrorLogging() {
    window.addEventListener('error', (event) => {
        log.error(`[Renderer] Uncaught error: ${event.message}`, {
            source: `${event.filename}:${event.lineno}:${event.colno}`,
            stack: event.error instanceof Error ? event.error.stack : undefined,
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        log.error('[Renderer] Unhandled promise rejection', serialize(event.reason));
    });
}
