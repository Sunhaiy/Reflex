const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { AgentService } = require('../dist-electron/electron/agent/service.js');
const { CommandService } = require('../dist-electron/electron/ssh/commandService.js');

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0 };

class MemoryStore {
  values = new Map();

  get(key) {
    return this.values.get(key);
  }

  set(key, value) {
    this.values.set(key, value);
  }
}

class FakeChannel extends EventEmitter {
  stderr = new EventEmitter();
  destroyed = false;

  constructor({ completeCommands }) {
    super();
    this.completeCommands = completeCommands;
    this.commandStarted = new Promise((resolve) => {
      this.markCommandStarted = resolve;
    });
  }

  write(data) {
    const text = String(data);
    const ready = text.match(/echo (__RFX_READY_[a-f0-9]+__)/);
    if (ready) {
      queueMicrotask(() => this.emit('data', Buffer.from(`${ready[1]}\n`)));
      return true;
    }

    if (this.completeCommands) {
      const frame = text.match(/echo "(__RFX_[a-f0-9]+_\d+__):\$__rfx_ec"/);
      if (frame) {
        queueMicrotask(() => this.emit('data', Buffer.from(`probe complete\n${frame[1]}:0\n`)));
      }
    }
    this.markCommandStarted();
    return true;
  }

  destroy() {
    this.destroyed = true;
  }
}

function hostWithChannel(channel) {
  return {
    getConnection() {
      return {
        exec(_command, options, callback) {
          const done = typeof options === 'function' ? options : callback;
          done(null, channel);
        },
      };
    },
  };
}

function toolCallProvider(command, onRequest) {
  let turn = 0;
  return {
    kind: 'openai',
    listModels: async () => [],
    async complete(request, events) {
      onRequest?.(request, turn);
      turn += 1;
      if (turn === 1) {
        const call = { type: 'tool_call', id: 'call-1', name: 'shell', input: { command } };
        events.onToolCall(call);
        return { text: '', toolCalls: [call], stopReason: 'tool_use', usage: EMPTY_USAGE };
      }
      return { text: 'done', toolCalls: [], stopReason: 'end', usage: EMPTY_USAGE };
    },
  };
}

function sendOptions(provider, message, sessionId = 'session-1') {
  return {
    sessionId,
    connectionId: 'server-1',
    conversationId: 'conversation-1',
    serverLabel: 'test server',
    message,
    mode: 'free',
    localRoot: null,
    provider,
    contextBudget: 60_000,
  };
}

function waitForSignal(register, timeoutMs = 500) {
  return Promise.race([
    new Promise(register),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for test signal')), timeoutMs)),
  ]);
}

test('cancelling an Agent run interrupts its active remote command promptly', async () => {
  const channel = new FakeChannel({ completeCommands: false });
  const events = [];
  const service = new AgentService(hostWithChannel(channel), (_sessionId, _conversationId, event) => {
    events.push(event);
  }, new MemoryStore());

  const running = service.send(sendOptions(toolCallProvider('sleep 600'), 'Run the long task'));
  await channel.commandStarted;
  service.cancel('conversation-1');

  const settledPromptly = await Promise.race([
    running.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 200)),
  ]);

  service.disposeAll();
  await running;

  assert.equal(settledPromptly, true, 'cancel left the remote command and Agent run hanging');
  assert.equal(channel.destroyed, true, 'cancel did not close the active SSH command channel');
  assert.ok(events.some((event) => event.type === 'done' && event.stopReason === 'aborted'));
});

