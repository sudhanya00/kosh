import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential, signInWithPopup, signInWithRedirect,
} from "firebase/auth";
import {
  connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const config = {
  apiKey: "AIzaSyBITxtYc4QdwsiQ0CRRNX9JzcBMg0MUsOs",
  authDomain: "kosh-7d33a0.firebaseapp.com",
  projectId: "kosh-7d33a0",
  storageBucket: "kosh-7d33a0.firebasestorage.app",
  messagingSenderId: "424558181852",
  appId: "1:424558181852:web:c9cfcab6ec3b29d652e319",
};

// Sign-in always goes through the firebaseapp.com handler: it's the only redirect address the
// project's Google OAuth client accepts (web.app gives "redirect_uri_mismatch").
export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
const functions = getFunctions(app, "asia-south1");

export const useEmulators = import.meta.env.VITE_EMULATORS === "1";
if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  // Local testing only: sign in as any Google identity without a popup.
  (window as unknown as Record<string, unknown>).__devSignIn = (email: string, name = "") =>
    signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name })));
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  // Popup everywhere, including the installed app: with the handler on another domain, Chrome's
  // storage partitioning can lose a redirect sign-in, while the popup reports straight back.
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
      throw e;
    }
  }
}

const aiCall = httpsCallable(functions, "ai", { timeout: 150_000 });

export async function callAI<T>(payload: Record<string, unknown>): Promise<T> {
  try {
    const res = await aiCall(payload);
    return res.data as T;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "functions/not-found" || err.code === "functions/internal" && !err.message) {
      throw new Error("The AI service isn't deployed yet.");
    }
    if (err.code === "functions/unavailable") throw new Error("You're offline. AI needs a connection.");
    throw new Error((err.message || "Something went wrong.").replace(/\s*\[\d+\]$/, ""));
  }
}
