import { inr } from "../format";
import { Txn, isRepayment, isWriteOff, myShare } from "../model";
import { CatIcon } from "./ui";

export function TxnRow({ t, onClick }: { t: Txn; onClick: () => void }) {
  const repay = isRepayment(t);
  const writeOff = isWriteOff(t);
  const split = t.type === "Expense" && !!t.split?.length;
  const route = repay ? `${t.person} → ${t.to}`
    : writeOff ? `${t.person} · written off`
    : t.type === "Expense" ? t.from + (split ? ` · split with ${t.split!.map((x) => x.person.split(" ")[0]).join(", ")}` : "")
    : t.type === "Income" ? t.to : `${t.from} → ${t.to}`;
  return (
    <button className="txn" onClick={onClick}>
      <span className={`ic ${repay ? "Income" : t.type}`}><CatIcon category={t.category} /></span>
      <span style={{ minWidth: 0 }}>
        <div className="d ellipsis">{t.description || t.category}{t.review && <i className="review-dot" title="Logged automatically — tap to check" />}</div>
        <div className="m ellipsis">{t.category} · {route}</div>
      </span>
      <span className={`amt ${repay ? "repay" : t.type}`}>
        {t.type === "Income" || repay ? "+" : t.type === "Expense" ? "−" : ""}{inr(t.amount)}
        {split && <span className="mine">you {inr(myShare(t))}</span>}
      </span>
    </button>
  );
}
