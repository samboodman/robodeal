import { handleVoiceApi } from '../voice-api-handler.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Use POST for voice requests.' });
    return;
  }

  try {
    const result = await handleVoiceApi(
      request.body || {},
      process.env.OPENAI_API_KEY,
    );
    response.status(result.status);
    response.setHeader('Content-Type', result.contentType);
    if (result.body?.getReader) {
      response.flushHeaders?.();
      const reader = result.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        response.write(Buffer.from(value));
      }
      response.end();
      return;
    }
    response.send(
      result.body instanceof Uint8Array
        ? Buffer.from(result.body)
        : result.body,
    );
  } catch (error) {
    console.error('Voice request failed:', error);
    response.status(500).json({ error: 'The voice server failed.' });
  }
}
