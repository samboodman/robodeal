import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePots, hasBettingRoundFinished } from './pot-logic.js';

function player(number, handContribution, { folded = false, eliminated = false } = {}) {
  return { number, handContribution, folded, eliminated };
}

test('creates the correct main pot and one side pot', () => {
  assert.deepEqual(calculatePots([
    player(1, 15),
    player(2, 20),
    player(3, 20),
  ]), [
    { amount: 45, contributionCap: 15, eligiblePlayerNumbers: [1, 2, 3] },
    { amount: 10, contributionCap: 20, eligiblePlayerNumbers: [2, 3] },
  ]);
});

test('creates an arbitrary number of side-pot layers', () => {
  assert.deepEqual(calculatePots([
    player(1, 5),
    player(2, 10),
    player(3, 15),
    player(4, 20),
  ]), [
    { amount: 20, contributionCap: 5, eligiblePlayerNumbers: [1, 2, 3, 4] },
    { amount: 15, contributionCap: 10, eligiblePlayerNumbers: [2, 3, 4] },
    { amount: 10, contributionCap: 15, eligiblePlayerNumbers: [3, 4] },
    { amount: 5, contributionCap: 20, eligiblePlayerNumbers: [4] },
  ]);
});

test('counts folded chips but removes the folded player from eligibility', () => {
  assert.deepEqual(calculatePots([
    player(1, 5, { folded: true }),
    player(2, 15),
    player(3, 20),
    player(4, 20),
  ]), [
    { amount: 50, contributionCap: 15, eligiblePlayerNumbers: [2, 3, 4] },
    { amount: 10, contributionCap: 20, eligiblePlayerNumbers: [3, 4] },
  ]);
});

test('preserves every chip across all distinct contribution levels', () => {
  const players = Array.from({ length: 8 }, (_, index) => player(index + 1, index + 1));
  const pots = calculatePots(players);

  assert.equal(pots.length, 8);
  assert.equal(pots.reduce((total, potLayer) => total + potLayer.amount, 0), 36);
});

test('finishes a betting round when every remaining player is all-in', () => {
  assert.equal(hasBettingRoundFinished([
    { chips: 0, folded: false, eliminated: false, hasActedThisRound: true, roundBet: 5 },
    { chips: 0, folded: false, eliminated: false, hasActedThisRound: true, roundBet: 10 },
  ], 10), true);
});

test('does not finish while the sole player with chips still owes a call', () => {
  assert.equal(hasBettingRoundFinished([
    { chips: 5, folded: false, eliminated: false, hasActedThisRound: true, roundBet: 10 },
    { chips: 0, folded: false, eliminated: false, hasActedThisRound: true, roundBet: 15 },
  ], 15), false);
});
