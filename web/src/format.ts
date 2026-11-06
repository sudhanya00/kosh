const full = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

// Privacy: while amounts are hidden every formatted amount renders as dots. The DataProvider
// flips this during render (it holds the eye-button state), so every screen re-renders in step.
// Off by default so the server bundle (functions/lib/core.js) always sees real numbers.
let masked = false;
export const setMasked = (v: boolean) => { masked = v; };
export const isMasked = () => masked;
const DOTS = "••••";

// Hide ₹ amounts inside free text (AI answers): ₹1,25,000 / ₹3.2L / Rs. 450 → ₹••••
export const maskText = (s: string) =>
  masked ? s.replace(/(₹|\bRs\.?|\bINR)\s?\d[\d,]*(\.\d+)?(\s?(L|k|K|Cr|lakhs?|crores?)\b)?/g, "₹" + DOTS) : s;

export function inr(n: number, opts: { sign?: boolean } = {}): string {
  if (masked) return (n < 0 ? "−" : opts.sign && n > 0 ? "+" : "") + "₹" + DOTS;
  const v = Math.round(n * 100) / 100;
  const body = "₹" + full.format(Math.abs(v));
  if (v < 0) return "−" + body;
  return opts.sign && v > 0 ? "+" + body : body;
}

// ₹3L, ₹2.2L, ₹45k, ₹850
export function inrShort(n: number): string {
  if (masked) return (n < 0 ? "−" : "") + "₹" + DOTS;
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}k`;
  return `${sign}₹${Math.round(a)}`;
}

function trim(n: number) {
  return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
}

export function parseAmount(s: string): number {
  const n = Number(String(s).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T00:00:00`);
  const t = new Date(`${today}T00:00:00`);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
    year: d.getFullYear() === t.getFullYear() ? undefined : "numeric",
  });
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
