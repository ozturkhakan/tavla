# Tavla — online backgammon

Private backgammon tables shared by link. Node.js + Express + Socket.IO; the server runs the rules and validates every move.

## Run locally

```
npm install
npm start
```

Open http://localhost:3000, create a table and send the link to your opponent. Anyone else who opens the link watches.

To play the computer instead, pick Easy, Medium or Hard under "Opponent" before creating the table. The computer sits as Dark, plays its turns on the server, and answers and offers doubles (Easy never doubles).

## Layout

- `server.js` — rooms, seats, dice, clocks, doubling, resign, chat (all state in memory)
- `shared/rules.js` — move rules used by both server and browser
- `bot.js` — computer opponent: legal play generation, position heuristic, one-roll lookahead on Hard, cube decisions
- `public/index.html` — landing page (create / join a table)
- `public/table.html`, `public/table.js`, `public/style.css` — the game table
- `backgammon.html` — the original single-player design prototype

## Deploying

Any host that runs a Node web service works (Render, Railway, Fly.io). Start command `npm start`; the server reads `PORT`. Tables live in memory, so a restart clears them.
