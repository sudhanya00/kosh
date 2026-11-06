# Kosh

Your "YOUR MONEY SYSTEM" spreadsheet, turned into a private web app for phone and laptop.

**Live:** https://kosh-7d33a0.web.app (Firebase project `kosh-7d33a0`, data in Mumbai `asia-south1`)

## What's in it

| Spreadsheet sheet | In the app |
|---|---|
| Start Here | Accounts → "How to log money", plus the AI follows the same rules |
| Dashboard | Home: left-to-spend, income/spent/saved, balances, reserve goals, payday checklist |
| Transactions | Activity (search, filters, edit, delete with undo) and the **+** button |
| Monthly Budget | Plan → Budget (tap a limit to edit it) |
| Bills & Subs | Plan → Bills ("Mark paid" logs the payment and ticks it off for the month) |
| Accounts & Goals | Accounts: opening balances, goals, savings target, CSV export |

AI (Gemini `gemini-3.5-flash` on **Vertex AI** in Mumbai, falling back to the global endpoint when busy, billed to the reelforge GCP project `reelforge-509712` so your Cloud credits pay; no API keys anywhere. The Cloud Function runs as `kosh-ai@kosh-7d33a0.iam.gserviceaccount.com`, which only has *Vertex AI User* on that project. Logic lives in `functions/kosh-ai.js`):
- **Share to Kosh (Android):** in GPay/PhonePe/Paytm tap Share on a payment → Kosh. Or share a bank SMS. Kosh reads it, logs it immediately marked **to review**, and skips anything already logged (same UPI reference). Check them from the *To review* card on Home.
- **+ → type it like a text message**, paste an SMS, or attach up to 5 screenshots. You review rows before they save.
- **Ask Kosh** (and **Kosh's read** on Home): a Gemini agent with tools over your *full* history — find transactions, exact totals grouped by month/category/merchant/account/friend, pay-cycle dates, balances on any date, budgets, bills, a safe calculator and finance formulas (months to goal, EMI, loan payoff, savings rate), plus **search by meaning** across merchants, notes and past chats (Firestore vector search, `text-multilingual-embedding-002`). Every number comes from a tool, not the model's head. Conversations are saved (`users/{uid}/chats`); the last 8 messages go in verbatim and older ones are folded into a rolling summary. Tell it a goal or who someone is and it saves that to Teach Kosh / Kosh remembers.
- **Kosh remembers** (Accounts): change a payment's category and that merchant keeps it from then on (with an offer to fix earlier ones). Confirm a payment from family and that person is remembered as family; anyone you split with is remembered as a friend. Every learned person (with relation, e.g. "Mother") and merchant rule can be edited or deleted there, or added by hand.
- **Teach Kosh** (Accounts): plain-English rules the AI follows ("Payments from Rakesh Khajuria are from Dad → Family support").

Also:
- **Accounts and cards are yours to manage:** add, rename (history follows), archive. Cards have limits and show how much you're using (green under 30%). "How it shows in UPI apps" (bank name, last 4 digits, UPI ID) helps the AI match screenshots to the right account.
- **Months run payday to payday** by default: a salary logged on 30 Oct starts "November". Until it's logged, the "usual payday" setting stands in (shown with *). You can switch to calendar months in Accounts.
- **Paying for friends:** on any expense tap **Split with friends** (split evenly or custom amounts). The full bill leaves your account, but only your share counts as spending; the rest shows under **Friends owe you** on Home, one running total per friend (like Splitwise). Share their UPI payment back to Kosh and it's logged as a **Friend repayment** (not income), settling their total. Partial and combined paybacks work. **Write off** turns an unpaid share into your own spending. You can also just type "dinner 20k on axis card split with Rahul, Priya, Amit, Neha".
- **Amounts hidden by default:** every open shows ₹•••• (AI answers too; editable amount boxes are blurred until tapped). The eye button next to the profile icon reveals them; leaving the app hides them again.
- **Income types:** Salary, Side income, Family support, Gifts received, Interest & dividends, Refunds & cashback, Other income.

Only `sudhanyak357@gmail.com` (Google sign-in) can read or write anything. This is enforced in `firestore.rules` and in `functions/index.js`.

## Install on your phone

On Android open the live link in **Chrome → ⋮ → Install app** (or *Add to Home screen → Install*). It opens full-screen like an app and appears in the share menu as **Kosh** (it can take a minute to show up after installing). Entries made offline sync when you're back online, and shares made offline wait on Home until there's a connection.

## Setup (done)

- Google sign-in enabled, project on Blaze, Firestore in `asia-south1`, function `ai` deployed in `asia-south1`.
- Old build images are deleted after 7 days, so Artifact Registry doesn't slowly bill you.
- To stop Kosh using reelforge's credits, remove `kosh-ai@…` from IAM on `reelforge-509712`.
- To bill a different project: set `VERTEX_PROJECT` in `functions/.env`, grant `kosh-ai` *Vertex AI User* there, then run `firebase deploy --only functions`.

## How Ask Kosh is built

`web/src/tools.ts` holds the tool maths and is bundled with the app's own `model`/`calc`/`memory` into `functions/lib/core.js` (`npm --prefix functions run build`, run automatically before every functions deploy), so the server and the app can't disagree. `functions/agent.js` loads your data with the Admin SDK (cached 30s), runs up to 6 tool rounds, saves both turns, embeds the Q&A into `users/{uid}/recall`, and folds old turns into the chat summary. The `kosh-ai` service account has *Cloud Datastore User* on `kosh-7d33a0` for this.

## Develop locally

```bash
cd functions && npm install && cd ../web && npm install
NODE_OPTIONS=--dns-result-order=ipv4first firebase emulators:start --only auth,firestore,functions   # repo root; IPv4 avoids hangs to Vertex on this PC
npm --prefix web run dev -- --mode emulators               # http://localhost:5173
```

In emulator mode, sign in from the browser console with `__devSignIn("sudhanyak357@gmail.com", "Your Name")`. The local function calls Vertex with your `gcloud auth application-default login` credentials.

Deploy the site: `npm --prefix web run build && firebase deploy --only hosting,firestore:rules`.

To change the model, set `GEMINI_MODEL` in `functions/.env`.
