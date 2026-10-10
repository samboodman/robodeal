import { apiError, sendJson } from '../openai-api.js';
import { ensurePayerId, getBalanceCents } from '../payments.js';

export default async function handler(request, response) {
  try {
    const payerId = ensurePayerId(request, response);
    const balanceCents = await getBalanceCents(payerId);
    sendJson(response, 200, { balanceCents });
  } catch (error) {
    apiError(response, error, 'Balance lookup failed');
  }
}
