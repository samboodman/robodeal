import { wordsToNumber } from './word-to-number.js';

export const voiceCommandPriorities = Object.freeze([
  'cancelAction',
  'confirmAction',
  'undo',
  'nextHand',
  'cardsDealt',
  'allIn',
  'raise',
  'bet',
  'fold',
  'call',
  'check',
]);

function normalizeTranscript(transcript) {
  return String(transcript || '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9.$\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amountFrom(text) {
  return wordsToNumber(text);
}

function raisedAmount(text) {
  const raiseMatch = text.match(/\b(?:raise|reraise|re raise|bump)\b/);
  if (!raiseMatch) {return null;}
  const afterRaise = text.slice(raiseMatch.index + raiseMatch[0].length).trim();
  if (/^(?:it\s+)?to\b/.test(afterRaise)) {return null;}
  const amount = amountFrom(afterRaise);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function betTotal(text) {
  const betMatch = text.match(/\b(?:bet|wager)\b/);
  if (!betMatch) {return null;}
  const amount = amountFrom(text.slice(betMatch.index + betMatch[0].length).trim());
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Returns one high-confidence poker command, or null so the model can decide. */
export function matchVoiceCommand(transcript) {
  const text = normalizeTranscript(transcript);
  if (!text) {return null;}

  if (/\b(?:cancel|never mind|never mind that|don t do it)\b/.test(text) || /^(?:no|nope)$/.test(text)) {
    return { name: 'cancelAction', args: {} };
  }
  if (/\b(?:confirm|yes do it|go ahead|do it)\b/.test(text) || /^(?:yes|yeah|yep)$/.test(text)) {
    return { name: 'confirmAction', args: {} };
  }
  if (/\b(?:undo|take that back|revert that)\b/.test(text)) {
    return { name: 'undo', args: {} };
  }
  if (/\b(?:next hand|new hand|deal again)\b/.test(text)) {
    return { name: 'nextHand', args: {} };
  }
  if (/\b(?:cards are dealt|cards dealt|finished dealing|done dealing)\b/.test(text)) {
    return { name: 'cardsDealt', args: {} };
  }
  if (/\b(?:all in|shove|shove it|jam|jam it|send it|whole stack|everything i have)\b/.test(text)) {
    return { name: 'allIn', args: {} };
  }

  const raiseAmount = raisedAmount(text);
  if (raiseAmount !== null) {return { name: 'raise', args: { amount: raiseAmount } };}

  const total = betTotal(text);
  if (total !== null) {return { name: 'bet', args: { total } };}

  if (/\b(?:fold|muck|muck them|chuck them|chuck em)\b/.test(text) || /\bi (?:am|m) out\b/.test(text)) {
    return { name: 'fold', args: {} };
  }
  if (
    /\bcall\b/.test(text)
    || /\bmatch (?:it|that|the bet|your bet|\$?\d+)\b/.test(text)
    || /\b(?:i |i ll |i will )?see (?:you|ya|your bet|that|it)\b/.test(text)
  ) {
    return { name: 'call', args: {} };
  }
  if (/\bcheck\b/.test(text) || /\bi (?:am|m) good\b/.test(text) || /\b(?:tap|tap the table)\b/.test(text)) {
    return { name: 'check', args: {} };
  }

  return null;
}

/** Uses the first-party API for spoken wager amounts, with local matching as a fallback. */
export async function matchVoiceCommandViaApi(transcript, fetchImpl = globalThis.fetch) {
  const directCommand = matchVoiceCommand(transcript);
  if (!directCommand || !['raise', 'bet'].includes(directCommand.name)) {return directCommand;}

  const text = normalizeTranscript(transcript);
  const actionMatch = text.match(directCommand.name === 'raise'
    ? /\b(?:raise|reraise|re raise|bump)\b/
    : /\b(?:bet|wager)\b/);
  const amountText = actionMatch
    ? text.slice(actionMatch.index + actionMatch[0].length).trim()
    : '';
  if (!amountText || /(?:^|\s)\$?\d/.test(amountText) || typeof fetchImpl !== 'function') {
    return directCommand;
  }

  try {
    const response = await fetchImpl('/api/words-to-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: amountText }),
    });
    if (!response.ok) {return directCommand;}
    const result = await response.json();
    if (!Number.isFinite(result.number) || result.number <= 0) {return directCommand;}
    return directCommand.name === 'raise'
      ? { name: 'raise', args: { amount: result.number } }
      : { name: 'bet', args: { total: result.number } };
  } catch {
    return directCommand;
  }
}
