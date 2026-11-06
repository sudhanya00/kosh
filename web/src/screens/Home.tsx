import { ArrowRight, CalendarClock, Check, Inbox, LoaderCircle, MessageCircle, Receipt, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import {
  balances, billDraft, billState, billsIn, budgetRows, cashTotal, daysUntil, friendBalances, inPeriod, monthLabel, owed,
  paydaySteps, periodRange, repaymentDraft, summarize, utilisation, writeOffDraft,
} from "../calc";
import { TxnRow } from "../components/TxnRow";
import { Bar, CatIcon, Empty, Markdown, MonthPicker, useToast } from "../components/ui";
import { useData } from "../data";
import { callAI } from "../firebase";
import { greeting, inr, inrShort, ordinal } from "../format";
import { emptyDraft, todayISO } from "../model";
import { learnFromConfirm } from "../memory";
import { PendingShares } from "../share";
import { useShell } from "../shell";

const insightCache: Record<string, string> = {};

export function Home() {
  const { settings, acc, txns, bills, period, isCurrent, setMonth, markBill, confirmTxn, cycles, user, saveSettings } = useData();
  const { openAdd, go } = useShell();
  const toast = useToast();
  const s = useMemo(() => summarize(txns, period), [txns, period]);
  const bal = useMemo(() => balances(settings, txns), [settings, txns]);
  const dues = useMemo(() => billsIn(bills, period), [bills, period]);
  const steps = paydaySteps(settings, acc, txns, period, s, dues);
  const firstName = user?.displayName?.split(" ")[0];
  const toReview = txns.filter((t) => t.review);

  const dueBills = dues.map((d) => ({ d, state: billState(d), days: daysUntil(d.due) })).filter((x) => x.state !== "paid").slice(0, 4);
  const cats = budgetRows(settings, s).filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 6);
  const recent = txns.filter((t) => inPeriod(t, period)).slice(0, 5);
  const incomeKinds = Object.entries(s.incomeBy).sort((a, b) => b[1] - a[1]);
  const active = settings.accounts.filter((a) => !a.archived);
  const friends = useMemo(() => friendBalances(txns), [txns]);
  const friendsOwe = friends.reduce((n, f) => n + Math.max(0, f.owed), 0);

  const base = Math.max(s.income, s.spent + s.saved, 1);
  const flow = [
    { k: "Spent", v: s.spent, c: "#ef9a82" },
    { k: "Saved", v: s.saved, c: "#86d0a8" },
    { k: "Left", v: Math.max(0, s.available), c: "rgba(255,255,255,0.32)" },
  ];

  return (
    <div className="stack">
      <div className="hello">
        <div>
          <div className="muted small">{greeting()}{firstName ? `, ${firstName}` : ""}</div>
          <h1>{isCurrent ? "This month" : monthLabel(period.key)}</h1>
        </div>
        <MonthPicker period={period} setMonth={setMonth} payday={cycles.payday} />
      </div>

      <PendingShares />

      {toReview.length > 0 && (
        <section className="card" style={{ paddingInline: 8, borderColor: "var(--warn)" }}>
          <div className="card-h" style={{ paddingInline: 10 }}>
            <h2 style={{ color: "var(--warn)" }}><Inbox size={13} style={{ verticalAlign: -2 }} /> To review · {toReview.length}</h2>
            <button className="link" onClick={() => {
              toReview.forEach((t) => confirmTxn(t.id));
              const learned = learnFromConfirm(settings, toReview);
              if (learned.notes.length) saveSettings(learned.patch);
              toast({ text: learned.notes.length ? `All checked. Kosh will remember: ${learned.notes.join(" · ")}` : "All marked as checked" });
            }}>
              <Check size={14} /> All good
            </button>
          </div>
          <p className="tiny muted" style={{ padding: "0 10px 6px" }}>Logged automatically from what you shared. Tap one to check or fill in more.</p>
          {toReview.slice(0, 5).map((t) => <TxnRow key={t.id} t={t} onClick={() => openAdd({ editing: t })} />)}
          {toReview.length > 5 && <button className="link small" style={{ padding: "8px 10px" }} onClick={() => go("activity")}>+{toReview.length - 5} more in Activity</button>}
        </section>
      )}

      <div className="grid-2">
        <div className="stack">
          <section className="card hero">
            <div className="label-h">Left after spending and saving{cycles.payday ? ` · ${periodRange(period)}` : ""}</div>
            <div className={`money big ${s.available < 0 ? "neg-v" : ""}`}>{inr(s.available)}</div>
            {s.income === 0 ? (
              <div className="small" style={{ opacity: 0.7 }}>
                No income logged for {monthLabel(period.key, "short")} yet.{" "}
                <button className="btn" style={{ marginTop: 12, background: "transparent", color: "inherit", borderColor: "rgba(255,255,255,.25)" }}
                  onClick={() => openAdd({ draft: { ...emptyDraft(acc, "Income", todayISO()), description: "Salary" }, title: "Log salary" })}>
                  <Wallet size={16} /> Log salary
                </button>
              </div>
            ) : (
              <div className="flow" aria-hidden>
                {flow.map((f) => f.v > 0 && <span key={f.k} style={{ width: `${(f.v / base) * 100}%`, background: f.c }} />)}
              </div>
            )}
            <div className="stats" style={{ marginTop: s.income === 0 ? 18 : 0 }}>
              <div className="stat"><div className="k">Income</div><div className="v">{inrShort(s.income)}</div></div>
              <div className="stat"><div className="k"><i className="dot" style={{ background: flow[0].c }} />Spent</div><div className="v">{inrShort(s.spent)}</div></div>
              <div className="stat">
                <div className="k"><i className="dot" style={{ background: flow[1].c }} />Saved</div>
                <div className="v">{inrShort(s.saved)}<span className="small" style={{ fontFamily: "var(--sans)", opacity: 0.6 }}> / {inrShort(settings.savingsTarget)}</span></div>
              </div>
            </div>
            {incomeKinds.length > 1 && (
              <div className="tiny" style={{ marginTop: 14, opacity: 0.65 }}>
                Income: {incomeKinds.map(([k, v]) => `${k} ${inrShort(v)}`).join(" · ")}
              </div>
            )}
          </section>

          {isCurrent && steps.some((x) => !x.done) && (
            <section className="card">
              <div className="card-h"><h2>Payday checklist</h2><span className="tiny muted">{steps.filter((x) => x.done).length}/{steps.length}</span></div>
              <div className="checklist">
                {steps.map((st) => (
                  <button key={st.label} className={`check-item ${st.done ? "done" : ""}`} style={{ background: "none", border: 0, textAlign: "left", padding: "8px 0" }}
                    disabled={st.done} onClick={() => openAdd({ draft: st.draft, title: st.label,
                      onSaved: st.due ? () => markBill(st.due!.bill, st.due!.mark, "Paid") : undefined })}>
                    <span className="check-box">{st.done && <Check size={14} strokeWidth={3} />}</span>
                    <span>
                      <div className="t" style={{ fontWeight: 500 }}>{st.label}</div>
                      {!st.done && <div className="tiny muted">{st.hint}</div>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <Insight key={period.key} />

          <section className="card">
            <div className="card-h"><h2>Where it went</h2><button className="link" onClick={() => go("plan")}>Budget <ArrowRight size={14} /></button></div>
            {cats.length === 0 ? (
              <Empty icon={<Receipt size={20} />}><p>No spending logged for {monthLabel(period.key, "short")}.</p></Empty>
            ) : cats.map((r) => (
              <div className="cat-row" key={r.category}>
                <span className="cat-ic"><CatIcon category={r.category} size={16} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="row-between small"><span className="ellipsis" style={{ fontWeight: 500 }}>{r.category}</span></div>
                  <Bar value={r.spent} max={r.planned || cats[0].spent} tone={r.status === "over" ? "over" : r.status === "near" ? "near" : ""} />
                </div>
                <div className="right small">
                  <div style={{ fontWeight: 600 }}>{inr(r.spent)}</div>
                  {r.planned > 0 && <div className="tiny muted">of {inrShort(r.planned)}</div>}
                </div>
              </div>
            ))}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Balances</h2><button className="link" onClick={() => go("accounts")}>Manage <ArrowRight size={14} /></button></div>
            {active.map((a) => {
              const card = a.kind === "card";
              const due = card ? owed(bal, a.name) : 0;
              const u = card ? utilisation(a.limit, due) : null;
              return (
                <div className="acct" key={a.name}>
                  <span className="ic">{card ? "CC" : a.name.slice(0, 2).toUpperCase()}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 500 }}>{a.name}</div>
                    <div className="tiny muted ellipsis">
                      {card ? (u ? <><span className={`util ${u.tone}`}>{Math.round(u.pct)}% used</span> of {inrShort(a.limit)}</> : "Owed · add a limit to see usage") : a.role}
                    </div>
                  </div>
                  <div className={`v ${card && due > 0 ? "neg" : ""}`}>{card ? inr(due) : inr(bal[a.name] ?? 0)}</div>
                </div>
              );
            })}
            <div className="row-between small" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
              <span className="muted">Total bank cash</span><b>{inr(cashTotal(settings, bal))}</b>
            </div>
            {friendsOwe > 0 && (
              <div className="row-between small" style={{ paddingTop: 8 }}>
                <span className="muted">Friends owe you</span><b>{inr(friendsOwe)}</b>
              </div>
            )}
          </section>

          {friends.length > 0 && (
            <section className="card">
              <div className="card-h"><h2><Users size={13} style={{ verticalAlign: -2 }} /> Friends owe you</h2><span className="tiny muted">{inr(friendsOwe)}</span></div>
              {friends.map((f) => {
                const days = f.since ? -(daysUntil(f.since) ?? 0) : 0;
                return (
                  <div className="acct" key={f.person}>
                    <span className="ic">{f.person.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontWeight: 500 }}>{f.person}</div>
                      <div className={`tiny ${days > 30 ? "neg" : "muted"}`}>
                        {f.owed > 0 ? `${inr(f.owed)} · ${days === 0 ? "today" : days === 1 ? "since yesterday" : `${days} days`}` : `You owe them ${inr(-f.owed)} (overpaid)`}
                      </div>
                    </div>
                    {f.owed > 0 && <>
                      <button className="btn btn-ghost" style={{ padding: "6px 8px", fontSize: 13 }}
                        onClick={() => openAdd({ draft: writeOffDraft(acc, f), title: `Write off ${f.person}` })}>Write off</button>
                      <button className="btn" style={{ padding: "6px 10px", fontSize: 13 }}
                        onClick={() => openAdd({ draft: repaymentDraft(acc, f), title: `${f.person} paid back` })}>Paid back</button>
                    </>}
                  </div>
                );
              })}
              <p className="tiny muted" style={{ marginTop: 8 }}>Share their UPI payment to Kosh and it settles this automatically.</p>
            </section>
          )}

          {active.some((a) => a.goal > 0) && (
            <section className="card">
              <div className="card-h"><h2>Reserve goals</h2></div>
              {active.filter((a) => a.goal > 0).map((a) => {
                const v = bal[a.name] ?? 0;
                const pct = Math.max(0, Math.min(1, v / a.goal));
                return (
                  <div className="goal" key={a.name}>
                    <div className="row-between">
                      <span style={{ fontWeight: 500 }}>{a.name} {a.role && <span className="muted small">· {a.role.toLowerCase()}</span>}</span>
                      <span className="small"><b>{Math.round(pct * 100)}%</b></span>
                    </div>
                    <Bar value={v} max={a.goal} />
                    <div className="row-between tiny muted" style={{ marginTop: 6 }}>
                      <span>{inr(v)} of {inrShort(a.goal)}</span>
                      <span>{v >= a.goal ? "Funded" : `${inrShort(a.goal - v)} to go`}</span>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          <section className="card">
            <div className="card-h"><h2>Bills</h2><button className="link" onClick={() => go("plan")}>All <ArrowRight size={14} /></button></div>
            {dueBills.length === 0 ? (
              <Empty icon={<CalendarClock size={20} />}><p>Nothing left to pay this month.</p></Empty>
            ) : dueBills.map(({ d, state, days }) => (
              <div className="acct" key={d.bill.id + d.mark}>
                <span className="ic"><CatIcon category={d.bill.kind === "Credit Card" ? "Credit card payment" : d.bill.category} size={16} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 500 }}>{d.bill.name}</div>
                  <div className="tiny muted">
                    {d.due ? `Due ${ordinal(Number(d.due.slice(8)))}` : "No due day set"}
                    {days != null && days >= 0 && days <= 7 ? ` · ${days === 0 ? "today" : `in ${days}d`}` : ""}
                    {d.bill.amount ? ` · ${inr(d.bill.amount)}` : ""}
                  </div>
                </div>
                {state === "overdue" && <span className="pill bad">Overdue</span>}
                {state === "scheduled" && <span className="pill">Scheduled</span>}
                <button className="btn" style={{ padding: "6px 10px", fontSize: 13 }}
                  onClick={() => openAdd({ draft: billDraft(acc, d), title: `Pay ${d.bill.name}`, onSaved: () => markBill(d.bill, d.mark, "Paid") })}>
                  Mark paid
                </button>
              </div>
            ))}
          </section>

          <section className="card" style={{ paddingInline: 8 }}>
            <div className="card-h" style={{ paddingInline: 10 }}><h2>Recent</h2><button className="link" onClick={() => go("activity")}>All <ArrowRight size={14} /></button></div>
            {recent.length === 0 ? (
              <Empty icon={<Receipt size={20} />}><p>Share a UPI screenshot to Kosh, or tap + and type “450 swiggy on axis card”.</p></Empty>
            ) : recent.map((t) => <TxnRow key={t.id} t={t} onClick={() => openAdd({ editing: t })} />)}
          </section>
        </div>
      </div>
    </div>
  );
}

function Insight() {
  const { settings, period } = useData();
  const { go } = useShell();
  const [text, setText] = useState(insightCache[period.key] || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true);
    setErr("");
    try {
      const res = await callAI<{ answer: string }>({
        task: "ask", today: todayISO(), ephemeral: true,
        question: `Give me a quick read on ${monthLabel(period.key)} (${periodRange(period)}): 3 or 4 short bullets on how I'm doing against my budgets and ₹${settings.savingsTarget.toLocaleString("en-IN")} savings target, card usage, anything unusual versus earlier months, bills to watch, and one concrete thing to do next. If there's barely any data, say what to log first.`,
      });
      insightCache[period.key] = res.answer;
      setText(res.answer);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card insight">
      <div className="card-h">
        <h2>Kosh's read</h2>
        <button className="link" onClick={() => go("ask")}>Ask more <MessageCircle size={14} /></button>
      </div>
      {text ? <div className="small" style={{ lineHeight: 1.6 }}><Markdown text={text} /></div> : (
        <p className="small ink-2">A quick, honest look at {monthLabel(period.key, "short")}: budgets, savings, cards, bills and what to do next.</p>
      )}
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn" style={{ marginTop: 14 }} onClick={run} disabled={busy}>
        {busy ? <><LoaderCircle size={16} className="spin" /> Reading your month…</> : text ? "Refresh" : "Get the read"}
      </button>
    </section>
  );
}
