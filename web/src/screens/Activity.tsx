import { Receipt, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { inPeriod, monthLabel, periodRange, summarize } from "../calc";
import { TxnRow } from "../components/TxnRow";
import { Empty, MonthPicker } from "../components/ui";
import { useData } from "../data";
import { dayLabel, inr } from "../format";
import { Txn, TxnType, myShare, todayISO } from "../model";
import { useShell } from "../shell";

type Filter = "All" | TxnType | "To review";

export function Activity() {
  const { txns, period, setMonth, cycles, settings } = useData();
  const { openAdd } = useShell();
  const [filter, setFilter] = useState<Filter>("All");
  const [account, setAccount] = useState("All accounts");
  const [q, setQ] = useState("");
  const [allTime, setAllTime] = useState(false);
  const today = todayISO();

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns.filter((t) =>
      (allTime || inPeriod(t, period)) &&
      (filter === "All" || (filter === "To review" ? t.review : t.type === filter)) &&
      (account === "All accounts" || t.from === account || t.to === account) &&
      (!needle || `${t.description} ${t.category} ${t.notes} ${t.amount} ${t.person || ""} ${(t.split || []).map((x) => x.person).join(" ")}`.toLowerCase().includes(needle)));
  }, [txns, period, filter, account, q, allTime]);

  const groups = useMemo(() => {
    const g = new Map<string, Txn[]>();
    for (const t of list) g.set(t.date, [...(g.get(t.date) || []), t]);
    return [...g.entries()];
  }, [list]);

  const s = summarize(txns, period);
  const reviewCount = txns.filter((t) => t.review).length;

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>Activity</h1>
          <div className="sub">{allTime ? `${list.length} transactions, all time` : `${cycles.payday ? periodRange(period) : monthLabel(period.key)} · spent ${inr(s.spent)} · in ${inr(s.income)}`}</div>
        </div>
        {!allTime && <MonthPicker period={period} setMonth={setMonth} payday={cycles.payday} />}
      </div>

      <div className="search">
        <Search size={17} />
        <input className="input" placeholder="Search merchant, friend, category, amount" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="chips">
        {(["All", "Expense", "Income", "Transfer", ...(reviewCount ? ["To review"] : [])] as Filter[]).map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}{f === "To review" ? ` · ${reviewCount}` : ""}</button>
        ))}
        <select className="chip" style={{ paddingRight: 12 }} value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
          {["All accounts", ...settings.accounts.map((a) => a.name)].map((a) => <option key={a}>{a}</option>)}
        </select>
        <button className="chip" aria-pressed={allTime} onClick={() => setAllTime(!allTime)}>All time</button>
      </div>

      <section className="card txn-list">
        {groups.length === 0 ? (
          <Empty icon={<Receipt size={20} />}>
            <p>{txns.length === 0 ? "Nothing logged yet. Tap + to add your first one; you can just type it." : "No transactions match."}</p>
          </Empty>
        ) : groups.map(([date, items]) => {
          const out = items.reduce((n, t) => n + myShare(t), 0);
          return (
            <div key={date}>
              <div className="txn-day"><span>{dayLabel(date, today)}</span>{out > 0 && <span>−{inr(out)}</span>}</div>
              {items.map((t) => <TxnRow key={t.id} t={t} onClick={() => openAdd({ editing: t })} />)}
            </div>
          );
        })}
      </section>
    </div>
  );
}
