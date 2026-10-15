export const decisionsToText = {rejected: {CHIPS_OWED: (decisions) => {
    return `that bet is not allowed, ${decisions.details.actor.name} needs at least ${decisions.details.amountToCall} to bet`
}, NOTHING_TO_CALL: (decisions) => {
    return `${decisions.details.actor.name} may not call there is nothing owed. Check instead`
}, ALL_IN_NOT_LEGAL: (decisions) => {
    return `${decisions.details.actor.name} may not go all in the maximum additional bet is ${decisions.details.maximumAdditionalBet}`
}, ILLEGAL_BET_OR_RAISE: (decisions) => {
    return ` may not bet ${decisions.details.requestedTotal} the betting limit is ${decisions.details.bettingLimit}`
}, UNKNOWN_ACTION: (decisions) => {
    return `${decisions.details.requestedTool} is not a valid action in robodeal`
}, TOOL_EXECUTION_FAILED: (decisions) => {
    return `the tool you attempted to use cannot function because ${decisions.details.reasons}`
}, NOTHING_TO_UNDO: () => {
    return "there is nothing to undo"
}, NOT_WAITING_FOR_CARDS: () => {
    return "there is no cards waiting to be dealt"
}, NOT_BETWEEN_HANDS: () => {
    return "the game is not waiting to begin next hand"
}, NO_SHOWDOWN_POT: () => {
    return "no pot being awarded"
}, NOT_ELIGIBLE: () => {
    return "that player is not eligible for the win"
}, NO_CURRENT_PLAYER: () => {
    return "there is no active player"
}, BETTING_ACTION_UNAVAILABLE: () => {
    return "the betting action is unavailable"
}, UNKNOWN_ERROR_CODE: () => {
    return "that action has failed on a unprogrammed error code"
}}, event: {game_started: (decisions) => {
    return `game is ${decisions.setup.variant}, ${decisions.setup.ante.enabled ? `ante is ${decisions.setup.ante.amount}, ` : ""} small blind is ${decisions.setup.small_blind}, ${decisions.setup.big_blind.enabled ? `big blind is ${decisions.setup.big_blind.amount}, ` : "big blind is disabled, "} ${decisions.setup.dealer} is the dealer, ${decisions.setup.small_blind_player} is the small blind${decisions.setup.big_blind.enabled ? `, ${decisions.setup.big_blind_player} is the big blind` : ""}. Deal 2 face down hole cards to each player press OK or say "cards are dealt" when done`
}, new_hand_started: () => {
    return `next hand, deal to face down hole cards to each player press OK or say "cards are dealt" when done`
}, state_transition: (decisions) => {
    return `${decisions.actor ?? ""} ${decisions.action.type === "ALL IN" ? "went all in" : `${decisions.action.type.toLowerCase()}ed`}, ${decisions.action.type === "ALL IN" || decisions.action.type === "CALL" || decisions.action.type === "BET" || decisions.action.type === "RAISE" ? "pot is now" : "pot stays"} ${decisions.state.pot}`
}}, winner: (decisions) => {
    return `${decisions.winners.join(", ")} ${decisions.winners.length === 1 ? "was" : "were"} awarded ${decisions.pot_awarded}`
}}
