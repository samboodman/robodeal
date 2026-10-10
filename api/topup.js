import { apiError, readJsonBody, sendJson } from '../openai-api.js';
import { ensurePayerId, createTopupIntent } from '../payments.js';

const MIN_CENTS = 500;
const MAX_CENTS = 100000;

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST for a top-up.' });
    return;
  }
  try {
    const payerId = ensurePayerId(request, response);
    const body = await readJsonBody(request);
    const amountCents = Math.floor(Number(body.amountCents));
    if (!Number.isInteger(amountCents) || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
      sendJson(response, 400, { error: 'Amount must be between $5 and $1000.' });
      return;
    }
    const intent = await createTopupIntent(amountCents, payerId);
    sendJson(response, 200, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (error) {
    apiError(response, error, 'Top-up failed');
  }
}
