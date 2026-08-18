function escapeRegularExpression(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isGameRelatedTranscript(transcript, { playerNames = [], waitingForCards = false } = {}) {
  const normalized = String(transcript || '').toLowerCase().trim();
  if (!normalized) return false;

  const unmistakablePokerLanguage = /\b(poker|cards?|deal|dealt|flop|river|showdown|pot|chips?|blind|ante|dealer|side[ -]?pot)\b/;
  if (unmistakablePokerLanguage.test(normalized)) return true;

  const actionCommand = /^(please\s+)?(i\s+)?(bet|raise|call|check|fold|all[ -]?in|go all[ -]?in|undo)\b/;
  const actionQuestion = /\b(can|could|should|may)\s+i\s+(bet|raise|call|check|fold|go all[ -]?in)\b/;
  const turnQuestion = /\b(whose|who'?s|my|your|their)\s+turn\b|\bwho\s+(is|goes)\s+next\b/;
  const handPhrase = /\b(poker hand|this hand|next hand|new hand|wins? the hand)\b/;
  if (actionCommand.test(normalized) || actionQuestion.test(normalized) || turnQuestion.test(normalized) || handPhrase.test(normalized)) return true;

  const playerAction = playerNames.some((name) => {
    const normalizedName = String(name || '').toLowerCase().trim();
    if (!normalizedName) return false;
    return new RegExp(`^${escapeRegularExpression(normalizedName)}[,\\s]+(bet|raise|call|check|fold|go all[ -]?in|all[ -]?in)\\b`).test(normalized);
  });
  if (playerAction) return true;

  if (waitingForCards && /\b(done|ready|okay|ok|finished)\b/.test(normalized)) return true;
  return false;
}
