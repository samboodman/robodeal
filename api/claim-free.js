import { apiError, readJsonBody, sendJson } from '../openai-api.js';
import { ensurePayerId, claimFreeGrant } from '../payments.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to claim.' });
    return;
  }
  try {
    const payerId = ensurePayerId(request, response);
    const body = await readJsonBody(request);
    const setupIntentId = String(body.setupIntentId || '');
    if (!setupIntentId) {
      sendJson(response, 400, { error: 'A setupIntentId is required.' });
      return;
    }
    sendJson(response, 200, await claimFreeGrant(payerId, setupIntentId));
  } catch (error) {
    apiError(response, error, 'Claim failed');
  }
}
