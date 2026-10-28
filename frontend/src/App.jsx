import { useEffect, useRef, useState } from "react";
import { useRoom } from "./useRoom.js";

const code = () => Math.random().toString(36).slice(2, 5) + "-" + Math.random().toString(36).slice(2, 6);
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function App() {
  const [name, setName] = useState(() => localStorage.getItem("mm-name") || "");
  const [mode, setMode] = useState("create"); // create | join
  const [joinCode, setJoinCode] = useState(() => location.hash.slice(1)); // invite links prefill this
  const [session, setSession] = useState(null); // { roomId, create }
  const [err, setErr] = useState("");
  useEffect(() => { if (location.hash.length > 1) setMode("join"); }, []);

  if (session) return <Room {...session} name={name} onLeave={() => { setSession(null); location.hash = ""; }} />;

  const start = (e) => {
    e.preventDefault();
    const create = mode === "create";
    const roomId = create ? code() : joinCode.trim();
    if (!name.trim()) return setErr("Enter your name first.");
    if (!roomId) return setErr("Enter the meeting code you were given.");
    localStorage.setItem("mm-name", name.trim());
    location.hash = roomId; setErr(""); setSession({ roomId, create });
  };
  return (
    <main className="lobby">
      <section>
        <h1>Talk now.<br />Notes write themselves.</h1>
        <p className="lede">Video meetings with live captions, chat, and an AI recap of decisions and action items when you hang up.</p>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={mode === "create"} onClick={() => { setMode("create"); setErr(""); }}>Create meeting</button>
          <button role="tab" aria-selected={mode === "join"} onClick={() => { setMode("join"); setErr(""); }}>Join meeting</button>
        </div>
        <form onSubmit={start}>
          <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Abhinav" maxLength={30} /></label>
          {mode === "join" && <label>Meeting code<input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="abc-1234" maxLength={40} /></label>}
          {err && <p className="err" role="alert">{err}</p>}
          <button className="primary">{mode === "create" ? "Create and start meeting" : "Join meeting"}</button>
          {mode === "create" && <small className="hint">You'll get an invite link to share once you're in.</small>}
        </form>
      </section>
      <aside aria-hidden="true" className="sample">
        <p className="cap"><b>Riya</b> We ship the beta on Friday.</p>
        <p className="cap"><b>Sam</b> I'll fix the login bug by tomorrow.</p>
        <div className="recap"><h4>Action items</h4><p>Sam: fix the login bug by tomorrow</p><h4>Decision</h4><p>Beta ships Friday</p></div>
      </aside>
    </main>
  );
}

function Video({ stream, muted, label, off }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null; }, [stream]);
  return (
    <figure className="tile">
      <video ref={ref} autoPlay playsInline muted={muted} />
      {off && <div className="off">{label[0]?.toUpperCase()}</div>}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function Room({ roomId, name, create, onLeave }) {
  const r = useRoom(roomId, name, create);
  const [tab, setTab] = useState("chat");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const feedRef = useRef();
  const list = tab === "chat" ? r.chat : r.transcript;
  // Scroll only the message list, never the whole page.
  useEffect(() => { const el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }, [list.length, tab]);

  if (r.status === "error")
    return <main className="lobby"><section><h1>Couldn't join</h1><p className="lede">{r.error}</p><button className="primary" onClick={onLeave}>Back to start</button></section></main>;

  const peerList = Object.entries(r.peers);
  const copy = () => { navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const send = (e) => { e.preventDefault(); if (msg.trim()) { r.sendChat(msg); setMsg(""); } };

  return (
    <div className="room">
      <header>
        <strong>MeetMind</strong>
        <button className="ghost" onClick={copy}>{copied ? "Link copied" : `Copy invite link · code ${roomId}`}</button>
      </header>
      {r.error && <div className="toast" role="alert" onClick={() => r.setError("")}>{r.error}</div>}
      <div className={`grid n${Math.min(peerList.length + 1, 4)}`}>
        <Video stream={r.localStream} muted label={`${name} (you)`} off={!r.cam && !r.sharing} />
        {peerList.map(([id, p]) => <Video key={id} stream={p.stream} label={p.name} />)}
        {!peerList.length && <div className="empty">Waiting for others. Copy the invite link and send it.</div>}
      </div>
      <aside className="panel">
        <nav role="tablist">
          {["chat", "captions", "notes"].map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "notes" ? "AI notes" : t}</button>)}
        </nav>
        {tab !== "notes" && (
          <div className="feed" ref={feedRef}>
            {list.length === 0 && <p className="hint">{tab === "chat" ? "No messages yet." : "Turn on captions and start talking. Everything said appears here."}</p>}
            {list.map((m, i) => <p key={i} className={`line ${m.id && m.id === r.myId ? "mine" : ""}`}><b>{m.name}</b><time>{time(m.ts)}</time><br />{m.text}</p>)}
          </div>
        )}
        {tab === "chat" && <form className="send" onSubmit={send}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message everyone" /><button className="primary">Send</button></form>}
        {tab === "captions" && <p className="hint pad">{r.captions ? "Your speech is being captioned." : "Captions are off. Use the Captions button below."}</p>}
        {tab === "notes" && (
          <div className="feed">
            <button className="primary wide" disabled={r.notesLoading} onClick={r.generateNotes}>{r.notesLoading ? "Writing notes…" : "Generate meeting notes"}</button>
            {!r.notes && <p className="hint">Notes are built from the captions, so turn those on first.</p>}
            {r.notes && <article className="recap">
              <h4>Summary</h4><p>{r.notes.summary}</p>
              {!!r.notes.decisions?.length && <><h4>Decisions</h4><ul>{r.notes.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
              {!!r.notes.actionItems?.length && <><h4>Action items</h4><ul>{r.notes.actionItems.map((a, i) => <li key={i}>{a.owner && <b>{a.owner}: </b>}{a.task}</li>)}</ul></>}
              <small>{r.notes.source === "claude" ? "Written by Claude" : "Basic summary. Add an API key on the server for full AI notes."}</small>
            </article>}
          </div>
        )}
      </aside>
      <footer className="bar">
        <button aria-pressed={!r.mic} onClick={r.toggleMic}>{r.mic ? "Mute" : "Unmute"}</button>
        <button aria-pressed={!r.cam} onClick={r.toggleCam}>{r.cam ? "Stop video" : "Start video"}</button>
        <button aria-pressed={r.sharing} onClick={r.toggleShare}>{r.sharing ? "Stop sharing" : "Share screen"}</button>
        <button aria-pressed={r.captions} onClick={r.toggleCaptions}>{r.captions ? "Captions on" : "Captions"}</button>
        <button className="leave" onClick={onLeave}>Leave</button>
      </footer>
    </div>
  );
}
