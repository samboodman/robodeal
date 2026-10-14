import { apiError, sendJson } from '../openai-api.js';
import { ensurePayerId, createCardSetupIntent } from '../payments.js';
import { enforceRateLimit } from '../rate-limit.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to save a card.' });
    return;
  }
  try {
    const payerId = ensurePayerId(request, response);
    if (!enforceRateLimit(request, response, { name: 'save-card', limit: 3, windowMs: 10 * 60_000, subject: payerId })) return;
    const intent = await createCardSetupIntent(payerId);
    sendJson(response, 200, { clientSecret: intent.client_secret, setupIntentId: intent.id });
  } catch (error) {
    apiError(response, error, 'Card setup failed');
  }
}
