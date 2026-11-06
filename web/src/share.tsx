// Shares from other apps land in the service worker's inbox (see public/sw.js). This reads each
// one with AI and logs the transactions straight away, flagged for review — like a fitness
// tracker's auto-detected workout. Anything that can't be read (offline, AI error) stays in the
// inbox and shows on Home with a retry.
import { Inbox, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseWithAI, shrink } from "./ai";
import { TxnRow } from "./components/TxnRow";
import { Sheet } from "./components/ui";
import { useData } from "./data";
import { inr } from "./format";
import { Txn, accountSets, emptyDraft, validate } from "./model";
import { useShell } from "./shell";

const INBOX = "kosh-share-inbox";

interface Meta { id: string; text: string; files: number; at: number }
interface Result { saved: Txn[]; skipped: number; message: string }

// ---- tiny store ----
let state: { pending: Meta[]; busy: boolean; error: string; result: Result | null } = { pending: [], busy: false, error: "", result: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
let runner: (() => void) | null = null;
const useShareState = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);

async function inbox(): Promise<Meta[]> {
  if (!("caches" in window)) return [];
  const cache = await caches.open(INBOX);
  const metas = (await cache.keys()).filter((r) => r.url.endsWith("/meta"));
  const list = await Promise.all(metas.map(async (r) => (await cache.match(r))!.json() as Promise<Meta>));
  return list.sort((a, b) => a.at - b.at);
}

async function discard(id: string) {
  const cache = await caches.open(INBOX);
  for (const r of await cache.keys()) if (new URL(r.url).pathname.startsWith(`/inbox/${id}/`)) await cache.delete(r);
}

async function files(m: Meta): Promise<Blob[]> {
  const cache = await caches.open(INBOX);
  const out: Blob[] = [];
  for (let i = 0; i < m.files; i++) {
    const r = await cache.match(`/inbox/${m.id}/file/${i}`);
    if (r) out.push(await r.blob());
  }
  return out;
}

// Mounted once while signed in: processes the inbox on open and whenever a new share arrives.
export function ShareProcessor() {
  const data = useData();
  const latest = useRef(data);
  latest.current = data;
  const { openAdd } = useShell();
  const { result, busy } = useShareState();

  const run = async () => {
    const data = latest.current;
    if (state.busy) return;
    const pending = await inbox();
    set({ pending });
    if (!pending.length) return;
    set({ busy: true, error: "" });
    const acc = accountSets(data.settings);
    const all: Result = { saved: [], skipped: 0, message: "" };
    for (const m of pending) {
      try {
        const images = await Promise.all((await files(m)).map(shrink));
        const res = await parseWithAI(data, { text: m.text, images });
        const drafts = res.transactions.map((d) => ({ ...emptyDraft(acc, d.type), ...d })).filter((d) => !validate(acc, d));
        const { saved, skipped } = await data.addTxns(drafts, "share", { review: true });
        all.saved.push(...saved);
        all.skipped += skipped.length;
        if (res.message) all.message = res.message;
        else if (!res.transactions.length) all.message = "Couldn't find a payment in what you shared.";
        await discard(m.id);
      } catch (e) {
        set({ error: (e as Error).message });
        break; // leave the rest in the inbox for a retry
      }
    }
    set({ busy: false, pending: await inbox(), result: all.saved.length || all.skipped || all.message ? all : null });
  };
  runner = run;

  useEffect(() => {
    if (new URLSearchParams(location.search).has("share")) history.replaceState(null, "", "/" + location.hash);
    const first = setTimeout(run, 800); // let transactions load first so duplicate checks see them
    const onShow = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onShow);
    return () => { clearTimeout(first); document.removeEventListener("visibilitychange", onShow); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (busy) {
    return (
      <div className="toast" role="status" style={{ paddingRight: 16 }}>
        <LoaderCircle size={16} className="spin" /> Reading what you shared…
      </div>
    );
  }
  if (!result) return null;
  const close = () => set({ result: null });
  return (
    <Sheet title={result.saved.length ? `Logged ${result.saved.length === 1 ? inr(result.saved[0].amount) : `${result.saved.length} payments`}` : "Nothing new"} onClose={close}>
      <div className="stack">
        {result.saved.length > 0 && (
          <>
            <p className="small ink-2">Saved and marked <b>to review</b>. Tap one to fix or add details now, or check them later from Home.</p>
            <div className="card txn-list" style={{ padding: 4 }}>
              {result.saved.map((t) => <TxnRow key={t.id} t={t} onClick={() => { close(); openAdd({ editing: t }); }} />)}
            </div>
          </>
        )}
        {result.skipped > 0 && <div className="note">{result.skipped === 1 ? "One was" : `${result.skipped} were`} already logged (same UPI reference), so I skipped {result.skipped === 1 ? "it" : "them"}.</div>}
        {result.message && <div className="note">{result.message}</div>}
        <button className="btn btn-primary btn-block" onClick={close}>Done</button>
      </div>
    </Sheet>
  );
}

// Home banner for shares that are still waiting (offline, or the AI failed).
export function PendingShares() {
  const { pending, busy, error } = useShareState();
  const [, force] = useState(0);
  if (!pending.length || busy) return null;
  const retry = () => runner?.();
  return (
    <section className="card row" style={{ borderColor: "var(--warn)", gap: 12 }}>
      <span className="cat-ic"><Inbox size={16} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{pending.length === 1 ? "1 share" : `${pending.length} shares`} waiting to be read</div>
        <div className="tiny muted">{error || "Kosh needs a connection to read them."}</div>
      </div>
      <button className="icon-btn" aria-label="Try again" onClick={retry}><RotateCcw size={18} /></button>
      <button className="icon-btn" aria-label="Discard" onClick={async () => { for (const m of pending) await discard(m.id); set({ pending: [], error: "" }); force((n) => n + 1); }}>
        <Trash2 size={18} />
      </button>
    </section>
  );
}
