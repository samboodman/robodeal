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

test('classifies a voice utterance with the Decisions API and applies the move', async () => {
  const requests = [];
  const toolCalls = [];
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    instructions: 'classify the move',
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, action: { type: 'call', actor: { name: 'Sam' }, chipsMoved: 5 }, stateAfter: snapshot({ pot: 35 }) };
    },
    fetchImplementation: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ answers: [{ type: 'choice', name: 'action', choice: 'call' }] });
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'I call' });

  assert.equal(requests[0].url, '/api/decisions');
  assert.match(requests[0].body.input, /classify the move/);
  assert.match(requests[0].body.input, /I call/);
  assert.ok(requests[0].body.questions.some((question) => question.name === 'action'));
  assert.deepEqual(toolCalls, [{ name: 'call', args: {} }]);
  assert.equal(result.speak, true);
  assert.equal(result.kind, 'action_result');
  assert.match(result.utterance, /DEALER FACTS:/);
  assert.match(result.utterance, /"requested":"call"/);
  assert.ok(result.timing.decisionsMs >= 0);
  assert.ok(result.timing.javascriptMs >= 0);
});

test('reconstructs digit amounts and maps raise-to to a total bet', async () => {
  const toolCalls = [];
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, action: { type: 'bet' }, stateAfter: snapshot() };
    },
    fetchImplementation: async () => jsonResponse({
      answers: [
        { type: 'choice', name: 'action', choice: 'raise' },
        { type: 'choice', name: 'raise_target', choice: 'raiseTo' },
        { type: 'choice', name: 'amount_digit_1', choice: '5' },
        { type: 'choice', name: 'amount_digit_10', choice: '0' },
        { type: 'choice', name: 'amount_digit_100', choice: '3' },
      ],
    }),
  });

  await agent.run({ type: 'voice_utterance', transcript: 'raise to 305' });

  assert.deepEqual(toolCalls, [{ name: 'bet', args: { total: 305 } }]);
});

test('maps raise-by to the raise-above-call tool', async () => {
  const toolCalls = [];
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, action: { type: 'raise' }, stateAfter: snapshot() };
    },
    fetchImplementation: async () => jsonResponse({
      answers: [
        { type: 'choice', name: 'action', choice: 'raise' },
        { type: 'choice', name: 'raise_target', choice: 'raiseBy' },
        { type: 'choice', name: 'amount_digit_1', choice: '5' },
        { type: 'choice', name: 'amount_digit_10', choice: '0' },
        { type: 'choice', name: 'amount_digit_100', choice: '3' },
      ],
    }),
  });

  await agent.run({ type: 'voice_utterance', transcript: 'raise 305' });

  assert.deepEqual(toolCalls, [{ name: 'raise', args: { amount: 305 } }]);
});

test('maps a next-hand choice to the nextHand tool', async () => {
  const toolCalls = [];
  const agent = new DealerAgent({
    getGameState: () => snapshot({ phase: 'HAND_COMPLETE', availableActions: [{ type: 'START_NEXT_HAND' }] }),
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, action: { type: 'next_hand' }, stateAfter: snapshot({ dealInstruction: 'Deal two cards.' }) };
    },
    fetchImplementation: async () => jsonResponse({ answers: [{ type: 'choice', name: 'action', choice: 'nextHand' }] }),
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'next hand' });

  assert.deepEqual(toolCalls, [{ name: 'nextHand', args: {} }]);
  assert.match(result.utterance, /Deal two cards\./);
});

test('answers a state question with a second bundled yes/no request', async () => {
  const responses = [
    { answers: [{ type: 'choice', name: 'action', choice: 'narrateValues' }] },
    { answers: [
      { type: 'choice', name: 'value_pot', choice: 'yes' },
      { type: 'choice', name: 'value_current_player', choice: 'no' },
    ] },
  ];
  let calls = 0;
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => { throw new Error('no action should run for a question'); },
    fetchImplementation: async () => {
      calls += 1;
      return jsonResponse(responses.shift());
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'how big is the pot?' });

  assert.equal(calls, 2);
  assert.equal(result.kind, 'answer');
  assert.match(result.utterance, /"pot":30/);
  assert.doesNotMatch(result.utterance, /current_player/);
});

test('ignores background speech with no matching action', async () => {
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => { throw new Error('no action should run'); },
    fetchImplementation: async () => jsonResponse({ answers: [{ type: 'choice', name: 'action', choice: 'nothing' }] }),
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'nice weather today' });

  assert.equal(result.speak, false);
  assert.equal(result.kind, 'ignored');
});

test('announces UI events as facts without calling Decisions', async () => {
  let calls = 0;
  const agent = new DealerAgent({
    getGameState: () => snapshot(),
    executeTool: async () => {},
    fetchImplementation: async () => { calls += 1; return jsonResponse({}); },
  });

  const result = await agent.run({ type: 'game_started', setup: { smallBlind: 5 }, dealInstruction: 'Deal two cards.' });

  assert.equal(calls, 0);
  assert.equal(result.kind, 'announcement');
  assert.match(result.utterance, /game_started/);
  assert.match(result.utterance, /Deal two cards\./);
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
      return jsonResponse({ answers: [{ type: 'choice', name: 'action', choice: 'call' }] });
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
      return { ok: true, action: { type: 'check', actor: { name: 'Sam' } }, stateAfter: snapshot() };
    },
    fetchImplementation: async () => {
      requestCount += 1;
      await decisionGate;
      return jsonResponse({ answers: [{ type: 'choice', name: 'action', choice: 'check' }] });
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
      return jsonResponse({ answers: [{ type: 'choice', name: 'action', choice: 'nothing' }] });
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
