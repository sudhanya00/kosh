import { ArrowUp, Check, ImagePlus, Info, LoaderCircle, PenLine, Trash2, X } from "lucide-react";
import { ClipboardEvent, useMemo, useRef, useState } from "react";
import { Img, parseWithAI, shrink } from "../ai";
import { useData } from "../data";
import { inr } from "../format";
import { Draft, Txn, emptyDraft, validate } from "../model";
import { Learned, learnFromConfirm, learnFromEdit, memKey } from "../memory";
import { TxnForm } from "./TxnForm";
import { CatIcon, Sheet, useToast } from "./ui";

export interface AddRequest {
  draft?: Draft; // open straight into the form, prefilled
  editing?: Txn; // edit an existing transaction
  title?: string;
  onSaved?: () => void;
}

const EXAMPLES = [
  "450 swiggy on the axis card yesterday",
  "Salary 85,000 came into Kotak today",
  "Moved 20k to PNB for savings, and 8k for the EMI",
  "Paste a bank SMS, or add UPI screenshots",
];

export function AddSheet({ req, onClose }: { req: AddRequest; onClose: () => void }) {
  const { addTxns, updateTxn, confirmTxn, deleteTxn, restoreTxn, txns, settings, saveSettings, user, acc } = useData();
  const toast = useToast();
  const [manual, setManual] = useState<Draft | null>(req.editing ?? req.draft ?? null);
  const [text, setText] = useState("");
  const [images, setImages] = useState<Img[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [drafts, setDrafts] = useState<(Draft & { _k: string; _orig: Pick<Draft, "type" | "category"> })[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const placeholder = useMemo(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)], []);

  const title = req.title ?? (req.editing ? (req.editing.review ? "Check this one" : "Edit transaction") : "Add money movement");

  async function attach(files: Blob[]) {
    setError("");
    try {
      const imgs = await Promise.all(files.slice(0, 5 - images.length).map(shrink));
      setImages((cur) => [...cur, ...imgs].slice(0, 5));
    } catch {
      setError("Couldn't read that image.");
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      attach(files);
    }
  }

  async function read() {
    if (!text.trim() && !images.length) return;
    setBusy(true);
    setError("");
    setAiNote("");
    try {
      const res = await parseWithAI({ settings, txns, user }, { text, images });
      const list = res.transactions.map((d) => ({ ...emptyDraft(acc, d.type), ...d, _k: crypto.randomUUID(), _orig: { type: d.type, category: d.category } }));
      setDrafts(list);
      setAiNote(res.message || (list.length ? "" : "Didn't find a transaction in that."));
      if (list.length) {
        setText("");
        setImages([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Save what was learned and say so; offer to apply a new merchant rule to earlier entries.
  function remember(learned: Learned, quiet = false) {
    const changed = learned.patch.people !== settings.people || learned.patch.merchants !== settings.merchants;
    if (!changed) return null;
    saveSettings(learned.patch);
    if (quiet || !learned.notes.length) return null;
    const rule = learned.patch.merchants !== settings.merchants ? learned.patch.merchants!.at(-1) : undefined;
    const others = rule ? txns.filter((t) => t.id !== req.editing?.id && t.type === rule.type && t.category !== rule.category && memKey(t.description) === memKey(rule.name)) : [];
    const prev = { people: settings.people, merchants: settings.merchants };
    return {
      text: `Kosh will remember: ${learned.notes.join(" · ")}`,
      action: others.length
        ? { label: `Fix ${others.length} earlier`, run: () => { others.forEach((t) => updateTxn(t.id, { ...t, category: rule!.category })); toast({ text: `Updated ${others.length}` }); } }
        : { label: "Undo", run: () => saveSettings(prev) },
    };
  }

  async function saveDrafts() {
    const bad = drafts.findIndex((d) => validate(acc, d));
    if (bad >= 0) return setError(`Row ${bad + 1}: ${validate(acc, drafts[bad])}`);
    const { saved, skipped } = await addTxns(drafts, "ai");
    // Rows you corrected teach merchant rules; everything you saved teaches who people are.
    let learned = learnFromConfirm(settings, drafts);
    for (const d of drafts) {
      const s2 = { ...settings, ...learned.patch } as typeof settings;
      const l = learnFromEdit(s2, { ...d, ...d._orig } as unknown as Txn, d);
      learned = { patch: { ...learned.patch, ...l.patch }, notes: [...learned.notes, ...l.notes.filter((n) => !learned.notes.includes(n))] };
    }
    const note = remember(learned);
    const base = (saved.length === 1 ? "Saved" : `Saved ${saved.length}`) + (skipped.length ? ` · ${skipped.length} already logged` : "");
    toast(note ? { ...note, text: `${base}. ${note.text}` } : { text: base });
    req.onSaved?.();
    onClose();
  }

  async function saveManual() {
    if (!manual) return;
    const err = validate(acc, manual);
    if (err) return setError(err);
    if (req.editing) await updateTxn(req.editing.id, manual);
    else await addTxns([manual], req.draft ? "bill" : "manual");
    const note = remember(req.editing ? learnFromEdit(settings, req.editing, manual) : learnFromConfirm(settings, [manual]), !req.editing);
    toast(note ?? { text: req.editing ? "Updated" : "Saved" });
    req.onSaved?.();
    onClose();
  }

  async function remove() {
    const t = req.editing!;
    await deleteTxn(t);
    toast({ text: "Deleted", action: { label: "Undo", run: () => restoreTxn(t) } });
    onClose();
  }

  // ---- Form mode (manual entry, prefilled or editing) ----
  if (manual) {
    const reviewing = req.editing?.review;
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="stack">
          {reviewing && <div className="note">Logged automatically from a share. Fix anything that's off, then save.</div>}
          <TxnForm draft={manual} onChange={(d) => { setManual(d); setError(""); }} autoFocus={!req.editing && !manual.amount} />
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary btn-block" onClick={saveManual}>
            {reviewing ? "Save & mark checked" : req.editing ? "Save changes" : `Save${manual.amount ? " " + inr(manual.amount) : ""}`}
          </button>
          {reviewing && (
            <button className="btn btn-block" onClick={() => {
              confirmTxn(req.editing!.id);
              toast(remember(learnFromConfirm(settings, [req.editing!])) ?? { text: "Marked as checked" });
              onClose();
            }}>
              <Check size={16} /> Looks right as is
            </button>
          )}
          {req.editing && (
            <button className="btn btn-ghost btn-danger btn-block" onClick={remove}><Trash2 size={16} /> Delete</button>
          )}
        </div>
      </Sheet>
    );
  }

  // ---- AI mode ----
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        {drafts.length === 0 && (
          <>
            <div className="ai-box">
              {images.length > 0 && (
                <div className="row" style={{ gap: 0, flexWrap: "wrap" }}>
                  {images.map((img, i) => (
                    <div className="thumb" key={i}>
                      <img src={img.url} alt={`Attachment ${i + 1}`} />
                      <button onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="Remove image"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              <textarea className="textarea" placeholder={placeholder} value={text} autoFocus
                onChange={(e) => setText(e.target.value)} onPaste={onPaste}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) read(); }} />
              <div className="bar-actions">
                <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Add photos or screenshots" title="UPI screenshots, receipts, SMS screenshots">
                  <ImagePlus size={20} />
                </button>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden
                  onChange={(e) => { attach(Array.from(e.target.files || [])); e.target.value = ""; }} />
                <span className="grow tiny muted">Type it like a text message. Several at once is fine.</span>
                <button className="send" onClick={read} disabled={busy || (!text.trim() && !images.length)} aria-label="Read it">
                  {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={18} />}
                </button>
              </div>
            </div>
            {busy && <><div className="shimmer" /><div className="shimmer" style={{ opacity: 0.6 }} /></>}
          </>
        )}

        {error && <div className="error">{error}</div>}
        {aiNote && <div className="note">{aiNote}</div>}

        {drafts.length > 0 && (
          <>
            <p className="small ink-2">Check these, fix anything, then save.</p>
            {drafts.map((d, i) => (
              <div className="draft" key={d._k}>
                <div className="row-between" style={{ marginBottom: 12 }}>
                  <div className="row small" style={{ gap: 8, minWidth: 0 }}>
                    <CatIcon category={d.category} size={16} />
                    <b className="ellipsis">{d.description || d.category}</b>
                  </div>
                  <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Remove"
                    onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}><X size={16} /></button>
                </div>
                <TxnForm compact draft={d} onChange={(nd) => { setDrafts(drafts.map((x, j) => (j === i ? { ...nd, _k: x._k, _orig: x._orig } : x))); setError(""); }} />
                {d.assumption && <div className="assume"><Info size={14} /> {d.assumption}</div>}
              </div>
            ))}
            <button className="btn btn-primary btn-block" onClick={saveDrafts}>
              Save {drafts.length === 1 ? inr(drafts[0].amount) : `${drafts.length} · ${inr(drafts.reduce((n, d) => n + d.amount, 0))}`}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setDrafts([])}>Start over</button>
          </>
        )}

        {drafts.length === 0 && (
          <>
            <div className="divider">or</div>
            <button className="btn btn-block" onClick={() => setManual(emptyDraft(acc))}><PenLine size={16} /> Fill it in yourself</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
