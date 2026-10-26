import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { Auth } from "firebase/auth";

export type ActivityType =
  | "session_started"
  | "session_ended"
  | "project_created"
  | "project_opened"
  | "generation_completed"
  | "project_exported";

export function observeUser(auth: Auth, callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(auth: Auth): Promise<void> {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutUser(auth: Auth): Promise<void> {
  await signOut(auth);
}

export async function recordUserSession(
  database: Firestore,
  user: User,
): Promise<void> {
  const profileRef = doc(database, "users", user.uid);
  const existing = await getDoc(profileRef);
  const profile = existing.data();
  await setDoc(profileRef, {
    email: user.email ?? "",
    displayName:
      typeof profile?.displayName === "string"
        ? profile.displayName
        : user.displayName ?? "",
    photoURL:
      typeof profile?.photoURL === "string"
        ? profile.photoURL
        : user.photoURL ?? "",
    createdAt: profile?.createdAt ?? serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  }, { merge: true });
  await writeActivity(database, user, "session_started");
}

export async function writeActivity(
  database: Firestore,
  user: User,
  type: ActivityType,
): Promise<void> {
  await setDoc(doc(collection(database, "users", user.uid, "activity")), {
    type,
    userEmail: user.email ?? "",
    occurredAt: serverTimestamp(),
  });
}

export async function saveUserProfile(
  database: Firestore,
  user: User,
  displayName: string,
  photoURL: string,
): Promise<void> {
  const profileRef = doc(database, "users", user.uid);
  const existing = await getDoc(profileRef);
  await setDoc(
    profileRef,
    {
      email: user.email ?? "",
      displayName,
      photoURL,
      createdAt: existing.data()?.createdAt ?? serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}
