# MeetMind AI

Video meetings that write their own notes. Peer-to-peer WebRTC calls with live captions, chat, screen share, and an AI recap of decisions and action items.

**Stack:** React + Vite, Node.js, Express, Socket.IO, WebRTC, Web Speech API, Claude API (optional).

## How it works
- Browsers connect to each other directly with WebRTC. The Node server only does signaling (introduces peers) and relays chat and transcript lines.
- Each browser captions its own microphone, so every transcript line has the right speaker.
- "Generate meeting notes" sends the transcript to Claude and returns a summary, decisions, and action items. Without an API key it falls back to a basic local summary.

## Run it
```bash
# terminal 1
cd backend && cp .env.example .env && npm install && npm run dev
# terminal 2
cd frontend && cp .env.example .env && npm install && npm run dev
```
Open http://localhost:5173, start a meeting, and open the invite link in a second tab or device. Captions need Chrome or Edge.

## Roadmap
Add a TURN server for restrictive networks, persist notes to a database, and switch to an SFU for large rooms.
