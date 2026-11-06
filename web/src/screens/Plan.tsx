import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { BillDue, billDraft, billState, billsIn, budgetRows, currentMonth, monthLabel, periodRange, summarize } from "../calc";
import { Bar, CatIcon, Empty, MonthPicker, Sheet, useToast } from "../components/ui";
import { useData } from "../data";
import { inr, inrShort, ordinal, parseAmount } from "../format";
import { BILL_KINDS, Bill, CATEGORIES, FREQUENCIES } from "../model";
import { useShell } from "../shell";

export function Plan() {
  const { period, setMonth, cycles } = useData();
  const [view, setView] = useState<"budget" | "bills">("budget");
  return (
    <div className="stack">
      <div className="topbar">
        <div><h1>Plan</h1><div className="sub">{monthLabel(period.key)}{cycles.payday ? ` · ${periodRange(period)}` : ""}</div></div>
        <MonthPicker period={period} setMonth={setMonth} payday={cycles.payday} />
      </div>
      <div className="seg" style={{ maxWidth: 360 }}>
        <button aria-pressed={view === "budget"} onClick={() => setView("budget")}>Budget</button>
        <button aria-pressed={view === "bills"} onClick={() => setView("bills")}>Bills & subscriptions</button>
      </div>
      {view === "budget" ? <Budget /> : <Bills />}
    </div>
  );
}

function Budget() {
  const { settings, txns, period, saveSettings } = useData();
  const s = useMemo(() => summarize(txns, period), [txns, period]);
  const rows = budgetRows(settings, s);
  const planned = rows.reduce((n, r) => n + r.planned, 0);
  const spentPlanned = rows.filter((r) => r.planned > 0).reduce((n, r) => n + r.spent, 0);
  const unplanned = s.spent - spentPlanned;

  const setPlanned = (category: string, v: number) => {
    if ((settings.budgets[category] || 0) === v) return;
    saveSettings({ budgets: { ...settings.budgets, [category]: v } });
  };

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-h"><h2>Categories</h2><span className="tiny muted">Tap a limit to change it</span></div>
        {rows.map((r) => (
          <div className="budget-row" key={r.category}>
            <div className="row">
              <span className="cat-ic"><CatIcon category={r.category} size={16} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row-between">
                  <span className="ellipsis" style={{ fontWeight: 500 }}>{r.category}</span>
                  <span className="small"><b>{inr(r.spent)}</b></span>
                </div>
                <div className="row-between tiny muted" style={{ marginTop: 2 }}>
                  <span>
                    {r.status === "unset" ? "No limit" : r.status === "over"
                      ? <span className="neg">{inr(-r.remaining!)} over</span>
                      : `${inr(r.remaining!)} left`}
                  </span>
                  <label className="row" style={{ gap: 4 }}>
                    of
                    <input data-money className="planned" inputMode="numeric" aria-label={`${r.category} limit`}
                      defaultValue={r.planned ? r.planned.toLocaleString("en-IN") : ""} placeholder="Set limit" key={r.planned}
                      onBlur={(e) => setPlanned(r.category, parseAmount(e.target.value))}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                  </label>
                </div>
              </div>
            </div>
            {r.planned > 0 && <div style={{ marginTop: 8, marginLeft: 44 }}><Bar value={r.spent} max={r.planned} tone={r.status === "over" ? "over" : r.status === "near" ? "near" : ""} /></div>}
          </div>
        ))}
      </section>

      <div className="stack">
        <section className="card">
          <div className="card-h"><h2>Month total</h2></div>
          <div className="money" style={{ fontSize: 40 }}>{inr(s.spent)}</div>
          <div className="small muted" style={{ marginTop: 6 }}>spent of {inr(planned)} planned</div>
          <div style={{ margin: "14px 0 8px" }}><Bar value={spentPlanned} max={planned} tone={spentPlanned > planned ? "over" : ""} /></div>
          {unplanned > 0 && <div className="tiny muted">{inr(unplanned)} went to categories without a limit.</div>}
        </section>
        <section className="card">
          <div className="card-h"><h2>Savings target</h2></div>
          <div className="row-between">
            <div><span className="money" style={{ fontSize: 30 }}>{inr(s.saved)}</span> <span className="muted small">of {inr(settings.savingsTarget)}</span></div>
            <span className={`pill ${s.saved >= settings.savingsTarget ? "ok" : ""}`}>{s.saved >= settings.savingsTarget ? "Hit" : `${inrShort(settings.savingsTarget - s.saved)} to go`}</span>
          </div>
          <div style={{ marginTop: 12 }}><Bar value={s.saved} max={settings.savingsTarget} /></div>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Savings sit apart from spending limits. Transfers tagged Emergency, Flexibility, Bike savings or Investing count here.
          </p>
        </section>
        <p className="tiny muted" style={{ padding: "0 4px" }}>
          A blank limit means "not budgeted yet", not an overspend. Set realistic limits after one month of real spending.
        </p>
      </div>
    </div>
  );
}

