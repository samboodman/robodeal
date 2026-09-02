import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchVoiceCommand,
  matchVoiceCommandViaApi,
  voiceCommandPriorities,
} from './voice-command-matcher.js';
import { handleWordsToNumberApi } from './word-to-number-handler.js';
import { wordsToNumber } from './word-to-number.js';

test('command priorities put all-in and raise above call', () => {
  assert.ok(
    voiceCommandPriorities.indexOf('allIn') <
      voiceCommandPriorities.indexOf('raise'),
  );
  assert.ok(
    voiceCommandPriorities.indexOf('raise') <
      voiceCommandPriorities.indexOf('call'),
  );
});

test('maps common call phrases without model thinking', () => {
  for (const phrase of [
    'call',
    "I'll call",
    "I'll see ya",
    "I'll match it",
    'match that',
  ]) {
    assert.deepEqual(matchVoiceCommand(phrase), { name: 'call', args: {} });
  }
});

test('call then raise is one raise for the current player', () => {
  assert.deepEqual(
    matchVoiceCommand("I'll call your 15 and raise you another 15"),
    {
      name: 'raise',
      args: { amount: 15 },
    },
  );
});

test('all-in outranks raise and call words', () => {
  assert.deepEqual(matchVoiceCommand("I'll call and raise all in"), {
    name: 'allIn',
    args: {},
  });
});

test('maps numeric and spoken wager amounts', () => {
  assert.deepEqual(matchVoiceCommand('bet twenty five'), {
    name: 'bet',
    args: { total: 25 },
  });
  assert.deepEqual(matchVoiceCommand('raise another $15'), {
    name: 'raise',
    args: { amount: 15 },
  });
});

test('falls back for ambiguous raises and unrelated speech', () => {
  assert.equal(matchVoiceCommand('raise'), null);
  assert.equal(matchVoiceCommand('raise to 30'), null);
  assert.equal(matchVoiceCommand('that movie raised awareness'), null);
});

test('maps only one command per utterance', () => {
  const command = matchVoiceCommand('check then call and raise another 10');
  assert.deepEqual(command, { name: 'raise', args: { amount: 10 } });
  assert.equal(Array.isArray(command), false);
});

test('word-to-number conversion handles poker-sized phrases', () => {
  assert.equal(wordsToNumber('twenty-five'), 25);
  assert.equal(wordsToNumber('one thousand two hundred and fifty'), 1250);
  assert.equal(wordsToNumber('no amount here'), null);
});

test('words-to-number API validates and converts requests', () => {
  const success = handleWordsToNumberApi({ words: 'another forty five' });
  assert.equal(success.status, 200);
  assert.deepEqual(JSON.parse(success.body), { number: 45 });
  assert.equal(handleWordsToNumberApi({ words: 'nothing' }).status, 422);
  assert.equal(handleWordsToNumberApi({}).status, 400);
});

test('spoken wager amounts use the first-party API', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ number: 75 }), { status: 200 });
  };
  assert.deepEqual(
    await matchVoiceCommandViaApi('raise another seventy five', fetchImpl),
    {
      name: 'raise',
      args: { amount: 75 },
    },
  );
  assert.deepEqual(requests, [
    {
      url: '/api/words-to-number',
      body: { words: 'another seventy five' },
    },
  ]);
});

test('word amount API failures fall back to local conversion', async () => {
  const fetchImpl = async () => {
    throw new Error('offline');
  };
  assert.deepEqual(await matchVoiceCommandViaApi('bet thirty', fetchImpl), {
    name: 'bet',
    args: { total: 30 },
  });
});
