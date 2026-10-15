import { apiError, createSpeech, readJsonBody } from '../openai-api.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: 'Use POST to render speech.' }));
    return;
  }

  try {
    const speech = await createSpeech(process.env.OPENAI_API_KEY, await readJsonBody(request));
    response.statusCode = 200;
    response.setHeader('Content-Type', speech.contentType);
    response.setHeader('Cache-Control', 'no-store');
    response.end(speech.audio);
  } catch (error) {
    apiError(response, error, 'Speech rendering failed');
  }
}
