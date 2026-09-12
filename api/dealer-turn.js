import { apiError, createDealerResponse, readJsonBody, sendJson } from '../openai-api.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST for a Terra dealer turn.' });
    return;
  }

  try {
    const result = await createDealerResponse(process.env.OPENAI_API_KEY, await readJsonBody(request));
    sendJson(response, 200, result);
  } catch (error) {
    apiError(response, error, 'Terra dealer turn failed');
  }
}
