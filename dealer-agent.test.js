import assert from 'node:assert/strict';
import test from 'node:test';
import { DealerAgent } from './dealer-agent.js';

function jsonResponse(value, ok = true) {
  return { ok, text: async () => JSON.stringify(value) };
}

function snapshot(overrides = {}) {
  return {
    pot: 30,
    currentPlayer: { name: 'Sam', chips: 355, amountToCall: 0 },
    availableActions: [{ type: 'CALL' }, { type: 'BET' }],
    canUndo: false,
    players: [{ number: 1, name: 'Sam', chips: 355, roundBet: 0 }],
    sidePotAmounts: [],
    ...overrides,
  };
}

test('posts state and transcript to /api/dealer and applies the returned tool', async () => {
  const requests = [];
  const toolCalls = [];
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true };
    },
    fetchImplementation: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({
        speak: true,
        kind: 'action_result',
        utterance: 'DEALER FACTS: {"requested":"call"}',
        toolName: 'call',
        toolArgs: {},
      });
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'I call' });

  assert.equal(requests[0].url, '/api/dealer');
  assert.equal(requests[0].body.transcript, 'I call');
  assert.equal(requests[0].body.gameState.currentPlayer.name, 'Sam');
  assert.deepEqual(toolCalls, [{ name: 'call', args: {} }]);
  assert.equal(result.speak, true);
  assert.equal(result.kind, 'action_result');
  assert.match(result.utterance, /"requested":"call"/);
  assert.ok(result.timing.serverMs >= 0);
  assert.ok(result.timing.javascriptMs >= 0);
});

test('asks the server for a rejection line when the tool call fails', async () => {
  const requests = [];
  let call = 0;
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => ({ ok: false, errorCode: 'CHIPS_OWED', details: { amountToCall: 10 } }),
    fetchImplementation: async (_url, options) => {
      call += 1;
      requests.push(JSON.parse(options.body));
      if (call === 1) {
        return jsonResponse({
          speak: true,
          kind: 'action_result',
          utterance: 'DEALER FACTS: {"requested":"check"}',
          toolName: 'check',
          toolArgs: {},
        });
      }
      return jsonResponse({
        speak: true,
        kind: 'clarification',
        utterance: 'DEALER FACTS: {"rejected":true,"error":"CHIPS_OWED"}',
      });
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'check' });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].toolOutput.errorCode, 'CHIPS_OWED');
  assert.equal(requests[1].toolName, 'check');
  assert.equal(result.kind, 'clarification');
  assert.match(result.utterance, /CHIPS_OWED/);
});

test('speaks a state answer that needs no tool', async () => {
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => { throw new Error('no tool should run'); },
    fetchImplementation: async () => jsonResponse({
      speak: true,
      kind: 'answer',
      utterance: 'DEALER FACTS: {"pot":30}',
    }),
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'how big is the pot?' });

  assert.equal(result.kind, 'answer');
  assert.match(result.utterance, /"pot":30/);
});

test('ignores background speech', async () => {
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => { throw new Error('no tool should run'); },
    fetchImplementation: async () => jsonResponse({ speak: false, kind: 'ignored', utterance: '' }),
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'nice weather' });

  assert.equal(result.speak, false);
  assert.equal(result.kind, 'ignored');
});

test('asks the server for UI announcements', async () => {
  const requests = [];
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => {},
    fetchImplementation: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse({ speak: true, kind: 'announcement', utterance: 'DEALER FACTS: {"event":"game_started"}' });
    },
  });

  const result = await agent.run({ type: 'game_started', setup: { smallBlind: 5 }, dealInstruction: 'Deal two cards.' });

  assert.equal(requests[0].sourceEvent.type, 'game_started');
  assert.equal(result.kind, 'announcement');
  assert.match(result.utterance, /game_started/);
});

test('does not act when the game state changed during the decision', async () => {
  let state = snapshot();
  let toolExecutions = 0;
  const agent = new DealerAgent({
    getGameState: () => state,
    executeTool: async () => {
      toolExecutions += 1;
      return { ok: true };
    },
    fetchImplementation: async () => {
      state = snapshot({ currentPlayer: { name: 'Maya', chips: 100, amountToCall: 0 } });
      return jsonResponse({
        speak: true,
        kind: 'action_result',
        utterance: 'DEALER FACTS: {"requested":"call"}',
        toolName: 'call',
        toolArgs: {},
      });
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'call' });

  assert.equal(toolExecutions, 0);
  assert.equal(result.speak, false);
  assert.equal(result.timing.staleStateIgnored, true);
});

test('prepares the decision early but waits for the delegation before executing', async () => {
  let requestCount = 0;
  let releaseDecision;
  const decisionGate = new Promise((resolve) => { releaseDecision = resolve; });
  let toolExecutions = 0;
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => {
      toolExecutions += 1;
      return { ok: true };
    },
    fetchImplementation: async () => {
      requestCount += 1;
      await decisionGate;
      return jsonResponse({
        speak: true,
        kind: 'action_result',
        utterance: 'DEALER FACTS: {"requested":"check"}',
        toolName: 'check',
        toolArgs: {},
      });
    },
  });

  const sourceEvent = { type: 'voice_utterance', transcript: "I'll check" };
  const preparedTurn = agent.prepare(sourceEvent, []);
  assert.equal(requestCount, 1);
  assert.equal(toolExecutions, 0);
  releaseDecision();
  const result = await agent.run(sourceEvent, [], preparedTurn);

  assert.equal(requestCount, 1);
  assert.equal(toolExecutions, 1);
  assert.match(result.utterance, /"requested":"check"/);
  assert.ok(result.timing.speculativeLeadMs >= 0);
});

test('serializes turns so concurrent speech cannot race the state machine', async () => {
  const order = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let requestCount = 0;
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => {},
    fetchImplementation: async () => {
      requestCount += 1;
      const current = requestCount;
      order.push(`start-${current}`);
      if (current === 1) await firstBlocked;
      order.push(`end-${current}`);
      return jsonResponse({ speak: false, kind: 'ignored', utterance: '' });
    },
  });

  const first = agent.run({ type: 'voice_utterance', transcript: 'first' });
  const second = agent.run({ type: 'voice_utterance', transcript: 'second' });
  await Promise.resolve();
  assert.deepEqual(order, ['start-1']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});
