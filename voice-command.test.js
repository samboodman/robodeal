import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyVoiceCommand } from './voice-command.js';

test('forces clear raises through the betting tool', () => {
  assert.deepEqual(classifyVoiceCommand('I raise 5'), {
    type: 'action',
    toolName: 'betCurrentPlayer',
    wagerKind: 'raise',
    isAmountAnswer: false,
  });
});

test('asks for a missing raise amount', () => {
  assert.deepEqual(classifyVoiceCommand('raise'), {
    type: 'clarification',
    wagerKind: 'raise',
  });
});

test('accepts a number as the answer to its amount question', () => {
  assert.deepEqual(classifyVoiceCommand('five', 'raise'), {
    type: 'action',
    toolName: 'betCurrentPlayer',
    wagerKind: 'raise',
    isAmountAnswer: true,
  });
});

test('does not mistake a poker question for an action', () => {
  assert.equal(classifyVoiceCommand('What is the minimum bet?'), null);
  assert.equal(classifyVoiceCommand('Can I raise five?'), null);
});

test('maps unambiguous actions to their exact tools', () => {
  assert.equal(classifyVoiceCommand('call').toolName, 'callCurrentPlayer');
  assert.equal(classifyVoiceCommand('please check').toolName, 'checkCurrentPlayer');
  assert.equal(classifyVoiceCommand('I fold').toolName, 'foldCurrentPlayer');
  assert.equal(classifyVoiceCommand('go all in').toolName, 'goAllIn');
});
