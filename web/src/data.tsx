import { User, onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { Cycles, Period, currentMonth } from "./calc";
import { auth, db } from "./firebase";
import { setMasked } from "./format";
import {
  AccountSets, Bill, BillMark, DEFAULT_SETTINGS, Draft, Settings, Txn, accountSets, defaultBills, normalizeSettings, todayISO,
} from "./model";

type Access = "loading" | "signedOut" | "denied" | "ready";

interface DataCtx {
  access: Access;
  user: User | null;
  settings: Settings;
  acc: AccountSets;
  txns: Txn[];
  bills: Bill[];
  synced: boolean;
  cycles: Cycles;
  period: Period; // the cycle being viewed
  isCurrent: boolean;
  setMonth: (key: string) => void;
  addTxns: (drafts: Draft[], source: Txn["source"], opts?: { review?: boolean }) => Promise<{ saved: Txn[]; skipped: Draft[] }>;
  updateTxn: (id: string, d: Draft) => Promise<void>;
  confirmTxn: (id: string) => Promise<void>;
  deleteTxn: (t: Txn) => Promise<void>;
  restoreTxn: (t: Txn) => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  renameAccount: (from: string, to: string) => Promise<void>;
  saveBill: (b: Omit<Bill, "id"> & { id?: string }) => Promise<void>;
  deleteBill: (id: string) => Promise<void>;
  markBill: (b: Bill, mark: string, value: BillMark | null) => Promise<void>;
  logout: () => Promise<void>;
  hidden: boolean; // amounts shown as ₹•••• (default on every open)
  toggleHidden: () => void;
}

const Ctx = createContext<DataCtx | null>(null);

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData outside DataProvider");
  return c;
}

const clean = (d: Draft) => ({
  date: d.date, type: d.type, from: d.from, to: d.to, category: d.category,
  description: d.description.trim(), amount: Math.round(d.amount * 100) / 100, notes: d.notes.trim(),
  ref: (d.ref || "").trim(),
  // null (not undefined) so an edit that removes a split also clears it in Firestore.
  split: d.type === "Expense" && d.split?.length
    ? d.split.map((x) => ({ person: x.person.trim(), amount: Math.round(x.amount * 100) / 100 })) : null,
  person: d.person?.trim() || null,
});

