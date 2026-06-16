import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import config from "../firebase-applet-config.json";

// Standard client-side firebase config fields in firebase-applet-config.json
const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
};

// Initialize App
const app = initializeApp(firebaseConfig);

// Initialize Firestore specifying database ID if configured
export const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

// Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
