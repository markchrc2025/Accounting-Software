import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// ─── Firebase Config ───────────────────────────────────────────────────────────
// Get these values from:
// Firebase Console → Project Settings → General → Your apps → Workscale Finance → SDK setup
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        'scalebooks-9a629.firebaseapp.com',
  projectId:         'scalebooks-9a629',
  storageBucket:     'scalebooks-9a629.firebasestorage.app',
  messagingSenderId: '943624880813',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

export const auth      = getAuth(app);
export const db        = getFirestore(app, 'scalebooks');
export const storage   = getStorage(app);
export const functions = getFunctions(app);
export const googleProvider = new GoogleAuthProvider();
