import { wordsToNumber } from "./word-to-number.js";

function jsonResult(status, body) {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  };
}

export function handleWordsToNumberApi(body) {
  if (typeof body?.words !== "string" || !body.words.trim()) {
    return jsonResult(400, { error: "Words are required." });
  }
  if (body.words.length > 500) {
    return jsonResult(413, { error: "The numeric phrase is too long." });
  }
  const number = wordsToNumber(body.words);
  if (!Number.isFinite(number)) {
    return jsonResult(422, { error: "No number was found." });
  }
  return jsonResult(200, { number });
}
