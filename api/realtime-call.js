// Creates the Realtime WebRTC call on the server so the API key never reaches the browser.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Use POST for a Realtime call.' });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(500).json({ error: 'The server is missing OPENAI_API_KEY.' });
    return;
  }
  if (typeof request.body?.sdp !== 'string' || request.body.sdp.length === 0) {
    response.status(400).json({ error: 'A WebRTC offer is required.' });
    return;
  }

  const form = new FormData();
  form.append('sdp', request.body.sdp);
  form.append('session', JSON.stringify({ type: 'realtime', model: 'gpt-realtime-2.1-mini' }));
  const openAIResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const answer = await openAIResponse.text();
  response.status(openAIResponse.status);
  response.setHeader('Content-Type', openAIResponse.headers.get('content-type') || 'text/plain');
  response.send(answer);
}
