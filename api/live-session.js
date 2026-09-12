import { apiError, createLiveSession, readJsonBody, sendJson } from '../openai-api.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to create a GPT-Live session.' });
    return;
  }

  try {
    const result = await createLiveSession(process.env.OPENAI_API_KEY, await readJsonBody(request));
    sendJson(response, 201, result);
  } catch (error) {
    apiError(response, error, 'GPT-Live session creation failed');
  }
}
