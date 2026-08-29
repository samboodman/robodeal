# RoboDeal

RoboDeal is a phone-friendly poker table companion. Players use real cards, while one phone in the middle of the table keeps track of the virtual chips, dealer, small blind, turns, betting rounds, main pot, any number of side pots, folds, and winners.

The project is a learning project for Sam. The game is intentionally one small single-page app with plain HTML, CSS, and JavaScript so it stays understandable and editable by hand. It is deployed at [robodeal.vercel.app](https://robodeal.vercel.app/).

## What it does now

- Set up two to eight players, player names, starting chips, dealer, small blind, optional double-sized big blind, optional ante, No Limit/Pot Limit/Fixed Limit betting, a configurable fixed-limit bet, and the scheduled blind increase.
- Play a hand on one shared phone with physical cards.
- Drag the labeled player seats freely before the first deal. Seats magnetically snap within 5 degrees of a regular table position or one of the four common square angles, and the locked clockwise order controls turns for the entire game.
- Track bets, calls, checks, folds, all-ins, main pots, side pots, player elimination, and the dealer moving each hand.
- Automatically post the configured small blind and, when enabled, a big blind worth twice the small blind.
- Show whose turn it is around the table and rotate the controls toward that player.
- Keep the phone screen awake during an active game when the browser supports it.
- Remember the latest setup in that browser, including players and chip settings.
- Keep a continuous transcription-only OpenAI connection running while the microphone is on. Completed speech is sent as text to a reasoning model, which can answer poker questions or use game functions, and its response is converted back into speech.
- Control the complete game flow by voice after setup: check, call, bet, raise, fold, go all in, confirm or cancel an action, acknowledge dealt cards, undo, choose or split a pot winner, and start the next hand. The agent also narrates dealing instructions, showdown questions, hand winners, and the game winner, and it silently ignores unrelated speech.
- Use the recording button to control only the microphone. The voice customization page selects the output voice, accent, and speaking pace.
- Input audio files for debugging on localhost after enabling both debug features and audio-file input.

## How it is built

- `index.html`, `styles.css`, and `app.js` contain the game interface and main game flow.
- `game-state.js` is the authoritative poker transition engine. It exports `GamePhase`, `Transition`, `BettingLimit`, `createGameState`, `getBettingBounds`, `createDebugGameState`, `getAvailableActions(state)`, and `executeTransition(state, action)`. The interface and voice agent consume its state and legal-action list rather than deciding poker rules independently.
- `pot-logic.js` calculates contribution-based main and side pots and decides when betting rounds are complete. `pot-logic.test.js` tests that logic.
- Vite runs the local development server and builds the site for deployment.
- `voice-agent.js` coordinates live transcription, text reasoning and function calls, and speech playback. The continuous microphone uses a transcription-only WebRTC session with `gpt-live-transcribe`; localhost audio-file tests use `gpt-transcribe`.
- `api/realtime-call.js` mints a short-lived transcription key so the standard OpenAI API key stays on the server. `realtime-transcription.js` defines that transcription-only session.
- `api/voice.js` and `voice-api-handler.js` send completed text to `gpt-5.6-sol` for reasoning and function selection, and convert responses to audio with `tts-1`.
- The app does not use React or a large UI framework.

## Poker transition engine

`GameState` is plain serializable data: players, chips, blinds, dealer, active player, betting totals, pots, hand number, and one named phase. `getAvailableActions(state)` is the source for legal poker-engine transitions in the current state. Interface-only behavior such as undo and voice confirmation is managed separately in `app.js`. `executeTransition(state, action)` validates a named transition, returns a new state, and resolves deterministic outcomes such as advancing the turn, dealing the next street, running out all-in hands, or finishing a hand.

Run `npm test` to execute the transition tests, including illegal-action guards, blinds, all-ins, all-in runouts, folds, pot awards, side-pot splits, and big-blind mode.

## Run locally

Create `.env.local` with `OPENAI_API_KEY=your_key_here`, then run:

```sh
npm install
npm run dev
```

Open the local address Vite prints.

## Development practice

After every meaningful chunk of work, create a Git commit and push it to the `main` branch on GitHub. The user can also ask for an explicit save point at any time.
