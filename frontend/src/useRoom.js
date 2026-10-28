import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

export const SERVER = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// All the WebRTC + socket logic lives here so the UI stays simple.
export function useRoom(roomId, name, create) {
  const [status, setStatus] = useState("connecting"); // connecting | live | error
  const [error, setError] = useState("");
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState({}); // id -> { name, stream }
  const [chat, setChat] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [notes, setNotes] = useState(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [myId, setMyId] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [captions, setCaptions] = useState(false);
  const sock = useRef(null), pcs = useRef({}), media = useRef(null), recog = useRef(null), capOn = useRef(false);

  useEffect(() => {
    let dead = false;
    const socket = io(SERVER);
    sock.current = socket;

    const makePeer = (id, peerName) => {
      const pc = new RTCPeerConnection(ICE);
      pcs.current[id] = pc;
      media.current.getTracks().forEach((t) => pc.addTrack(t, media.current));
      pc.onicecandidate = (e) => e.candidate && socket.emit("signal", { to: id, data: { candidate: e.candidate } });
      pc.ontrack = (e) => setPeers((p) => ({ ...p, [id]: { ...p[id], stream: e.streams[0] } }));
      setPeers((p) => ({ ...p, [id]: { name: peerName || p[id]?.name || "Guest", stream: p[id]?.stream } }));
      return pc;
    };

    (async () => {
      try {
        media.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        setError("Camera or microphone blocked. Allow access in your browser and reload.");
        return setStatus("error");
      }
      if (dead) return;
      setLocalStream(media.current);

      socket.on("connect_error", () => { setError(`Can't reach the server at ${SERVER}. Is the backend running?`); setStatus("error"); });
      socket.on("user-joined", ({ id, name: n }) => setPeers((p) => ({ ...p, [id]: { name: n } })));
      socket.on("user-left", ({ id }) => {
        pcs.current[id]?.close(); delete pcs.current[id];
        setPeers((p) => { const c = { ...p }; delete c[id]; return c; });
      });
      socket.on("signal", async ({ from, data }) => {
        const pc = pcs.current[from] || makePeer(from);
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === "offer") {
            await pc.setLocalDescription(await pc.createAnswer());
            socket.emit("signal", { to: from, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {});
      });
      socket.on("chat", (m) => setChat((c) => [...c, m]));
      socket.on("transcript", (s) => setTranscript((t) => [...t, s]));

      socket.emit("join-room", { roomId, name, create }, async (res) => {
        if (res.error) { setError(res.error); return setStatus("error"); }
        setMyId(res.id);
        setTranscript(res.transcript || []);
        setStatus("live");
        // The newcomer calls everyone already in the room.
        for (const p of res.peers) {
          const pc = makePeer(p.id, p.name);
          await pc.setLocalDescription(await pc.createOffer());
          socket.emit("signal", { to: p.id, data: { sdp: pc.localDescription } });
        }
      });
    })();

    return () => {
      dead = true; capOn.current = false; recog.current?.stop();
      Object.values(pcs.current).forEach((pc) => pc.close());
      media.current?.getTracks().forEach((t) => t.stop());
      socket.disconnect();
    };
  }, [roomId, name, create]);

  const toggle = (kind, set) => () => {
    const track = media.current?.getTracks().find((t) => t.kind === kind);
    if (track) { track.enabled = !track.enabled; set(track.enabled); }
  };

  const swapVideo = useCallback((track) => {
    Object.values(pcs.current).forEach((pc) => pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track));
  }, []);

  const toggleShare = async () => {
    const camTrack = media.current.getVideoTracks()[0];
    if (sharing) { swapVideo(camTrack); setLocalStream(new MediaStream([camTrack, ...media.current.getAudioTracks()])); return setSharing(false); }
    try {
      const screen = (await navigator.mediaDevices.getDisplayMedia({ video: true })).getVideoTracks()[0];
      screen.onended = () => { swapVideo(camTrack); setLocalStream(new MediaStream([camTrack, ...media.current.getAudioTracks()])); setSharing(false); };
      swapVideo(screen);
      setLocalStream(new MediaStream([screen, ...media.current.getAudioTracks()]));
      setSharing(true);
    } catch { /* user cancelled the picker */ }
  };

  // Each browser transcribes its own mic, so every line is tagged with the right speaker.
  const toggleCaptions = () => {
    if (!SR) return setError("Live captions need Chrome or Edge.");
    if (capOn.current) { capOn.current = false; recog.current?.stop(); return setCaptions(false); }
    const r = new SR();
    r.continuous = true; r.interimResults = false; r.lang = "en-IN";
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last.isFinal) sock.current.emit("transcript", last[0].transcript.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") { capOn.current = false; setCaptions(false); setError("Microphone permission is needed for captions."); }
      else if (e.error === "network") setError("Captions need an internet connection (Chrome sends audio to Google to transcribe).");
    };
    r.onend = () => { if (capOn.current) try { r.start(); } catch {} };
    r.start(); recog.current = r; capOn.current = true; setCaptions(true);
  };

  const sendChat = (text) => sock.current.emit("chat", text);
  const generateNotes = () => {
    setNotesLoading(true);
    sock.current.emit("summarize", null, (res) => {
      setNotesLoading(false);
      res.error ? setError(res.error) : setNotes(res.notes);
    });
  };

  return { status, error, setError, localStream, peers, chat, transcript, notes, notesLoading, mic, cam, sharing, captions,
    toggleMic: toggle("audio", setMic), toggleCam: toggle("video", setCam), toggleShare, toggleCaptions, sendChat, generateNotes, myId };
}
