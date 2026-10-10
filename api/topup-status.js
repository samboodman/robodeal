import { apiError, readJsonBody, sendJson } from '../openai-api.js';
import { ensurePayerId, getBalanceCents, creditTopup, retrieveIntent } from '../payments.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST for a top-up status.' });
    return;
  }
  try {
    const payerId = ensurePayerId(request, response);
    const body = await readJsonBody(request);
    const id = String(body.paymentIntentId || '');
    if (!id) {
      sendJson(response, 400, { error: 'A paymentIntentId is required.' });
      return;
    }
    const intent = await retrieveIntent(id);
    if (intent.metadata?.payer_id !== payerId) {
      sendJson(response, 403, { error: 'That payment does not belong to this payer.' });
      return;
    }
    if (intent.status === 'succeeded') {
      const balanceCents = await creditTopup(payerId, intent.amount_received ?? intent.amount, `pi:${intent.id}`);
      sendJson(response, 200, { status: intent.status, balanceCents });
      return;
    }
    sendJson(response, 200, { status: intent.status, balanceCents: await getBalanceCents(payerId) });
  } catch (error) {
    apiError(response, error, 'Top-up status failed');
  }
}
