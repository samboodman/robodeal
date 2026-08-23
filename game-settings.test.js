import assert from 'node:assert/strict';
import test from 'node:test';
import { restoredPlayerName } from './game-settings.js';

test('restores generated player names as blank setup fields', () => {
  assert.equal(restoredPlayerName('Player 1', 1), '');
  assert.equal(restoredPlayerName('player 2', 2), '');
  assert.equal(restoredPlayerName(' Player 3 ', 3), '');
});

test('preserves names the user actually entered', () => {
  assert.equal(restoredPlayerName('Sam', 1), 'Sam');
  assert.equal(restoredPlayerName('Player One', 1), 'Player One');
  assert.equal(restoredPlayerName(undefined, 2), '');
});
