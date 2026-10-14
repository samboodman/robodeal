import { randomUUID } from 'node:crypto';
import { apiError, readJsonBody, sendJson } from '../openai-api.js';
import { runDealerTurn } from '../dealer-brain.js';
import { creditTopup, DEALER_TURN_CENTS, debitIfAvailable, ensurePayerId } from '../payments.js';
import { enforceRateLimit } from '../rate-limit.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST for a dealer turn.' });
    return;
  }

  try {
    const payerId = ensurePayerId(request, response);
    if (!enforceRateLimit(request, response, { name: 'dealer', limit: 30, windowMs: 60_000, subject: payerId })) return;
    const payload = await readJsonBody(request);
    // Setup and state-transition narration is generated locally; only a voice
    // utterance invokes the billed Decisions API.
    const needsDecision = !payload?.toolOutput
      && (!payload?.sourceEvent || payload.sourceEvent.type === 'voice_utterance');
    if (!needsDecision) {
      sendJson(response, 200, await runDealerTurn(process.env.OPENAI_API_KEY, payload));
      return;
    }
    const ref = `dealer:${randomUUID()}`;
    const charge = await debitIfAvailable(payerId, DEALER_TURN_CENTS, { reason: 'dealer_turn', ref });
    if (!charge.debited) {
      sendJson(response, 402, { error: 'Your balance is too low to use the dealer.', balanceCents: charge.balanceCents });
      return;
    }
    let result;
    try {
      result = await runDealerTurn(process.env.OPENAI_API_KEY, payload);
    } catch (error) {
      await creditTopup(payerId, DEALER_TURN_CENTS, `refund:${ref}`, 'dealer_refund');
      throw error;
    }
    sendJson(response, 200, result);
  } catch (error) {
    apiError(response, error, 'Dealer turn failed');
  }
}
