import {
  collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, where, writeBatch,
} from "firebase/firestore";
import { ArrowUp, History, MessageSquarePlus, Sparkle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown, Sheet, useToast } from "../components/ui";
import { useData } from "../data";
import { callAI, db } from "../firebase";
import { dayLabel } from "../format";
import { todayISO } from "../model";

// Conversations live in Firestore (users/{uid}/chats); the server writes both sides of each
// turn, so this screen only listens. The open chat is remembered for the session.
interface Msg { id: string; role: "user" | "model"; text: string; at: number; tools?: string[] }
interface Chat { id: string; title: string; updatedAt: number; count?: number }

const SUGGESTIONS = [
  "How am I doing this month?",
  "How much have I spent on food delivery since April?",
  "Can I afford a ₹15,000 purchase this month without touching my reserves?",
  "When will my reserve goals be funded at my current pace?",
  "Which merchants are growing fastest in my spending?",
  "Who still owes me money, and since when?",
];

const KEY = "kosh.chat";
const readKey = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const writeKey = (v: string | null) => { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch { /* private mode */ } };

export function Ask() {
  const { user } = useData();
  const toast = useToast();
  const uid = user!.uid;
  const [chatId, setChatIdState] = useState<string | null>(readKey);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const setChatId = (id: string | null) => { setChatIdState(id); writeKey(id); };

  useEffect(() => onSnapshot(query(collection(db, "users", uid, "chats"), orderBy("updatedAt", "desc"), limit(50)),
    (s) => setChats(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Chat))), [uid]);

  useEffect(() => {
    if (!chatId) { setMsgs([]); return; }
    return onSnapshot(query(collection(db, "users", uid, "chats", chatId, "messages"), orderBy("at")),
      (s) => setMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Msg)));
  }, [uid, chatId]);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, pending]);

  async function send(q = text) {
    q = q.trim();
    if (!q || pending) return;
    setPending(q);
    setText("");
    setErr("");
    try {
      const res = await callAI<{ chatId: string; answer: string }>({ task: "ask", question: q, chatId, today: todayISO() });
      if (res.chatId && res.chatId !== chatId) setChatId(res.chatId);
    } catch (e) {
      setErr((e as Error).message);
      setText(q);
    } finally {
      setPending(null);
    }
  }

  async function removeChat(id: string) {
    const msgsSnap = await getDocs(collection(db, "users", uid, "chats", id, "messages"));
    const recall = await getDocs(query(collection(db, "users", uid, "recall"), where("chatId", "==", id)));
    const batch = writeBatch(db);
    [...msgsSnap.docs, ...recall.docs].forEach((d) => batch.delete(d.ref));
    await batch.commit();
    await deleteDoc(doc(db, "users", uid, "chats", id));
    if (id === chatId) setChatId(null);
    toast({ text: "Conversation deleted" });
  }

  // The server writes the user's turn first; hide our optimistic copy once it lands.
  const showPending = pending && !msgs.some((m) => m.role === "user" && m.text === pending && m === msgs[msgs.length - 1]);
  const title = chats.find((c) => c.id === chatId)?.title;

  return (
    <div>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <h1>Ask Kosh</h1>
          <div className="sub ellipsis">{title || "Answers from your full history, with exact numbers"}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" aria-label="Past conversations" onClick={() => setShowHistory(true)}><History size={19} /></button>
          {chatId && <button className="icon-btn" aria-label="New conversation" onClick={() => { setChatId(null); setErr(""); }}><MessageSquarePlus size={19} /></button>}
        </div>
      </div>

      <div className="chat" style={{ maxWidth: 760, margin: "0 auto" }}>
        {msgs.length === 0 && !pending && (
          <div className="stack" style={{ gap: 10, marginTop: 8 }}>
            <p className="ink-2 small">Ask anything about your money. Kosh looks things up in your full history and does the maths exactly. A few to start:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn" style={{ justifyContent: "flex-start", textAlign: "left", padding: "12px 14px" }} onClick={() => send(s)}>{s}</button>
            ))}
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Conversations are saved to your account. Tell Kosh a goal or who someone is and it'll remember. It isn't a licensed financial advisor and won't pick investments for you.
            </p>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "model" ? <Markdown text={m.text} /> : m.text}
            {m.role === "model" && !!m.tools?.length && (
              <div className="tools-line"><Sparkle size={11} /> {m.tools.join(" · ")}</div>
            )}
          </div>
        ))}
        {showPending && <div className="msg user">{pending}</div>}
        {pending && <div className="msg model typing" aria-label="Thinking"><span /><span /><span /><em className="tiny muted" style={{ marginLeft: 6 }}>looking through your data…</em></div>}
        {err && <div className="error">{err}</div>}
        <div ref={end} />
      </div>

      <div className="composer">
        <div className="composer-in">
          <textarea rows={1} placeholder="Ask about your money…" value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="send" onClick={() => send()} disabled={!text.trim() || !!pending} aria-label="Send"><ArrowUp size={18} /></button>
        </div>
      </div>

      {showHistory && (
        <Sheet title="Conversations" onClose={() => setShowHistory(false)}>
          <div className="stack" style={{ gap: 6 }}>
            <button className="btn btn-block" onClick={() => { setChatId(null); setShowHistory(false); }}><MessageSquarePlus size={16} /> New conversation</button>
            {chats.length === 0 && <p className="small muted" style={{ textAlign: "center", padding: 16 }}>No saved conversations yet.</p>}
            {chats.map((c) => (
              <div key={c.id} className={`chat-item ${c.id === chatId ? "on" : ""}`}>
                <button className="chat-open" onClick={() => { setChatId(c.id); setShowHistory(false); }}>
                  <div className="ellipsis" style={{ fontWeight: 500 }}>{c.title}</div>
                  <div className="tiny muted">{dayLabel(new Date(c.updatedAt).toISOString().slice(0, 10), todayISO())}{c.count ? ` · ${c.count} messages` : ""}</div>
                </button>
                <button className="icon-btn" aria-label={`Delete “${c.title}”`} onClick={() => removeChat(c.id)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
