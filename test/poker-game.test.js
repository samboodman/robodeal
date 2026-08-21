import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createGame, getAvailableActions, isBettingRoundComplete, startHand } from '../poker-game.js';

function threePlayerGame({ chips = 250, useBigBlinds = false } = {}) {
  return startHand(createGame({
    players: [
      { number: 1, name: 'Dad', chips },
      { number: 2, name: 'Abby', chips },
      { number: 3, name: 'Sam', chips },
    ],
    dealerNumber: 1,
    ante: 5,
    useBigBlinds,
  }));
}

function dealHoleCards(state) {
  return applyAction(state, { type: 'cards-dealt' });
}

test('starting a hand posts the blind and starts action to its left', () => {
  const state = dealHoleCards(threePlayerGame());

  assert.equal(state.antePlayerNumber, 2);
  assert.equal(state.bigBlindPlayerNumber, null);
  assert.equal(state.players[1].chips, 245);
  assert.equal(state.players[1].roundBet, 5);
  assert.equal(state.currentPlayerNumber, 3);
  assert.deepEqual(getAvailableActions(state), [
    { type: 'fold' },
    { type: 'all-in', amount: 250 },
    { type: 'call', amount: 5 },
    { type: 'bet', min: 5, max: 250 },
  ]);
});

test('a normal raise still requires the blind to match before the round ends', () => {
  let state = dealHoleCards(threePlayerGame());
  state = applyAction(state, { type: 'bet', playerNumber: 3, amount: 100 });
  state = applyAction(state, { type: 'call', playerNumber: 1 });

  assert.equal(state.phase, 'betting');
  assert.equal(state.currentPlayerNumber, 2);
  assert.equal(isBettingRoundComplete(state), false);
  assert.deepEqual(getAvailableActions(state).find((action) => action.type === 'call'), { type: 'call', amount: 95 });
});

test('two all-ins still require the player with chips to match the bet', () => {
  let state = dealHoleCards(threePlayerGame());
  state = applyAction(state, { type: 'all-in', playerNumber: 3 });
  state = applyAction(state, { type: 'all-in', playerNumber: 1 });

  assert.equal(state.phase, 'betting');
  assert.equal(state.currentPlayerNumber, 2);
  assert.equal(state.players[1].roundBet, 5);
  assert.equal(isBettingRoundComplete(state), false);
  assert.deepEqual(getAvailableActions(state).find((action) => action.type === 'call'), { type: 'call', amount: 245 });
});

test('the round advances only after the remaining player matches the all-in', () => {
  let state = dealHoleCards(threePlayerGame());
  state = applyAction(state, { type: 'all-in', playerNumber: 3 });
  state = applyAction(state, { type: 'all-in', playerNumber: 1 });
  state = applyAction(state, { type: 'call', playerNumber: 2 });

  assert.equal(state.phase, 'awaiting-community-cards');
  assert.equal(state.currentPlayerNumber, null);
  assert.equal(state.pot, 750);
});

test('checking into a bet is rejected and a short stack may call all-in', () => {
  let state = dealHoleCards(threePlayerGame({ chips: 50 }));
  state = applyAction(state, { type: 'bet', playerNumber: 3, amount: 50 });

  assert.throws(() => applyAction(state, { type: 'check', playerNumber: 1 }), /Cannot check/);
  state = applyAction(state, { type: 'call', playerNumber: 1 });
  assert.equal(state.players[0].chips, 0);
  assert.equal(state.players[0].roundBet, 50);
});

test('big blind configuration posts both blinds and starts action to the big blind’s left', () => {
  const state = dealHoleCards(threePlayerGame({ useBigBlinds: true }));

  assert.equal(state.antePlayerNumber, 2);
  assert.equal(state.bigBlindPlayerNumber, 3);
  assert.equal(state.players[1].roundBet, 5);
  assert.equal(state.players[2].roundBet, 10);
  assert.equal(state.currentPlayerNumber, 1);
});
