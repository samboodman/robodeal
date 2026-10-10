import { apiError, readJsonBody, sendJson } from '../openai-api.js';
import { ensurePayerId, debitBalance } from '../payments.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to debit usage.' });
    return;
  }
  try {
    const payerId = ensurePayerId(request, response);
    const body = await readJsonBody(request);
    const cents = Math.max(0, Math.floor(Number(body.cents) || 0));
    sendJson(response, 200, { balanceCents: await debitBalance(payerId, cents) });
  } catch (error) {
    apiError(response, error, 'Debit failed');
  }
}
