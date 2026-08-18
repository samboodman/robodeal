# RoboDeal

RoboDeal is a phone-friendly poker table companion. Players use real cards, while one phone in the middle of the table keeps track of the virtual chips, dealer, small blind, turns, betting rounds, main pot, any number of side pots, folds, and winners.

The project is a learning project for Sam. The game is intentionally one small single-page app with plain HTML, CSS, and JavaScript so it stays understandable and editable by hand. It is deployed at [robodeal.vercel.app](https://robodeal.vercel.app/).

## What it does now

- Set up two to eight players, player names, starting chips, dealer, small blind, optional double-sized big blind, and the scheduled blind increase.
- Play a hand on one shared phone with physical cards.
- Track bets, calls, checks, folds, all-ins, main pots, side pots, player elimination, and the dealer moving each hand.
- Automatically post the configured small blind and, when enabled, a big blind worth twice the small blind.
- Show whose turn it is around the table and rotate the controls toward that player.
- Keep the phone screen awake during an active game when the browser supports it.
- Remember the latest setup in that browser, including players and chip settings.
- Keep the former recording and voice-test buttons visible as nonfunctional placeholders while the voice system is rebuilt. The voice customization page remains available, but its choices do not affect the game.

## How it is built

- `index.html`, `styles.css`, and `app.js` contain the game interface and main game flow.
- `pot-logic.js` calculates contribution-based main and side pots and decides when betting rounds are complete. `pot-logic.test.js` tests that logic.
- Vite runs the local development server and builds the site for deployment.
- The app does not use React or a large UI framework.

## Run locally

```sh
npm install
npm run dev
```

Open the local address Vite prints.

## Development practice

After every meaningful chunk of work, create a Git commit and push it to the `main` branch on GitHub. The user can also ask for an explicit save point at any time.
