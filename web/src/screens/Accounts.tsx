import { Archive, ArchiveRestore, Brain, ChevronDown, Download, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { balances, owed, periodRange, utilisation } from "../calc";
import { Bar, Sheet, useToast } from "../components/ui";
import { useData } from "../data";
import { inr, inrShort, parseAmount } from "../format";
import { Account, AccountKind, CATEGORIES, EXTERNAL, KIND_LABEL, MerchantRule, Person, newAccount } from "../model";

const GUIDE: [string, string, string][] = [
  ["Salary credited", "Income · into your salary account", "Salary"],
  ["Money from parents / side gig", "Income · into the account it landed in", "Family support · Side income"],
  ["Grocery purchase by UPI", "Expense · from the bank that paid", "Groceries"],
  ["Restaurant on a credit card", "Expense · from the card", "Food & dining"],
  ["Moving money to save", "Transfer · bank → reserve account", "Emergency / Flexibility savings"],
  ["Sending money for an EMI", "Transfer · bank → the EMI account", "Loan funding"],
  ["The EMI itself", "Expense · from the EMI account", "Education loan EMI / Other EMIs"],
  ["Paying a card bill", "Transfer · bank → the card", "Credit card payment"],
];

export function Accounts() {
  const { settings, txns, bills, saveSettings, user, logout } = useData();
  const bal = useMemo(() => balances(settings, txns), [settings, txns]);
  const [editing, setEditing] = useState<{ account: Account; isNew: boolean } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = settings.accounts.filter((a) => !a.archived);
  const archived = settings.accounts.filter((a) => a.archived);

  const exportCsv = () => {
    const head = ["Date", "Type", "From", "To", "Category", "Description", "Amount", "Notes", "UPI ref"];
    const rows = [...txns].reverse().map((t) => [t.date, t.type, t.from, t.to, t.category, t.description, t.amount, t.notes, t.ref || ""]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `kosh-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const card = (a: Account) => {
    const isCard = a.kind === "card";
    const v = bal[a.name] ?? 0;
    const due = owed(bal, a.name);
    const u = isCard ? utilisation(a.limit, due) : null;
    return (
      <section className="card" key={a.name} style={a.archived ? { opacity: 0.65 } : undefined}>
        <div className="row-between">
          <div style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600, fontSize: 17 }}>{a.name}</div>
            <div className="small muted">{KIND_LABEL[a.kind]}{a.role && a.role.toLowerCase() !== KIND_LABEL[a.kind].toLowerCase() ? ` · ${a.role}` : ""}</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <div className="right">
              <div className={`money ${isCard && due > 0 ? "neg" : ""}`} style={{ fontSize: 26 }}>{isCard ? inr(due) : inr(v)}</div>
              <div className="tiny muted">{isCard ? "owed" : "now"}</div>
            </div>
            <button className="icon-btn" aria-label={`Edit ${a.name}`} onClick={() => setEditing({ account: a, isNew: false })}><Pencil size={16} /></button>
          </div>
        </div>
        {isCard && (u ? (
          <div style={{ marginTop: 12 }}>
            <Bar value={due} max={a.limit} tone={u.tone} />
            <div className="row-between tiny muted" style={{ marginTop: 6 }}>
              <span><span className={`util ${u.tone}`}>{u.pct < 1 && u.pct > 0 ? "<1" : Math.round(u.pct)}% used</span> of {inr(a.limit)} limit</span>
              <span>{inrShort(Math.max(0, a.limit - due))} available</span>
            </div>
          </div>
        ) : <p className="tiny muted" style={{ marginTop: 8 }}>Add the card's limit to track how much of it you're using.</p>)}
        {!isCard && a.goal > 0 && (
          <div style={{ marginTop: 12 }}>
            <Bar value={v} max={a.goal} />
            <div className="tiny muted" style={{ marginTop: 6 }}>{inr(v)} of {inr(a.goal)} goal</div>
          </div>
        )}
        {a.guidance && <p className="small ink-2" style={{ marginTop: 10 }}>{a.guidance}</p>}
      </section>
    );
  };

  return (
    <div className="stack">
      <div className="topbar">
        <div><h1>Accounts & settings</h1><div className="sub">Banks, cards, goals, months and how Kosh reads your payments</div></div>
      </div>

      <div className="grid-2">
        <div className="stack">
          {active.map(card)}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setEditing({ account: newAccount("bank"), isNew: true })}><Plus size={16} /> Bank account</button>
            <button className="btn" onClick={() => setEditing({ account: newAccount("card"), isNew: true })}><Plus size={16} /> Credit card</button>
            <button className="btn" onClick={() => setEditing({ account: newAccount("cash", "Cash"), isNew: true })}><Plus size={16} /> Cash</button>
          </div>
          {archived.length > 0 && (
            <>
              <button className="link small" style={{ background: "none", border: 0, color: "var(--ink-2)", textAlign: "left", padding: 4 }} onClick={() => setShowArchived(!showArchived)}>
                <ChevronDown size={14} style={{ verticalAlign: -2, transform: showArchived ? "rotate(180deg)" : undefined }} /> {archived.length} archived
              </button>
              {showArchived && archived.map(card)}
            </>
          )}
        </div>

        <div className="stack">
          <CycleSettings />

          <section className="card">
            <div className="card-h"><h2>Monthly savings target</h2></div>
            <input data-money className="input" inputMode="numeric" aria-label="Monthly savings target" defaultValue={settings.savingsTarget} key={settings.savingsTarget}
              onBlur={(e) => { const n = parseAmount(e.target.value); if (n !== settings.savingsTarget) saveSettings({ savingsTarget: n }); }} />
            <p className="tiny muted" style={{ marginTop: 8 }}>A goal is not "money safe to spend". Reserve accounts still need to cover EMIs and minimum balances.</p>
          </section>

          <MemoryCard />

          <section className="card">
            <div className="card-h"><h2>Teach Kosh</h2></div>
            <p className="tiny muted" style={{ marginBottom: 10 }}>
              Rules the AI follows when it reads your screenshots, SMS and messages. Plain English, one per line.
              E.g. “Payments from Rakesh Khajuria are from Dad → Family support”, “Rapido is Fuel & commute”.
            </p>
            <textarea className="textarea" style={{ minHeight: 150, fontSize: 14 }} defaultValue={settings.aiNotes} key={settings.aiNotes}
              aria-label="Rules for the AI"
              onBlur={(e) => { if (e.target.value !== settings.aiNotes) saveSettings({ aiNotes: e.target.value }); }} />
          </section>

          <section className="card">
            <div className="card-h"><h2>How to log money</h2></div>
            <table className="guide-table">
              <tbody>
                {GUIDE.map(([e, how, cat]) => (
                  <tr key={e}><td>{e}</td><td className="ink-2">{how}<div className="tiny muted">{cat}</div></td></tr>
                ))}
              </tbody>
            </table>
            <p className="tiny muted" style={{ marginTop: 12 }}>Amounts are always positive; the type and accounts set the direction. Income covers anything that adds to what you can spend: salary, side gigs, family support, gifts, interest, refunds.</p>
          </section>

          <section className="card">
            <div className="card-h"><h2>Data & sign-in</h2></div>
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn" onClick={exportCsv} disabled={!txns.length}><Download size={16} /> Export transactions (CSV)</button>
              <div className="row-between small">
                <span className="muted ellipsis">Signed in as {user?.email}</span>
                <button className="btn btn-ghost" onClick={logout}><LogOut size={16} /> Sign out</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {editing && (
        <AccountForm account={editing.account} isNew={editing.isNew} inUse={txns.some((t) => t.from === editing.account.name || t.to === editing.account.name) || bills.some((b) => b.payFrom === editing.account.name || b.payTo === editing.account.name)}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function CycleSettings() {
  const { settings, saveSettings, period } = useData();
  const c = settings.cycle;
  return (
    <section className="card">
      <div className="card-h"><h2>Months run</h2></div>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button aria-pressed={c.mode === "payday"} onClick={() => saveSettings({ cycle: { ...c, mode: "payday" } })}>Payday to payday</button>
        <button aria-pressed={c.mode === "calendar"} onClick={() => saveSettings({ cycle: { ...c, mode: "calendar" } })}>1st to 31st</button>
      </div>
      {c.mode === "payday" ? (
        <>
          <p className="small ink-2">
            Each month starts the day your <b>salary</b> lands and is named after the month it pays for. Salary on 30 Oct starts “November”.
          </p>
          <label className="row small" style={{ marginTop: 12, gap: 10 }}>
            <span className="grow ink-2">Usual payday (used until this month's salary is logged)</span>
            <input className="input" style={{ width: 72, textAlign: "center" }} inputMode="numeric" defaultValue={c.paydayDay} key={c.paydayDay}
              aria-label="Usual payday"
              onBlur={(e) => { const n = Math.min(31, Math.max(1, parseInt(e.target.value, 10) || c.paydayDay)); if (n !== c.paydayDay) saveSettings({ cycle: { ...c, paydayDay: n } }); }} />
          </label>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            This month: {periodRange(period)}{period.estimated ? " (estimated from your usual payday)" : " (from your logged salary)"}.
          </p>
        </>
      ) : <p className="small ink-2">Plain calendar months. Salary credited on the 30th counts in the month it arrived.</p>}
    </section>
  );
}

function AccountForm({ account, isNew, inUse, onClose }: { account: Account; isNew: boolean; inUse: boolean; onClose: () => void }) {
  const { settings, saveSettings, renameAccount } = useData();
  const toast = useToast();
  const [a, setA] = useState<Account>(account);
  // Cards: ask for "owed at start" as a positive number; stored as a negative opening balance.
  const [openingText, setOpeningText] = useState(() => {
    const v = account.kind === "card" ? -account.opening : account.opening;
    return v ? String(v) : "";
  });
  const [err, setErr] = useState("");
  const set = (p: Partial<Account>) => setA({ ...a, ...p });
  const isCard = a.kind === "card";

  const save = async () => {
    const name = a.name.trim();
    if (!name) return setErr("Give it a name.");
    if (name.toLowerCase() === EXTERNAL.toLowerCase()) return setErr(`"${EXTERNAL}" is reserved.`);
    if (settings.accounts.some((x) => x.name !== account.name && x.name.toLowerCase() === name.toLowerCase())) return setErr("You already have an account with that name.");
    const n = parseAmount(openingText);
    const next: Account = { ...a, name, opening: isCard ? -Math.abs(n) : n, goal: isCard ? 0 : a.goal, limit: isCard ? a.limit : 0 };
    if (isNew) {
      await saveSettings({ accounts: [...settings.accounts, next] });
    } else {
      if (name !== account.name) await renameAccount(account.name, name);
      await saveSettings({ accounts: settings.accounts.map((x) => (x.name === account.name ? next : x)) });
    }
    toast({ text: isNew ? `${name} added` : "Saved" });
    onClose();
  };

  const setArchived = async (archived: boolean) => {
    await saveSettings({ accounts: settings.accounts.map((x) => (x.name === account.name ? { ...x, archived } : x)) });
    toast({ text: archived ? `${account.name} archived` : `${account.name} restored` });
    onClose();
  };

  const remove = async () => {
    await saveSettings({ accounts: settings.accounts.filter((x) => x.name !== account.name) });
    toast({ text: `${account.name} removed` });
    onClose();
  };

  return (
    <Sheet title={isNew ? `New ${KIND_LABEL[a.kind].toLowerCase()}` : `Edit ${account.name}`} onClose={onClose}>
      <div className="stack">
        <label className="field"><span className="label">Name</span>
          <input className="input" autoFocus={isNew} value={a.name} placeholder={isCard ? "e.g. HDFC Millennia" : "e.g. SBI Savings"} onChange={(e) => set({ name: e.target.value })} />
        </label>
        {!isNew && a.name.trim() !== account.name && inUse && <div className="note">Renaming updates every transaction and bill that uses “{account.name}”.</div>}
        <div className="fields-2">
          <label className="field"><span className="label">Type</span>
            <select className="select" value={a.kind} onChange={(e) => set({ kind: e.target.value as AccountKind })} disabled={!isNew && inUse}>
              {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Role</span>
            <input className="input" value={a.role} placeholder={isCard ? "e.g. Daily spends" : "e.g. Emergency reserve"} onChange={(e) => set({ role: e.target.value })} />
          </label>
          <label className="field"><span className="label">{isCard ? "Owed when you started" : "Opening balance"}</span>
            <input data-money className="input" inputMode="decimal" value={openingText} placeholder="0" onChange={(e) => setOpeningText(e.target.value)} />
          </label>
          {isCard ? (
            <label className="field"><span className="label">Credit limit</span>
              <input data-money className="input" inputMode="decimal" defaultValue={a.limit || ""} placeholder="e.g. 150000" onChange={(e) => set({ limit: parseAmount(e.target.value) })} />
            </label>
          ) : (
            <label className="field"><span className="label">Balance goal</span>
              <input data-money className="input" inputMode="decimal" defaultValue={a.goal || ""} placeholder="No goal" onChange={(e) => set({ goal: parseAmount(e.target.value) })} />
            </label>
          )}
        </div>
        <label className="field"><span className="label">How it shows in UPI apps & SMS</span>
          <input className="input" value={a.hints} placeholder={isCard ? "e.g. card ending 4521, HDFC Bank Credit Card" : "e.g. Kotak Mahindra Bank, a/c ending 1234, name@okicici"}
            onChange={(e) => set({ hints: e.target.value })} />
        </label>
        <p className="tiny muted" style={{ marginTop: -6 }}>Bank name, last 4 digits, UPI ID. Helps Kosh match screenshots to this account.</p>
        <label className="field"><span className="label">Note to self</span>
          <input className="input" value={a.guidance} placeholder="Optional, e.g. keep ₹20k minimum balance" onChange={(e) => set({ guidance: e.target.value })} />
        </label>
        <p className="tiny muted" style={{ marginTop: -6 }}>
          Opening balance = what it held before your first logged transaction. Changing it shifts every month.
        </p>
        {err && <div className="error">{err}</div>}
        <button className="btn btn-primary btn-block" onClick={save}>{isNew ? "Add" : "Save"}</button>
        {!isNew && (account.archived ? (
          <button className="btn btn-block" onClick={() => setArchived(false)}><ArchiveRestore size={16} /> Restore</button>
        ) : inUse ? (
          <button className="btn btn-ghost btn-block" onClick={() => setArchived(true)}><Archive size={16} /> Archive (closed account)</button>
        ) : (
          <button className="btn btn-ghost btn-danger btn-block" onClick={remove}><Trash2 size={16} /> Remove</button>
        ))}
        {!isNew && inUse && !account.archived && <p className="tiny muted" style={{ marginTop: -6, textAlign: "center" }}>Archived accounts keep their history but leave pickers and Home.</p>}
      </div>
    </Sheet>
  );
}

// What Kosh has learned from your corrections and confirmations, editable.
function MemoryCard() {
  const { settings, saveSettings } = useData();
  const [open, setOpen] = useState(false);
  const people = settings.people;
  const merchants = settings.merchants;
  const setPeople = (next: Person[]) => saveSettings({ people: next });
  const setMerchants = (next: MerchantRule[]) => saveSettings({ merchants: next });
  const total = people.length + merchants.length;
  const shown = open ? Infinity : 6;

  return (
    <section className="card">
      <div className="card-h"><h2><Brain size={13} style={{ verticalAlign: -2 }} /> Kosh remembers</h2><span className="tiny muted">{total || ""}</span></div>
      <p className="tiny muted" style={{ marginBottom: 12 }}>
        Learned when you correct a category or confirm who someone is. Applied to every new share and message.
      </p>

      <div className="label" style={{ marginBottom: 6 }}>People</div>
      {people.length === 0 && <p className="small muted" style={{ marginBottom: 8 }}>Nobody yet. Confirm a payment from family, or split a bill with a friend.</p>}
      {people.slice(0, shown).map((p, i) => (
        <div className="mem-row person" key={`${p.name}-${i}`}>
          <input className="input" aria-label="Name" defaultValue={p.name} placeholder="Name"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) setPeople(people.map((x, j) => (j === i ? { ...x, name: v } : x))); }} />
          <select className="select" aria-label={`${p.name} is`} value={p.group}
            onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, group: e.target.value as Person["group"] } : x)))}>
            <option value="family">Family</option><option value="friend">Friend</option><option value="other">Other</option>
          </select>
          <input className="input" aria-label={`${p.name}'s relation`} defaultValue={p.relation} placeholder={p.group === "family" ? "e.g. Mother" : "e.g. Flatmate"}
            onBlur={(e) => { if (e.target.value !== p.relation) setPeople(people.map((x, j) => (j === i ? { ...x, relation: e.target.value.trim() } : x))); }} />
          <button className="icon-btn" aria-label={`Forget ${p.name}`} onClick={() => setPeople(people.filter((_, j) => j !== i))}><X size={16} /></button>
        </div>
      ))}
      <button className="chip" style={{ margin: "4px 0 16px" }} onClick={() => { setPeople([...people, { name: "New person", group: "family", relation: "" }]); setOpen(true); }}>
        <Plus size={14} /> Person
      </button>

      <div className="label" style={{ marginBottom: 6 }}>Merchants</div>
      {merchants.length === 0 && <p className="small muted">None yet. Change a payment's category and Kosh will use it for that merchant from then on.</p>}
      {merchants.slice(0, shown).map((m, i) => (
        <div className="mem-row merchant" key={`${m.name}-${m.type}-${i}`}>
          <input className="input" aria-label="Merchant name" defaultValue={m.name} placeholder="Merchant as it appears"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) setMerchants(merchants.map((x, j) => (j === i ? { ...x, name: v } : x))); }} />
          <select className="select" aria-label={`${m.name} category`} value={m.category}
            onChange={(e) => setMerchants(merchants.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>
            {CATEGORIES[m.type].map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="icon-btn" aria-label={`Forget ${m.name}`} onClick={() => setMerchants(merchants.filter((_, j) => j !== i))}><X size={16} /></button>
        </div>
      ))}
      <button className="chip" style={{ marginTop: 4 }} onClick={() => { setMerchants([...merchants, { name: "New merchant", type: "Expense", category: "Miscellaneous" }]); setOpen(true); }}>
        <Plus size={14} /> Merchant
      </button>
      {!open && (people.length > 6 || merchants.length > 6) && (
        <button className="link small" style={{ background: "none", border: 0, color: "var(--ink-2)", padding: "8px 0 0" }} onClick={() => setOpen(true)}>Show all</button>
      )}
    </section>
  );
}
