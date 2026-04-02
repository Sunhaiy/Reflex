import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { app } from 'electron';
import type { LLMMessage } from '../../llm.js';
import type { ChildTaskSummary, TaskRunSummary } from '../../../src/shared/types.js';

interface TranscriptEntry {
  kind: 'message' | 'task' | 'progress' | 'subagent';
  timestamp: number;
  role?: 'user' | 'assistant' | 'tool' | 'system';
  content?: string;
  task?: {
    id: string;
    goal: string;
    phase: string;
    status: string;
    route?: string;
    currentAction?: string;
      finalUrl?: string;
    };
  progress?: {
    runId?: string;
    content: string;
  };
  subagent?: {
    id: string;
    parentRunId?: string;
    lineageKey?: string;
    title: string;
    status: string;
    summary?: string;
    error?: string;
  };
}

function clip(text: string, maxChars = 4000) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function getBaseDir() {
  try {
    return app.getPath('userData');
  } catch {
    return path.join(os.homedir(), '.zangqing');
  }
}

export class AgentTranscriptStore {
  private writeQueues = new Map<string, Promise<void>>();

  private transcriptPath(sessionId: string) {
    return path.join(getBaseDir(), 'agent-transcripts', `${sessionId}.jsonl`);
  }

  private enqueue(sessionId: string, task: () => Promise<void>) {
    const previous = this.writeQueues.get(sessionId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task);
    this.writeQueues.set(sessionId, next);
    return next;
  }

  async appendMessage(sessionId: string, message: LLMMessage) {
    const entry: TranscriptEntry = {
      kind: 'message',
      timestamp: Date.now(),
      role: message.role as TranscriptEntry['role'],
      content: clip(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)),
    };
    return this.appendEntry(sessionId, entry);
  }

  async appendTaskSnapshot(sessionId: string, taskRun: TaskRunSummary) {
    const route = taskRun.activeHypothesisId
      ? taskRun.hypotheses.find((item) => item.id === taskRun.activeHypothesisId)?.kind || taskRun.activeHypothesisId
      : undefined;
    const entry: TranscriptEntry = {
      kind: 'task',
      timestamp: Date.now(),
      task: {
        id: taskRun.id,
        goal: clip(taskRun.goal, 500),
        phase: taskRun.phase,
        status: taskRun.status,
        route,
        currentAction: taskRun.currentAction ? clip(taskRun.currentAction, 800) : undefined,
        finalUrl: taskRun.finalUrl,
      },
    };
    return this.appendEntry(sessionId, entry);
  }

  async appendProgress(sessionId: string, runId: string | undefined, content: string) {
    return this.appendEntry(sessionId, {
      kind: 'progress',
      timestamp: Date.now(),
      progress: {
        runId,
        content: clip(content, 1200),
      },
    });
  }

  async appendSubagentSnapshot(sessionId: string, childRun: ChildTaskSummary) {
    return this.appendEntry(sessionId, {
      kind: 'subagent',
      timestamp: Date.now(),
      subagent: {
        id: childRun.id,
        parentRunId: childRun.parentRunId,
        lineageKey: childRun.lineageKey,
        title: clip(childRun.title, 200),
        status: childRun.status,
        summary: childRun.summary ? clip(childRun.summary, 1200) : undefined,
        error: childRun.error ? clip(childRun.error, 800) : undefined,
      },
    });
  }

  async loadRecentMessages(sessionId: string, limit = 12): Promise<LLMMessage[]> {
    const targetPath = this.transcriptPath(sessionId);
    try {
      const content = await fs.readFile(targetPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-200);
      const parsed = lines
        .map((line) => {
          try {
            return JSON.parse(line) as TranscriptEntry;
          } catch {
            return null;
          }
        })
        .filter((item): item is TranscriptEntry => Boolean(item));
      return parsed
        .filter((entry) => entry.kind === 'message' && entry.role && entry.content?.trim())
        .slice(-limit)
        .map((entry) => ({
          role: (entry.role === 'tool' ? 'assistant' : entry.role) || 'assistant',
          content: entry.content || '',
        }));
    } catch {
      return [];
    }
  }

  async loadRecentProgress(sessionId: string, limit = 24): Promise<string[]> {
    const targetPath = this.transcriptPath(sessionId);
    try {
      const content = await fs.readFile(targetPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-400);
      const parsed = lines
        .map((line) => {
          try {
            return JSON.parse(line) as TranscriptEntry;
          } catch {
            return null;
          }
        })
        .filter((item): item is TranscriptEntry => Boolean(item));
      return parsed
        .filter((entry) => entry.kind === 'progress' && entry.progress?.content?.trim())
        .slice(-limit)
        .map((entry) => entry.progress?.content || '');
    } catch {
      return [];
    }
  }

  private appendEntry(sessionId: string, entry: TranscriptEntry) {
    const targetPath = this.transcriptPath(sessionId);
    return this.enqueue(sessionId, async () => {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.appendFile(targetPath, `${JSON.stringify(entry)}\n`, 'utf8');
    });
  }
}
