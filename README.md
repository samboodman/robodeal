# RoboDeal

RoboDeal is a phone-friendly poker table companion. Players use real cards, while one phone in the middle of the table keeps track of the virtual chips, dealer, ante, turns, betting rounds, main pot, side pot, folds, and winners.

The project is a learning project for Sam. The game is intentionally one small single-page app with plain HTML, CSS, and JavaScript so it stays understandable and editable by hand. It is deployed at [robodeal.vercel.app](https://robodeal.vercel.app/).

## What it does now

- Set up two to eight players, player names, starting chips, dealer, ante, and ante increase.
- Play a hand on one shared phone with physical cards.
- Track bets, calls, checks, folds, all-ins, main pots, side pots, player elimination, and the dealer moving each hand.
- Automatically post the configured ante as the small blind, plus a big blind worth twice the ante in games with six to eight players.
- Show whose turn it is around the table and rotate the controls toward that player.
- Keep the phone screen awake during an active game when the browser supports it.
- Remember the latest setup in that browser, including players, chip settings, and voice choices.
- Offer optional OpenAI Realtime voice control. The app sends audio through a WebRTC connection and gives the AI a read-only copy of the game state. The AI can change the game only by calling approved action functions: fold, check, call, bet, all-in, confirm, and continue after cards are dealt.
- Let players choose a built-in dealer voice, accent preference, personality, and speaking pace, then preview that voice before a game.

## How it is built

- `index.html`, `styles.css`, and `app.js` contain the game interface and logic.
- Vite runs the local development server and builds the site for deployment.
- `api/realtime-call.js` is a small Vercel server function. It keeps `OPENAI_API_KEY` on the server and creates the OpenAI Realtime WebRTC connection without exposing the key to the browser.
- `vite.config.mjs` provides the same protected Realtime endpoint during local development, so running locally does not require Vercel.
- The app does not use React or a large UI framework.

## Run locally

Create a `.env.local` file containing your OpenAI API key:

```sh
OPENAI_API_KEY=your_key_here
```

The file is ignored by Git and the key is used only by the local Vite server. Then run:

```sh
npm install
npm run dev
```

Open the local address Vite prints. A deployed copy separately needs `OPENAI_API_KEY` configured on whichever hosting service runs `api/realtime-call.js`.

## Development practice

After every meaningful chunk of work, create a Git commit and push it to the `main` branch on GitHub. The user can also ask for an explicit save point at any time.
