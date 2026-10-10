import { apiError, sendJson } from '../openai-api.js';
import { ensurePayerId, createCardSetupIntent } from '../payments.js';

export default async function handler(request, response) {
  try {
    const payerId = ensurePayerId(request, response);
    const intent = await createCardSetupIntent(payerId);
    sendJson(response, 200, { clientSecret: intent.client_secret, setupIntentId: intent.id });
  } catch (error) {
    apiError(response, error, 'Card setup failed');
  }
}
