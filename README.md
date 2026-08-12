# RoboDeal

RoboDeal is a simple phone-friendly web app for playing poker with real cards while the phone sits in the middle of the table. It keeps track of players, chip amounts, turns, betting, pots, and hand results so players do not need to bring physical poker chips.

The goal is to make casual poker games easier to start and manage anywhere, while keeping the code small and understandable enough for Sam to edit by hand. It is a single-page app built with plain HTML, CSS, and JavaScript—no frameworks or extra libraries.

## Development practice

After every meaningful chunk of completed work, create a Git commit and push it to the `main` branch on GitHub. The user may also ask for an explicit save point at any time.

## Voice control

When recording is on, the app keeps the newest minute of one-second audio clips in browser memory and connects to OpenAI Realtime through Vercel. The AI receives a read-only copy of the game state and can affect play only by requesting one of the six approved poker functions. To turn this on in the deployed app, add an `OPENAI_API_KEY` environment variable in Vercel; never put that key in browser code.
