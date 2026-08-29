import { createRealtimeTranscriptionClientSecret } from '../realtime-transcription.js';

// Mints a short-lived transcription key so the standard API key never reaches the browser.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Use POST for a Realtime call.' });
    return;
  }
  const result = await createRealtimeTranscriptionClientSecret(process.env.OPENAI_API_KEY);
  response.status(result.status);
  response.setHeader('Content-Type', result.contentType);
  response.send(result.body);
}