function Bills() {
  const { bills, period, markBill, acc } = useData();
  const { openAdd } = useShell();
  const [editing, setEditing] = useState<Partial<Bill> | null>(null);
  const dues = billsIn(bills, period);
  const notDue = bills.filter((b) => !dues.some((d) => d.bill.id === b.id));

  const pill = (d: BillDue) => {
    const st = billState(d);
    if (st === "paid") return <span className="pill ok">Paid</span>;
    if (st === "scheduled") return <span className="pill">Scheduled</span>;
    if (st === "overdue") return <span className="pill bad">Overdue</span>;
    if (st === "auto") return <span className="pill">Auto-debit</span>;
    return <span className="pill warn">To pay</span>;
  };

  const row = (b: Bill, d?: BillDue) => {
    const day = d?.due ? Number(d.due.slice(8)) : b.dueDay;
    return (
      <div className="bill" key={b.id + (d?.mark ?? "")}>
        <div className="day">{day ? <><b>{day}</b><small>{ordinal(day).slice(-2)}</small></> : <small>—</small>}</div>
        <button className="bill-main" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}>
          <div className="ellipsis" style={{ fontWeight: 500 }}>{b.name}</div>
          <div className="row tiny muted" style={{ gap: 6, marginTop: 3 }}>
            {d && pill(d)}
            <span className="ellipsis">{b.amount ? inr(b.amount) : "Varies"} · {b.payFrom}{b.kind === "Credit Card" && b.payTo ? ` → ${b.payTo}` : ""}{b.frequency !== "Monthly" ? ` · ${b.frequency}` : ""}{b.autoDebit === "Yes" ? " · auto" : ""}</span>
          </div>
        </button>
        {!d ? <span /> : billState(d) === "paid" ? (
          <button className="btn btn-ghost small" onClick={() => markBill(b, d.mark, null)}>Undo</button>
        ) : (
          <button className="btn small" style={{ padding: "6px 10px" }}
            onClick={() => openAdd({ draft: billDraft(acc, d), title: `Pay ${b.name}`, onSaved: () => markBill(b, d.mark, "Paid") })}>Mark paid</button>
        )}
      </div>
    );
  };

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-h">
          <h2>Due {periodRange(period)}</h2>
          <button className="link" onClick={() => setEditing({})}><Plus size={14} /> Add bill</button>
        </div>
        {dues.length === 0 ? <Empty icon={<CalendarClock size={20} />}><p>No bills due this month.</p></Empty> : dues.map((d) => row(d.bill, d))}
        {notDue.length > 0 && (
          <>
            <div className="label" style={{ margin: "18px 0 4px" }}>Not due this month</div>
            {notDue.map((b) => row(b))}
          </>
        )}
      </section>
      <div className="stack">
        <section className="card">
          <div className="card-h"><h2>Card bill rule</h2></div>
          <p className="small ink-2">
            Card purchases already count as spending. Paying the card bill is a <b>Transfer</b> from your bank to the card, so it
            never counts twice. Pay the full statement balance.
          </p>
        </section>
        <p className="tiny muted" style={{ padding: "0 4px" }}>
          “Mark paid” logs the payment as a transaction and ticks the bill off. Tap a bill to edit it; add due days so Kosh can warn you before they land.
        </p>
      </div>
      {editing && <BillForm bill={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BillForm({ bill, onClose }: { bill: Partial<Bill>; onClose: () => void }) {
  const { saveBill, deleteBill, acc } = useData();
  const toast = useToast();
  const [b, setB] = useState<Omit<Bill, "id"> & { id?: string }>({
    name: "", kind: "Subscription", dueDay: null, amount: 0, payFrom: acc.primary, autoDebit: "Yes", frequency: "Monthly",
    anchor: currentMonth(), category: "Subscriptions", notes: "", marks: {}, ...bill,
    ...(bill.kind === "Credit Card" && !bill.payTo ? { payTo: acc.cards[0] } : {}),
  });
  const [err, setErr] = useState("");
  const set = (p: Partial<Bill>) => setB({ ...b, ...p });
  const kindCategory: Record<string, string> = {
    EMI: "Other EMIs", Subscription: "Subscriptions", Insurance: "Insurance", Utility: "Rent & utilities", Other: "Miscellaneous",
    "Credit Card": "Credit card payment",
  };
  const withCurrent = (list: string[], v?: string) => (v && !list.includes(v) ? [...list, v] : list);

  const save = () => {
    if (!b.name.trim()) return setErr("Give it a name.");
    if (b.dueDay != null && (b.dueDay < 1 || b.dueDay > 31)) return setErr("Due day is 1 to 31.");
    if (b.kind === "Credit Card" && !b.payTo) return setErr("Which card does this bill pay off?");
    saveBill({ ...b, name: b.name.trim() });
    toast({ text: "Bill saved" });
    onClose();
  };

  return (
    <Sheet title={bill.id ? "Edit bill" : "New bill"} onClose={onClose}>
      <div className="stack">
        <label className="field"><span className="label">Name</span>
          <input className="input" autoFocus={!bill.id} placeholder="e.g. Netflix, Electricity, Car loan" value={b.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="fields-2">
          <label className="field"><span className="label">Kind</span>
            <select className="select" value={b.kind} onChange={(e) => {
              const kind = e.target.value as Bill["kind"];
              set({ kind, category: kindCategory[kind], ...(kind === "Credit Card" ? { payTo: b.payTo || acc.cards[0] } : {}) });
            }}>
              {BILL_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Typical amount ₹</span>
            <input data-money className="input" inputMode="decimal" defaultValue={b.amount || ""} placeholder="Varies" onChange={(e) => set({ amount: parseAmount(e.target.value) })} />
          </label>
          <label className="field"><span className="label">Due day</span>
            <input className="input" inputMode="numeric" placeholder="1–31" defaultValue={b.dueDay ?? ""}
              onChange={(e) => set({ dueDay: e.target.value.trim() ? parseInt(e.target.value, 10) || null : null })} />
          </label>
          <label className="field"><span className="label">Pay from</span>
            <select className="select" value={b.payFrom} onChange={(e) => set({ payFrom: e.target.value })}>
              {withCurrent(b.kind === "Credit Card" ? acc.money : acc.own, b.payFrom).map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          {b.kind === "Credit Card" && (
            <label className="field"><span className="label">Card it pays</span>
              <select className="select" value={b.payTo || ""} onChange={(e) => set({ payTo: e.target.value })}>
                {!b.payTo && <option value="">Pick a card</option>}
                {withCurrent(acc.cards, b.payTo).map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
          )}
          <label className="field"><span className="label">Frequency</span>
            <select className="select" value={b.frequency} onChange={(e) => set({ frequency: e.target.value as Bill["frequency"] })}>
              {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Auto-debit?</span>
            <select className="select" value={b.autoDebit} onChange={(e) => set({ autoDebit: e.target.value as Bill["autoDebit"] })}>
              {["Yes", "No", "Check"].map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          {b.frequency !== "Monthly" && (
            <label className="field"><span className="label">{b.frequency === "One-off" ? "Due month" : "A month it's due"}</span>
              <input className="input" type="month" value={b.anchor} onChange={(e) => set({ anchor: e.target.value })} />
            </label>
          )}
          {b.kind !== "Credit Card" && (
            <label className="field"><span className="label">Logs as</span>
              <select className="select" value={b.category} onChange={(e) => set({ category: e.target.value })}>
                {CATEGORIES.Expense.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="field"><span className="label">Notes</span>
          <input className="input" value={b.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn btn-primary btn-block" onClick={save}>Save bill</button>
        {bill.id && (
          <button className="btn btn-ghost btn-danger btn-block" onClick={() => { deleteBill(bill.id!); toast({ text: "Bill removed" }); onClose(); }}>
            <Trash2 size={16} /> Remove bill
          </button>
        )}
      </div>
    </Sheet>
  );
}
