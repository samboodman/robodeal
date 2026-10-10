import { apiError, readJsonBody, sendJson } from '../openai-api.js';
import { runDealerTurn } from '../dealer-brain.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST for a dealer turn.' });
    return;
  }

  try {
    const result = await runDealerTurn(process.env.OPENAI_API_KEY, await readJsonBody(request));
    sendJson(response, 200, result);
  } catch (error) {
    apiError(response, error, 'Dealer turn failed');
  }
}
