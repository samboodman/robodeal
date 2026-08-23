# RoboDeal

RoboDeal is a phone-friendly poker table companion. Players use real cards, while one phone in the middle of the table keeps track of the virtual chips, dealer, small blind, turns, betting rounds, main pot, any number of side pots, folds, and winners.

The project is a learning project for Sam. The game is intentionally one small single-page app with plain HTML, CSS, and JavaScript so it stays understandable and editable by hand. It is deployed at [robodeal.vercel.app](https://robodeal.vercel.app/).

## What it does now

- Set up two to eight players, player names, starting chips, dealer, small blind, optional double-sized big blind, No Limit/Pot Limit/Fixed Limit betting, a configurable fixed-limit bet, and the scheduled blind increase.
- Play a hand on one shared phone with physical cards.
- Drag the labeled player seats freely before the first deal. Seats magnetically snap only when they approach a regular table position or one of the four common square angles, and the locked clockwise order controls turns for the entire game.
- Track bets, calls, checks, folds, all-ins, main pots, side pots, player elimination, and the dealer moving each hand.
- Automatically post the configured small blind and, when enabled, a big blind worth twice the small blind.
- Show whose turn it is around the table and rotate the controls toward that player.
- Keep the phone screen awake during an active game when the browser supports it.
- Remember the latest setup in that browser, including players and chip settings.
- Connect a small OpenAI Realtime voice agent when a game starts. It can answer short poker questions and call six guarded game actions: fold, check, call, bet, all-in, and cards-dealt. The recording button controls only the microphone, and the voice customization page selects the output voice and speaking style.
- Input audio files for debugging.

## How it is built

- `index.html`, `styles.css`, and `app.js` contain the game interface and main game flow.
- `game-state.js` is the authoritative poker transition engine. It exports `GamePhase`, `Transition`, `createGameState`, `getAvailableActions(state)`, and `executeTransition(state, action)`. The interface and voice agent consume its state and legal-action list rather than deciding poker rules independently.
- `pot-logic.js` calculates contribution-based main and side pots and decides when betting rounds are complete. `pot-logic.test.js` tests that logic.
- Vite runs the local development server and builds the site for deployment.
- `voice-agent.js` owns the WebRTC voice connection, while `api/realtime-call.js` keeps the OpenAI API key on the server.
- The app does not use React or a large UI framework.

## Poker transition engine

`GameState` is plain serializable data: players, chips, blinds, dealer, active player, betting totals, pots, hand number, and one named phase. `getAvailableActions(state)` is the only source for the actions currently permitted. `executeTransition(state, action)` validates a named transition, returns a new state, and resolves deterministic outcomes such as advancing the turn, dealing the next street, running out all-in hands, or finishing a hand.

Run `npm test` to execute the transition tests, including illegal-action guards, blinds, all-ins, all-in runouts, folds, pot awards, side-pot splits, and big-blind mode.

## Run locally

Create `.env.local` with `OPENAI_API_KEY=your_key_here`, then run:

```sh
npm install
npm run dev
```

Open the local address Vite prints.

## Voice stress-test calibration

With foreground poker commands averaging `-16.8 dBFS`, the observed background-noise limit is the `+10.2 dB` stress setting relative to `restaurant-chatter-balanced.wav`. This was the first tested background level to miss an intended command.

For the few-speaker stress files, the foreground poker commands average `-16.8 dBFS`. The magnitude-00 background averages `-39.0 dBFS`, and each subsequent magnitude raises only the background by `2 dB` before the final limiter:

| Magnitude | Background level |
| --- | ---: |
| 00 | `-39.0 dBFS` |
| 01 | `-37.0 dBFS` |
| 02 | `-35.0 dBFS` |
| 03 | `-33.0 dBFS` |
| 04 | `-31.0 dBFS` |
| 05 | `-29.0 dBFS` |
| 06 | `-27.0 dBFS` |
| 07 | `-25.0 dBFS` |
| 08 | `-23.0 dBFS` |
| 09 | `-21.0 dBFS` |
| 10 | `-19.0 dBFS` |

## Development practice

After every meaningful chunk of work, create a Git commit and push it to the `main` branch on GitHub. The user can also ask for an explicit save point at any time.
