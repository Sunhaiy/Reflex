/**
 * Mirrors what the agent runs into the session's terminal.
 *
 * The agent works on its own shell channel, which is what keeps its output framed and its
 * working directory separate from yours — but it also means the terminal shows nothing
 * while it works, and watching a build scroll is exactly what a terminal is for. So the
 * command and its output are echoed here.
 *
 * This is display only. Nothing written this way reaches the server, and the agent's
 * channel is unaffected; it is the same as output from a background job arriving while
 * you have a prompt open.
 */

const EVENT = 'terminal-echo';

const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

export interface TerminalEchoDetail {
  connectionId: string;
  text: string;
}

function emit(connectionId: string, text: string) {
  window.dispatchEvent(new CustomEvent<TerminalEchoDetail>(EVENT, {
    detail: { connectionId, text },
  }));
}

/** xterm needs a carriage return for a real line break; a shell only sends the newline. */
function toTerminalNewlines(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

export function echoAgentCommand(connectionId: string, command: string) {
  const oneLine = command.replace(/\s*\n\s*/g, ' ; ');
  emit(connectionId, `\r\n${DIM}${CYAN}▍agent${RESET}${DIM} $ ${oneLine}${RESET}\r\n`);
}

export function echoAgentOutput(connectionId: string, chunk: string) {
  emit(connectionId, toTerminalNewlines(chunk));
}

export function echoAgentResult(connectionId: string, isError: boolean) {
  const colour = isError ? RED : '';
  emit(connectionId, `${DIM}${colour}▍${isError ? 'failed' : 'done'}${RESET}\r\n`);
}

export function subscribeTerminalEcho(
  connectionId: string,
  write: (text: string) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<TerminalEchoDetail>).detail;
    if (detail?.connectionId === connectionId) write(detail.text);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
