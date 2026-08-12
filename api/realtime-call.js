// This code runs on Vercel's server, not in the phone's browser.
// That keeps the OpenAI API key private.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Use POST for a Realtime call.' });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(500).json({ error: 'The server is missing OPENAI_API_KEY.' });
    return;
  }

  const sdp = request.body?.sdp;
  if (typeof sdp !== 'string' || sdp.length === 0) {
    response.status(400).json({ error: 'A WebRTC offer is required.' });
    return;
  }

  const form = new FormData();
  form.append('sdp', new Blob([sdp], { type: 'application/sdp' }), 'offer.sdp');
  form.append(
    'session',
    new Blob([JSON.stringify({ type: 'realtime', model: 'gpt-realtime' })], { type: 'application/json' }),
    'session.json',
  );

  const openAIResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const answer = await openAIResponse.text();

  if (!openAIResponse.ok) {
    console.error('OpenAI Realtime call failed:', openAIResponse.status, answer);
  }

  response.status(openAIResponse.status);
  response.setHeader('Content-Type', openAIResponse.headers.get('content-type') || 'text/plain');
  response.send(answer);
}
