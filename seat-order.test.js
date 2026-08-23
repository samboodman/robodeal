import assert from 'node:assert/strict';
import test from 'node:test';
import { clockwisePlayerIds, normalizeSeatAngle } from './seat-order.js';

test('normalizes dragged seat angles around the table', () => {
  assert.equal(normalizeSeatAngle(0), 0);
  assert.equal(normalizeSeatAngle(Math.PI * 2), 0);
  assert.equal(normalizeSeatAngle(-Math.PI / 2), Math.PI * 1.5);
});

test('uses physical clockwise positions instead of player numbers', () => {
  const players = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const seatAngles = { 1: 0.1, 3: 1.5, 2: 4.2 };

  assert.deepEqual(clockwisePlayerIds(players, seatAngles), [1, 3, 2]);
});
