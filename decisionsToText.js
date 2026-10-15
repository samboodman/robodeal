function formatList(arr) {
  const formatter = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
  return formatter.format(arr);
}

export const decisionsToText = {rejected: {CHIPS_OWED: (decisions) => {
    return `${decisions.details.actor.name} cannot make that bet; at least ${decisions.details.amountToCall} is required.`
}, NOTHING_TO_CALL: (decisions) => {
    return `${decisions.details.actor.name} cannot call because there is nothing to call. Check instead.`
}, ALL_IN_NOT_LEGAL: (decisions) => {
    return `${decisions.details.actor.name} cannot go all in; the maximum additional bet is ${decisions.details.maximumAdditionalBet}.`
}, ILLEGAL_BET_OR_RAISE: (decisions) => {
    return `That bet of ${decisions.details.requestedTotal} is not allowed; the betting limit is ${decisions.details.bettingLimit}.`
}, UNKNOWN_ACTION: (decisions) => {
    return `${decisions.details.requestedTool} is not a valid RoboDeal action.`
}, TOOL_EXECUTION_FAILED: (decisions) => {
    return `That action could not be completed because ${decisions.details.reasons}.`
}, NOTHING_TO_UNDO: () => {
    return "There is nothing to undo."
}, NOT_WAITING_FOR_CARDS: () => {
    return "There are no cards waiting to be dealt."
}, NOT_BETWEEN_HANDS: () => {
    return "The game is not waiting to begin the next hand."
}, NO_SHOWDOWN_POT: () => {
    return "There is no pot being awarded."
}, NOT_ELIGIBLE: () => {
    return "That player is not eligible to win this pot."
}, NO_CURRENT_PLAYER: () => {
    return "There is no active player."
}, BETTING_ACTION_UNAVAILABLE: () => {
    return "That betting action is unavailable."
}, UNKNOWN_ERROR_CODE: () => {
    return "That action failed for an unknown error."
}}, event: {game_started: (decisions) => {
    return `This is ${decisions.setup.variant}. ${decisions.setup.ante.enabled ? `The ante is ${decisions.setup.ante.amount}. ` : ""}The small blind is ${decisions.setup.small_blind}. ${decisions.setup.big_blind.enabled ? `The big blind is ${decisions.setup.big_blind.amount}.` : "The big blind is disabled."} ${decisions.setup.dealer} is the dealer. ${decisions.setup.small_blind_player} posts the small blind${decisions.setup.big_blind.enabled ? `, and ${decisions.setup.big_blind_player} posts the big blind` : ""}. Deal two face-down hole cards to each player, then press OK or say "cards are dealt".`
}, new_hand_started: () => {
    return `Next hand. Deal two face-down hole cards to each player, then press OK or say "cards are dealt".`
}, state_transition: (decisions) => {
    const type = decisions.action.type;
    const action = { CHECK: "checked", CALL: "called", BET: "bet", RAISE: "raised", FOLD: "folded", ALL_IN: "went all in", "ALL IN": "went all in", CARDS_DEALT: "dealt the cards" }[type] ?? String(type).toLowerCase().replaceAll("_", " ");
    const changesPot = ["ALL_IN", "ALL IN", "CALL", "BET", "RAISE"].includes(type);
    return `${decisions.actor ? `${decisions.actor} ` : ""}${action}. The pot ${changesPot ? "is now" : "stays"} ${decisions.state.pot}.`
}}, action: (decisions) => {
    const type = String(decisions.requested ?? "").toUpperCase().replaceAll(" ", "_");
    const action = { CHECK: "checked", CALL: "called", BET: "bet", RAISE: "raised", FOLD: "folded", ALL_IN: "went all in", CARDS_DEALT: "dealt the cards", UNDO: "undid the last action", NEXT_HAND: "started the next hand" }[type] ?? type.toLowerCase().replaceAll("_", " ");
    const amount = Number.isFinite(decisions.chips_moved) && ["CALL", "BET", "RAISE", "ALL_IN"].includes(type) ? ` for ${decisions.chips_moved}` : "";
    const pot = Number.isFinite(decisions.pot_after) ? ` The pot is ${decisions.pot_after}.` : "";
    return `${decisions.actor ? `${decisions.actor} ` : ""}${action}${amount}.${pot}`
}, winner: (decisions) => {
    return `${formatList(decisions.winners)} ${decisions.winners.length === 1 ? "was" : "were"} awarded ${decisions.pot_awarded}.`
}}
