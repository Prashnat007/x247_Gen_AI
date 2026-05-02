import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signInAnonymously,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const resolvedConfig = {
  ...firebaseConfig,
  apiKey: process.env.GOOGLE_API_KEY || firebaseConfig.apiKey,
};
const app = initializeApp(resolvedConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });

export const signInWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err: any) {
    if (
      err.code === "auth/popup-blocked" ||
      err.code === "auth/popup-closed-by-user" ||
      err.message?.includes("Cross-Origin")
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
};

export const checkRedirectResult = () => getRedirectResult(auth);

export const signUpWithEmail = (email: string, password: string, displayName: string) =>
  createUserWithEmailAndPassword(auth, email, password).then(async (cred) => {
    await updateProfile(cred.user, { displayName });
    return cred;
  });

export const signInWithEmail = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const resetPassword = (email: string) =>
  sendPasswordResetEmail(auth, email);

export const signInAsGuest = () => signInAnonymously(auth);
export const signIn = signInWithGoogle;
export const signOut = () => auth.signOut();