export function DataProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<Access>("loading");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [synced, setSynced] = useState(true);
  const [hidden, setHidden] = useState(true);
  // Set before any child renders, so every formatted amount in this render agrees.
  setMasked(hidden);

  // Leaving the app hides amounts again, so they're hidden the next time it's opened.
  useEffect(() => {
    const onVis = () => document.visibilityState === "hidden" && setHidden(true);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("amounts-hidden", hidden); }, [hidden]);
  const [viewKey, setViewKey] = useState<string | null>(null); // null = follow the current cycle

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAccess(u ? "loading" : "signedOut");
  }), []);

  useEffect(() => {
    if (!user) return;
    const root = doc(db, "users", user.uid);
    const unsubs: (() => void)[] = [];
    let cancelled = false;

    const denied = (e: { code?: string }) => {
      if (e.code === "permission-denied") setAccess("denied");
      else console.error(e);
    };

    (async () => {
      try {
        // First sign-in: seed from the spreadsheet's defaults.
        const snap = await getDoc(root);
        if (!snap.exists()) {
          const batch = writeBatch(db);
          batch.set(root, { ...DEFAULT_SETTINGS, createdAt: Date.now() });
          for (const b of defaultBills(currentMonth())) batch.set(doc(collection(root, "bills")), b);
          await batch.commit();
        }
      } catch (e) {
        // Offline with an empty cache can't check; carry on and let the listeners catch up.
        if ((e as { code?: string }).code === "permission-denied") return setAccess("denied");
        console.warn("seed check skipped", e);
      }
      if (cancelled) return;

      unsubs.push(onSnapshot(root, { includeMetadataChanges: true }, (s) => {
        if (s.exists()) setSettings(normalizeSettings(s.data() as Partial<Settings>));
        setSynced(!s.metadata.hasPendingWrites);
        setAccess("ready");
      }, denied));

      unsubs.push(onSnapshot(query(collection(root, "transactions"), orderBy("date", "desc")), (s) => {
        const list = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Txn);
        // Same day: newest entry first.
        list.sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
        setTxns(list);
      }, denied));

      unsubs.push(onSnapshot(collection(root, "bills"), (s) => {
        const list = s.docs.map((d) => ({ id: d.id, marks: {}, ...d.data() }) as Bill);
        list.sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99) || a.name.localeCompare(b.name));
        setBills(list);
      }, denied));
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user]);

  const acc = useMemo(() => accountSets(settings), [settings]);
  const cycles = useMemo(() => new Cycles(settings, txns), [settings, txns]);
  const currentKey = cycles.keyOf(todayISO());
  const period = useMemo(() => cycles.get(viewKey ?? currentKey), [cycles, viewKey, currentKey]);

  const value = useMemo<DataCtx>(() => {
    const root = () => doc(db, "users", user!.uid);
    // With the offline cache, writes apply locally at once; don't make the UI wait for the server.
    const fire = (p: Promise<unknown>) => { p.catch((e) => console.error("write failed", e)); return Promise.resolve(); };
    return {
      access, user, settings, acc, txns, bills, synced, cycles, period,
      isCurrent: period.key === currentKey,
      setMonth: (k) => setViewKey(k === currentKey ? null : k),
      addTxns: async (drafts, source, opts = {}) => {
        const refs = new Set(txns.map((t) => t.ref).filter(Boolean));
        const batch = writeBatch(db);
        const now = Date.now();
        const saved: Txn[] = [];
        const skipped: Draft[] = [];
        drafts.forEach((d, i) => {
          const data = clean(d);
          if (data.ref && refs.has(data.ref)) return skipped.push(d);
          if (data.ref) refs.add(data.ref);
          const ref = doc(collection(root(), "transactions"));
          const row = { ...data, source, createdAt: now + i, ...(opts.review ? { review: true } : {}) };
          batch.set(ref, row);
          saved.push({ id: ref.id, ...row } as Txn);
        });
        if (saved.length) fire(batch.commit());
        return { saved, skipped };
      },
      // Editing a transaction counts as reviewing it.
      updateTxn: (id, d) => fire(updateDoc(doc(root(), "transactions", id), { ...clean(d), review: false })),
      confirmTxn: (id) => fire(updateDoc(doc(root(), "transactions", id), { review: false })),
      deleteTxn: (t) => fire(deleteDoc(doc(root(), "transactions", t.id))),
      restoreTxn: ({ id, ...rest }) => fire(setDoc(doc(root(), "transactions", id), rest)),
      saveSettings: (patch) => fire(setDoc(root(), patch, { merge: true })),
      renameAccount: async (from, to) => {
        // Names are the link between accounts, transactions and bills, so move them all together.
        const writes: [string, string, Record<string, string>][] = [];
        for (const t of txns) {
          const p: Record<string, string> = {};
          if (t.from === from) p.from = to;
          if (t.to === from) p.to = to;
          if (Object.keys(p).length) writes.push(["transactions", t.id, p]);
        }
        for (const b of bills) {
          const p: Record<string, string> = {};
          if (b.payFrom === from) p.payFrom = to;
          if (b.payTo === from) p.payTo = to;
          if (Object.keys(p).length) writes.push(["bills", b.id, p]);
        }
        const accounts = settings.accounts.map((a) => (a.name === from ? { ...a, name: to } : a));
        for (let i = 0; i < writes.length || i === 0; i += 400) {
          const batch = writeBatch(db);
          if (i === 0) batch.set(root(), { accounts }, { merge: true });
          for (const [c, id, p] of writes.slice(i, i + 400)) batch.update(doc(root(), c, id), p);
          await fire(batch.commit());
        }
      },
      saveBill: ({ id, ...b }) => fire(id ? setDoc(doc(root(), "bills", id), b) : setDoc(doc(collection(root(), "bills")), b)),
      deleteBill: (id) => fire(deleteDoc(doc(root(), "bills", id))),
      markBill: (b, m, mark) => {
        const marks = { ...b.marks };
        if (mark) marks[m] = mark;
        else delete marks[m];
        return fire(updateDoc(doc(root(), "bills", b.id), { marks }));
      },
      logout: () => signOut(auth),
      hidden,
      toggleHidden: () => setHidden((h) => !h),
    };
  }, [access, user, settings, acc, txns, bills, synced, cycles, period, currentKey, hidden]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
