function jsonError(status, message) {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({ error: message }),
  };
}

function readableOpenAIError(response, responseBody) {
  try {
    const parsed = JSON.parse(responseBody);
    return String(parsed.error?.message || parsed.error || parsed.message);
  } catch {}

  if (/<(?:!doctype|html)\b/i.test(responseBody)) {
    if (response.status === 504) {
      return "OpenAI timed out while starting live transcription (504). Please try again.";
    }
    return `OpenAI could not start live transcription (HTTP ${response.status}). Please try again.`;
  }

  const trimmedBody = responseBody.trim();
  return trimmedBody.length > 300
    ? `${trimmedBody.slice(0, 297)}...`
    : trimmedBody ||
        `OpenAI could not start live transcription (HTTP ${response.status}).`;
}

export function realtimeTranscriptionSession() {
  return {
    type: "transcription",
    audio: {
      input: {
        transcription: {
          model: "gpt-live-transcribe",
          delay: "low",
        },
        turn_detection: null,
      },
    },
  };
}

export async function createRealtimeTranscriptionClientSecret(apiKey) {
  if (!apiKey) {
    return jsonError(500, "The server is missing OPENAI_API_KEY.");
  }

  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "robodeal-anonymous",
      },
      body: JSON.stringify({ session: realtimeTranscriptionSession() }),
      signal: AbortSignal.timeout(8000),
    }
  );
  const responseBody = await response.text();
  if (!response.ok) {
    return jsonError(
      response.status,
      readableOpenAIError(response, responseBody)
    );
  }
  return {
    status: response.status,
    contentType:
      response.headers.get("content-type") || "application/json; charset=utf-8",
    body: responseBody,
  };
}
