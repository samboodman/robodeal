import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePhh } from './phh-state-machine-validator.js';

const validNoLimit = `
variant = "NT"
antes = [0, 0, 0]
blinds_or_straddles = [5, 10, 0]
min_bet = 10
starting_stacks = [100, 100, 100]
actions = [
  "d dh p1 ????",
  "d dh p2 ????",
  "d dh p3 ????",
  "p3 cbr 30",
  "p1 f",
  "p2 cc",
  "d db Ac2d3h",
  "p2 cc",
  "p3 cc",
  "d db 4s",
  "p2 cc",
  "p3 cc",
  "d db 5c",
  "p2 cc",
  "p3 cc",
  "p2 sm -",
  "p3 sm -"
]
`;

test('replays a supported PHH no-limit Hold’em hand through the state machine', () => {
  const result = validatePhh(validNoLimit);
  assert.equal(result.status, 'valid');
  assert.equal(result.finalPhase, 'SHOWDOWN');
  assert.equal(result.errors.length, 0);
});

test('reports the exact PHH action rejected by the state machine', () => {
  const result = validatePhh(validNoLimit.replace('"p3 cbr 30"', '"p1 cbr 30"'));
  assert.equal(result.status, 'invalid');
  assert.equal(result.errors[0].action, 'p1 cbr 30');
  assert.match(result.errors[0].message, /not that player/);
});

test('reports a variant or structure RoboDeal cannot model as unsupported', () => {
  const shortDeck = validatePhh(validNoLimit.replace('variant = "NT"', 'variant = "NS"'));
  assert.equal(shortDeck.status, 'unsupported');
  const straddle = validatePhh(validNoLimit.replace('[5, 10, 0]', '[5, 10, 20]'));
  assert.equal(straddle.status, 'unsupported');
});

test('replays a PHH big-blind ante encoded with the big blind payment', () => {
  const bigBlindAnte = validNoLimit
    .replace('antes = [0, 0, 0]', 'antes = [0, 15, 0]')
    .replace('blinds_or_straddles = [5, 10, 0]', 'blinds_or_straddles = [5, 10, 0]');
  const result = validatePhh(bigBlindAnte);
  assert.equal(result.status, 'valid');
});
