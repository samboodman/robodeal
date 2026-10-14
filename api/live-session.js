import { randomUUID } from 'node:crypto';
import { apiError, createLiveSession, readJsonBody, sendJson } from '../openai-api.js';
import { creditTopup, debitIfAvailable, ensurePayerId, LIVE_SESSION_START_CENTS } from '../payments.js';
import { enforceRateLimit } from '../rate-limit.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to create a GPT-Live session.' });
    return;
  }

  try {
    const payerId = ensurePayerId(request, response);
    if (!enforceRateLimit(request, response, { name: 'live-session', limit: 6, windowMs: 60_000, subject: payerId })) return;
    const ref = `live-start:${randomUUID()}`;
    const charge = await debitIfAvailable(payerId, LIVE_SESSION_START_CENTS, { reason: 'live_session_start', ref });
    if (!charge.debited) {
      sendJson(response, 402, { error: 'Your balance is too low to start GPT-Live.', balanceCents: charge.balanceCents });
      return;
    }
    let result;
    try {
      result = await createLiveSession(process.env.OPENAI_API_KEY, await readJsonBody(request));
    } catch (error) {
      await creditTopup(payerId, LIVE_SESSION_START_CENTS, `refund:${ref}`, 'live_session_refund');
      throw error;
    }
    sendJson(response, 201, result);
  } catch (error) {
    apiError(response, error, 'GPT-Live session creation failed');
  }
}
