const supportedVoices = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'cedar',
]);

function errorResult(status, message) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ error: message }),
  };
}

async function openAIError(response) {
  const body = await response.json().catch(() => ({}));
  return (
    body.error?.message ||
    `OpenAI request failed with status ${response.status}.`
  );
}

export async function handleVoiceApi(body, apiKey) {
  if (!apiKey) {
    return errorResult(500, 'The server is missing OPENAI_API_KEY.');
  }

  if (body.action === 'transcribe') {
    if (typeof body.audio !== 'string' || body.audio.length === 0) {
      return errorResult(400, 'Audio is required.');
    }
    const audioBytes = Buffer.from(body.audio, 'base64');
    if (audioBytes.length > 12_000_000) {
      return errorResult(413, 'The audio turn is too large.');
    }
    const form = new FormData();
    form.append('model', 'gpt-transcribe');
    form.append(
      'file',
      new Blob([audioBytes], { type: body.mimeType || 'audio/webm' }),
      body.fileName || 'audio.webm',
    );
    if (body.prompt) {
      form.append('prompt', String(body.prompt).slice(0, 4_000));
    }
    const openAIResponse = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      },
    );
    if (!openAIResponse.ok) {
      return errorResult(
        openAIResponse.status,
        await openAIError(openAIResponse),
      );
    }
    return {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: await openAIResponse.text(),
    };
  }

  if (body.action === 'respond') {
    const requestBody = {
      model: 'gpt-4o-mini',
      instructions: String(body.instructions || '').slice(0, 100_000),
      input: body.input,
      tools: Array.isArray(body.tools) ? body.tools : [],
      tool_choice: body.tools?.length ? 'auto' : 'none',
      ...(body.previousResponseId
        ? { previous_response_id: body.previousResponseId }
        : {}),
    };
    const openAIResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    if (!openAIResponse.ok) {
      return errorResult(
        openAIResponse.status,
        await openAIError(openAIResponse),
      );
    }
    return {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: await openAIResponse.text(),
    };
  }

  if (body.action === 'speech') {
    const text = String(body.text || '').trim();
    if (!text) {
      return errorResult(400, 'Text is required for speech.');
    }
    const voice = supportedVoices.has(body.voice) ? body.voice : 'alloy';
    const openAIResponse = await fetch(
      'https://api.openai.com/v1/audio/speech',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice,
          input: text.slice(0, 4_000),
          response_format: 'pcm',
        }),
      },
    );
    if (!openAIResponse.ok) {
      return errorResult(
        openAIResponse.status,
        await openAIError(openAIResponse),
      );
    }
    return {
      status: 200,
      contentType: 'audio/pcm; rate=24000; channels=1',
      body: openAIResponse.body,
    };
  }

  return errorResult(400, 'Unknown voice action.');
}
