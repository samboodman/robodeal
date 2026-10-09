import { apiError, createDecisionsResponse, readJsonBody, sendJson } from '../openai-api.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST for a Decisions turn.' });
    return;
  }

  try {
    const result = await createDecisionsResponse(process.env.OPENAI_API_KEY, await readJsonBody(request));
    sendJson(response, 200, result);
  } catch (error) {
    apiError(response, error, 'Decisions turn failed');
  }
}
