// MeetMind server: WebRTC signaling + rooms + chat + live transcript + AI meeting notes.
// Audio/video never touch this server; browsers connect peer-to-peer.
try { require("dotenv").config(); } catch {} // optional: loads backend/.env
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 5000;
const ORIGIN = process.env.CLIENT_ORIGIN || "*";
const MAX_USERS = 6;

const app = express();
app.use(cors({ origin: ORIGIN }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN, methods: ["GET", "POST"] } });

const rooms = new Map(); // roomId -> { users: Map(socketId -> name), transcript: [] }

app.get("/", (_, res) => res.send("MeetMind server is running."));
app.get("/health", (_, res) => res.json({ ok: true, rooms: rooms.size, ai: !!process.env.ANTHROPIC_API_KEY }));

// Fallback when no API key is set: rule-based notes so the feature always works.
function basicSummary(transcript) {
  const tasky = /\b(will|should|need to|needs to|must|todo|to do|deadline|follow up|remind|by (mon|tues|wednes|thurs|fri)day|tomorrow|next week)\b/i;
  const decided = /\b(decided|agreed|approved|final|let's go with|we('ll| will) go with|confirmed)\b/i;
  const people = [...new Set(transcript.map((t) => t.name))];
  const top = [...transcript].sort((x, y) => y.text.length - x.text.length).slice(0, 3).sort((x, y) => x.ts - y.ts);
  return {
    summary: `${people.join(", ")} spoke for ${transcript.length} turns. Main points: ` + top.map((t) => t.text).join(" "),
    decisions: transcript.filter((t) => decided.test(t.text)).map((t) => t.text).slice(0, 6),
    actionItems: transcript.filter((t) => tasky.test(t.text)).slice(0, 8).map((t) => ({ task: t.text, owner: t.name })),
    source: "basic",
  };
}

async function summarize(transcript) {
  if (!transcript.length) throw new Error("Nothing to summarize yet. Turn on captions and talk first.");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return basicSummary(transcript);
  try {
    const text = transcript.map((t) => `${t.name}: ${t.text}`).join("\n").slice(-30000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `Summarize this meeting transcript. Reply with ONLY JSON: {"summary": string, "decisions": string[], "actionItems": [{"task": string, "owner": string}]}. Use an empty owner if unknown.\n\n${text}`,
        }],
      }),
    });
    const data = await r.json();
    const raw = data.content?.[0]?.text;
    if (!raw) throw new Error(JSON.stringify(data.error || data));
    return { ...JSON.parse(raw.replace(/```json|```/g, "").trim()), source: "claude" };
  } catch (e) {
    console.error("AI summary failed, using basic:", e.message);
    return basicSummary(transcript);
  }
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, name, create }, ack) => {
    roomId = String(roomId || "").trim().slice(0, 40);
    name = String(name || "Guest").trim().slice(0, 30) || "Guest";
    if (!roomId) return ack?.({ error: "Room code is required." });
    if (!create && !rooms.has(roomId)) return ack?.({ error: `No live meeting with code "${roomId}". Check the code or ask the host to start it.` });
    const room = rooms.get(roomId) || { users: new Map(), transcript: [] };
    if (room.users.size >= MAX_USERS) return ack?.({ error: `Room is full (max ${MAX_USERS}).` });
    rooms.set(roomId, room);

    const peers = [...room.users].map(([id, n]) => ({ id, name: n }));
    room.users.set(socket.id, name);
    socket.data = { roomId, name };
    socket.join(roomId);
    ack?.({ id: socket.id, peers, transcript: room.transcript });
    socket.to(roomId).emit("user-joined", { id: socket.id, name });
  });

  // Relay WebRTC offers/answers/ICE candidates to one specific peer.
  socket.on("signal", ({ to, data }) => io.to(to).emit("signal", { from: socket.id, data }));

  socket.on("chat", (text) => {
    const { roomId, name } = socket.data || {};
    if (!roomId || !String(text).trim()) return;
    io.to(roomId).emit("chat", { id: socket.id, name, text: String(text).slice(0, 1000), ts: Date.now() });
  });

  socket.on("transcript", (text) => {
    const { roomId, name } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room || !String(text).trim()) return;
    const seg = { name, text: String(text).slice(0, 500), ts: Date.now() };
    room.transcript.push(seg);
    io.to(roomId).emit("transcript", seg);
  });

  socket.on("summarize", async (_, ack) => {
    const room = rooms.get(socket.data?.roomId);
    try { ack?.({ notes: await summarize(room?.transcript || []) }); }
    catch (e) { ack?.({ error: e.message }); }
  });

  socket.on("disconnect", () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    room.users.delete(socket.id);
    socket.to(roomId).emit("user-left", { id: socket.id });
    if (!room.users.size) rooms.delete(roomId);
  });
});

server.listen(PORT, () => console.log(`MeetMind server on http://localhost:${PORT}`));
