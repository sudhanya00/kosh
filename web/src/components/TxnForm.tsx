import { Plus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { friendBalances, knownPeople } from "../calc";
import { useData } from "../data";
import { inr, parseAmount } from "../format";
import { CATEGORIES, Draft, FRIENDS, REPAY, Share, TxnType, isRepayment, isWriteOff, myShare, retype, splitTotal } from "../model";

const TYPES: TxnType[] = ["Expense", "Income", "Transfer"];

export function TxnForm({ draft, onChange, autoFocus, compact }: {
  draft: Draft; onChange: (d: Draft) => void; autoFocus?: boolean; compact?: boolean;
}) {
  const { acc, txns } = useData();
  const [amountText, setAmountText] = useState(draft.amount ? String(draft.amount) : "");
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  // Keep an archived account selectable on old transactions that use it.
  const withCurrent = (list: string[], v: string) => (v && !list.includes(v) && v !== "External" && v !== FRIENDS ? [...list, v] : list);
  const repayment = isRepayment(draft);
  const writeOff = isWriteOff(draft);

  const setCategory = (category: string) => {
    if (draft.type === "Transfer" && category === REPAY) return set({ category, from: FRIENDS, person: draft.person || "" });
    if (draft.type === "Transfer" && repayment) return set({ category, from: acc.primary, person: null });
    set({ category });
  };

  return (
    <div className="stack" style={{ gap: compact ? 12 : 14 }}>
      <div className="seg" role="group" aria-label="Type">
        {TYPES.map((t) => (
          <button key={t} type="button" aria-pressed={draft.type === t} onClick={() => onChange(retype(acc, draft, t))}>{t}</button>
        ))}
      </div>

      {compact ? (
        <div className="fields-2">
          <label className="field">
            <span className="label">Amount ₹</span>
            <input className="input" inputMode="decimal" value={amountText}
              onChange={(e) => { setAmountText(e.target.value); set({ amount: parseAmount(e.target.value) }); }} />
          </label>
          <label className="field">
            <span className="label">Date</span>
            <input className="input" type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="amount-input">
          <span>₹</span>
          <input inputMode="decimal" placeholder="0" autoFocus={autoFocus} aria-label="Amount" value={amountText}
            onChange={(e) => { setAmountText(e.target.value); set({ amount: parseAmount(e.target.value) }); }} />
        </div>
      )}

      <label className="field">
        <span className="label">{draft.type === "Income" ? "Source / description" : "What was it?"}</span>
        <input className="input" placeholder={draft.type === "Income" ? "e.g. October salary" : draft.type === "Transfer" ? "e.g. Monthly savings" : "e.g. Swiggy, DMart, Uber"}
          value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </label>

      <div className="fields-2">
        {(repayment || writeOff) && (
          <label className="field">
            <span className="label">{repayment ? "Paid back by" : "Friend who didn't pay"}</span>
            <PersonInput value={draft.person || ""} onChange={(person) => set({ person })} />
          </label>
        )}
        {draft.type !== "Income" && !repayment && !writeOff && (
          <label className="field">
            <span className="label">{draft.type === "Expense" ? "Paid from" : "From"}</span>
            <select className="select" value={draft.from} onChange={(e) => set({ from: e.target.value })}>
              {withCurrent(acc.own, draft.from).map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
        )}
        {draft.type !== "Expense" && (
          <label className="field">
            <span className="label">{draft.type === "Income" || repayment ? "Received in" : "To"}</span>
            <select className="select" value={draft.to} onChange={(e) => set({ to: e.target.value })}>
              {withCurrent(draft.type === "Income" || repayment ? acc.money : acc.own, draft.to).map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">Category</span>
          <select className="select" value={draft.category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES[draft.type].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {!compact && (
          <label className="field">
            <span className="label">Date</span>
            <input className="input" type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
        )}
      </div>

      {repayment && <p className="tiny muted" style={{ marginTop: -4 }}>Getting your own money back: settles what they owe, not counted as income.</p>}
      {writeOff && <p className="tiny muted" style={{ marginTop: -4 }}>Their unpaid share becomes your spending. No bank balance changes.</p>}

      {draft.type === "Expense" && !writeOff && (
        <SplitEditor amount={draft.amount} split={draft.split || []} onChange={(split) => set({ split })} />
      )}

      {!compact && (
        <label className="field">
          <span className="label">Notes</span>
          <input className="input" placeholder="Optional" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      )}

      <PeopleList txns={txns} />
    </div>
  );
}

function PersonInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return <input className="input" list="kosh-people" placeholder="Name" value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />;
}

// Suggestions for friend names: everyone you've split with or been paid back by.
function PeopleList({ txns }: { txns: Parameters<typeof knownPeople>[0] }) {
  const people = useMemo(() => knownPeople(txns), [txns]);
  return <datalist id="kosh-people">{people.map((p) => <option key={p} value={p} />)}</datalist>;
}

function SplitEditor({ amount, split, onChange }: { amount: number; split: Share[]; onChange: (s: Share[]) => void }) {
  const { txns } = useData();
  // Amount boxes keep their own text so "1,2" mid-typing isn't reformatted; bumping `ver` resets them.
  const [ver, setVer] = useState(0);
  const owing = useMemo(() => friendBalances(txns).filter((f) => f.owed > 0).slice(0, 4).map((f) => f.person), [txns]);

  if (!split.length) {
    return (
      <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => onChange([{ person: "", amount: 0 }])}>
        <Users size={16} /> Split with friends
      </button>
    );
  }

  const mine = myShare({ type: "Expense", amount, split });
  const over = splitTotal({ split }) > amount + 0.001;
  const evenly = () => {
    const each = Math.floor(amount / (split.length + 1));
    onChange(split.map((x) => ({ ...x, amount: each })));
    setVer(ver + 1);
  };

  return (
    <div className="split">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="label">Split with</span>
        <button type="button" className="link small" onClick={() => onChange([])}>Remove split</button>
      </div>
      {split.map((x, i) => (
        <div className="split-row" key={`${i}-${ver}`}>
          <PersonInput value={x.person} autoFocus={!x.person && i === split.length - 1 && i > 0}
            onChange={(person) => onChange(split.map((y, j) => (j === i ? { ...y, person } : y)))} />
          <input className="input" inputMode="decimal" placeholder="₹ share" aria-label={`${x.person || "Friend"}'s share`} defaultValue={x.amount || ""}
            onChange={(e) => onChange(split.map((y, j) => (j === i ? { ...y, amount: parseAmount(e.target.value) } : y)))} />
          <button type="button" className="icon-btn" aria-label="Remove friend" onClick={() => { onChange(split.filter((_, j) => j !== i)); setVer(ver + 1); }}><X size={16} /></button>
        </div>
      ))}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <button type="button" className="chip" onClick={() => onChange([...split, { person: "", amount: 0 }])}><Plus size={14} /> Friend</button>
        <button type="button" className="chip" onClick={evenly} disabled={!(amount > 0)}>Split evenly ({split.length + 1} people)</button>
        {owing.filter((p) => !split.some((x) => x.person.trim().toLowerCase() === p.toLowerCase())).slice(0, 2).map((p) => (
          <button type="button" key={p} className="chip" onClick={() => { onChange([...split.filter((x) => x.person.trim()), { person: p, amount: 0 }]); setVer(ver + 1); }}><Plus size={14} /> {p}</button>
        ))}
      </div>
      <div className={`small ${over ? "neg" : "ink-2"}`} style={{ marginTop: 10 }}>
        {over ? "Friends' shares are more than the bill." : <>Your share <b>{inr(mine)}</b> · friends owe you <b>{inr(splitTotal({ split }))}</b></>}
      </div>
    </div>
  );
}
