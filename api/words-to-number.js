import { handleWordsToNumberApi } from '../word-to-number-handler.js';

export default function handler(request, response) {
  if (request.method !== 'POST') {
    response
      .status(405)
      .json({ error: 'Use POST for words-to-number requests.' });
    return;
  }
  const result = handleWordsToNumberApi(request.body || {});
  response.status(result.status);
  response.setHeader('Content-Type', result.contentType);
  response.send(result.body);
}
