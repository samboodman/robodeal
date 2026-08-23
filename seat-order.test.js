import assert from 'node:assert/strict';
import test from 'node:test';
import { clockwisePlayerIds, normalizeSeatAngle, snapSeatAngle } from './seat-order.js';

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

test('snaps seats to the regular shape for the player count', () => {
  const triangleStep = Math.PI * 2 / 3;
  const squareStep = Math.PI / 2;

  assert.equal(snapSeatAngle(Math.PI / 2 + triangleStep * 1.05, 3), Math.PI / 2 + triangleStep);
  assert.equal(snapSeatAngle(Math.PI / 2 + squareStep * 2.2, 4), Math.PI / 2 + squareStep * 2);
});

test('every player count can snap to the four square angles', () => {
  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    assert.equal(snapSeatAngle(0.04, playerCount), 0);
    assert.equal(snapSeatAngle(Math.PI + 0.04, playerCount), Math.PI);
  }
});

test('leaves a seat free when it is outside the magnetic snap distance', () => {
  const requestedAngle = 0.3;
  const tenDegrees = Math.PI / 18;

  assert.equal(snapSeatAngle(requestedAngle, 3, Math.PI / 2, tenDegrees), requestedAngle);
  assert.equal(snapSeatAngle(0.05, 3, Math.PI / 2, tenDegrees), 0);
});
