import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVoiceCommand } from './voice-command.js';

const snapshot = {
  currentPlayerNumber: 3,
  currentPlayer: {
    name: 'Player 3',
    chips: 250,
    roundBet: 0,
    amountToCall: 5,
  },
};

test('recognizes call and check without letting the model choose the action', () => {
  assert.deepEqual(classifyVoiceCommand('Call', snapshot), { type: 'action', name: 'call', args: {} });
  assert.deepEqual(classifyVoiceCommand('Check', snapshot), { type: 'action', name: 'check', args: {} });
});

test('turns raises into the call amount plus the requested raise', () => {
  assert.equal(classifyVoiceCommand('Raise 5', snapshot).args.amount, 10);
  assert.equal(classifyVoiceCommand('Raise ten', snapshot).args.amount, 15);
  assert.equal(classifyVoiceCommand('Raise fifteen', snapshot).args.amount, 20);
});

test('requires confirmation for every recognized fold phrase', () => {
  for (const phrase of ['Fold', 'I want to fold', "Too rich for me, I'm out"]) {
    assert.deepEqual(classifyVoiceCommand(phrase, snapshot), { type: 'request-fold', playerNumber: 3 });
  }
  assert.deepEqual(classifyVoiceCommand('Yes, I fold', snapshot, 3), { type: 'confirm-fold', playerNumber: 3 });
});

test('recognizes all-in and conversational numeric bets', () => {
  assert.deepEqual(classifyVoiceCommand("I'M ALL IN", snapshot), { type: 'action', name: 'allIn', args: {} });
  assert.equal(classifyVoiceCommand("Screw it, I'm in 50", snapshot).args.amount, 50);
});

test('recognizes confirmation that physical cards were dealt', () => {
  assert.deepEqual(classifyVoiceCommand('Cards are dealt', snapshot), { type: 'action', name: 'cardsDealt', args: {} });
});

test('asks for an amount when a player only says they are in', () => {
  assert.deepEqual(classifyVoiceCommand("Screw it, I'm in", snapshot), { type: 'clarify-bet' });
});

test('never treats a bare misheard number as a game action', () => {
  assert.equal(classifyVoiceCommand('two', snapshot), null);
});
