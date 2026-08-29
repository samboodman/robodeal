import { handleVoiceApi } from '../voice-api-handler.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Use POST for voice requests.' });
    return;
  }

  try {
    const result = await handleVoiceApi(request.body || {}, process.env.OPENAI_API_KEY);
    response.status(result.status);
    response.setHeader('Content-Type', result.contentType);
    response.send(result.body);
  } catch (error) {
    console.error('Voice request failed:', error);
    response.status(500).json({ error: 'The voice server failed.' });
  }
}
