// Everything the AI needs to turn a message, SMS or UPI screenshot into rows for *this* user:
// their accounts (with how each shows up in UPI apps), their own name, their rules, and how
// they've categorised similar things before.
import { User } from "firebase/auth";
import { friendBalances, knownPeople } from "./calc";
import { callAI } from "./firebase";
import { applyMemory, memoryForAI } from "./memory";
import { Draft, Settings, Txn, todayISO } from "./model";

export interface Img { data: string; mimeType: string; url: string }

export async function parseWithAI(
  ctx: { settings: Settings; txns: Txn[]; user: User | null },
  input: { text?: string; images?: Img[] },
): Promise<{ transactions: Draft[]; message: string }> {
  const { settings, txns, user } = ctx;
  const recent = [...new Map(txns.slice(0, 150).map((t) => [t.description.toLowerCase(), t])).values()]
    .slice(0, 40).map((t) => ({ description: t.description, type: t.type, category: t.category, from: t.from, to: t.to }));
  const res = await callAI<{ transactions: Draft[]; message: string }>({
    task: "parse",
    today: todayISO(),
    text: input.text || "",
    images: (input.images || []).slice(0, 5).map((i) => ({ data: i.data, mimeType: i.mimeType })),
    me: user?.displayName || "",
    accounts: settings.accounts.filter((a) => !a.archived).map((a) => ({ name: a.name, kind: a.kind, role: a.role, hints: a.hints })),
    notes: settings.aiNotes,
    friendsOwing: friendBalances(txns).filter((f) => f.owed > 0).map((f) => ({ person: f.person, owed: f.owed })),
    people: knownPeople(txns).slice(0, 60),
    memory: memoryForAI(settings),
    recent,
  });
  return {
    transactions: applyMemory(settings, (res.transactions || []).map((d) => ({
      ...d, notes: d.notes || "", ref: d.ref || "", person: d.person || null, split: d.split?.length ? d.split : null,
    }))),
    message: res.message || "",
  };
}

// Downscale photos before upload: screenshots read fine at 1600px and it keeps calls fast.
export async function shrink(file: Blob): Promise<Img> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1], mimeType: "image/jpeg", url };
}