test('disconnect checkpoints the unfinished task so Continue retains its goal and progress', async () => {
  const store = new MemoryStore();
  const channel = new FakeChannel({ completeCommands: true });
  let secondTurnEntered;
  const secondTurn = waitForSignal((resolve) => { secondTurnEntered = resolve; });
  let providerTurn = 0;
  const interruptedProvider = {
    kind: 'openai',
    listModels: async () => [],
    async complete(request, events) {
      providerTurn += 1;
      if (providerTurn === 1) {
        const call = { type: 'tool_call', id: 'inspect-1', name: 'shell', input: { command: 'printf inspected' } };
        events.onToolCall(call);
        return { text: '', toolCalls: [call], stopReason: 'tool_use', usage: EMPTY_USAGE };
      }
      secondTurnEntered();
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
      });
    },
  };

  const firstService = new AgentService(hostWithChannel(channel), () => {}, store);
  const interrupted = firstService.send(sendOptions(
    interruptedProvider,
    'Deploy the original VLESS and Hysteria task',
  ));
  await secondTurn;
  firstService.disposeForSession('session-1');
  await interrupted;

  let resumedRequest;
  const resumedProvider = {
    kind: 'openai',
    listModels: async () => [],
    async complete(request) {
      resumedRequest = request;
      return { text: 'resumed', toolCalls: [], stopReason: 'end', usage: EMPTY_USAGE };
    },
  };
  const secondService = new AgentService(hostWithChannel(
    new FakeChannel({ completeCommands: true }),
  ), () => {}, store);
  await secondService.send(sendOptions(resumedProvider, '继续', 'session-2'));

  const text = resumedRequest.messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  const toolResults = resumedRequest.messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === 'tool_result');

  assert.match(text, /Deploy the original VLESS and Hysteria task/);
  assert.match(text, /继续/);
  assert.equal(toolResults.length, 1, 'completed work before disconnect was not checkpointed');
});

test('disconnect tells the renderer that a busy Agent run was aborted', async () => {
  const channel = new FakeChannel({ completeCommands: false });
  const events = [];
  let toolStarted;
  const started = waitForSignal((resolve) => { toolStarted = resolve; });
  const service = new AgentService(hostWithChannel(channel), (_sessionId, _conversationId, event) => {
    events.push(event);
    if (event.type === 'tool_start') toolStarted();
  }, new MemoryStore());

  const running = service.send(sendOptions(toolCallProvider('sleep 600'), 'Keep working'));
  await started;
  service.disposeForSession('session-1');
  await running;

  assert.ok(
    events.some((event) => event.type === 'done' && event.stopReason === 'aborted'),
    'renderer was left in a busy state after the SSH session disappeared',
  );
});

test('a late provider result cannot recreate history after a conversation is deleted', async () => {
  const store = new MemoryStore();
  let providerEntered;
  const entered = waitForSignal((resolve) => { providerEntered = resolve; });
  let finishProvider;
  const provider = {
    kind: 'openai',
    listModels: async () => [],
    async complete(_request, events) {
      providerEntered();
      return new Promise((resolve) => {
        finishProvider = () => {
          const call = { type: 'tool_call', id: 'late-1', name: 'shell', input: { command: 'true' } };
          events.onToolCall(call);
          resolve({ text: '', toolCalls: [call], stopReason: 'tool_use', usage: EMPTY_USAGE });
        };
      });
    },
  };
  const service = new AgentService(
    hostWithChannel(new FakeChannel({ completeCommands: true })),
    () => {},
    store,
  );

  const running = service.send(sendOptions(provider, 'Delete this conversation'));
  await entered;
  assert.equal(service.delete('conversation-1', 'server-1'), true);
  finishProvider();
  await running;

  const saved = store.get('agentModelHistories');
  assert.equal(saved?.['server-1']?.['conversation-1'], undefined);
});

test('Docker availability is a normal capability result, not a command failure', async () => {
  const unavailable = new CommandService({
    getConnection: () => undefined,
    execCommand: async () => ({ stdout: 'unavailable', stderr: '' }),
  });
  const available = new CommandService({
    getConnection: () => undefined,
    execCommand: async () => ({ stdout: 'available', stderr: '' }),
  });

  assert.equal(await unavailable.isDockerAvailable('session-1'), false);
  assert.equal(await available.isDockerAvailable('session-1'), true);
});
