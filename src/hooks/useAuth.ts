import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, firebaseConfigured, firestore } from "@/integrations/firebase/client";
import { withFirestoreContext } from "@/integrations/firebase/errors";
import {
  observeUser,
  recordUserSession,
  saveUserProfile,
  signInWithGoogle,
  signOutUser,
  writeActivity,
} from "@/integrations/firebase/auth";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  displayName: string;
  photoURL: string;
  role: "admin" | "builder" | null;
}

const AuthContext = createContext<ReturnType<typeof useAuthState> | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  return createElement(AuthContext.Provider, { value: useAuthState() }, children);
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

function useAuthState() {
  const previousUser = useRef<User | null>(null);
  const authVersion = useRef(0);
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: firebaseConfigured,
    error: null,
    displayName: "",
    photoURL: "",
    role: null,
  });

  useEffect(() => {
    if (!auth || !firestore) return;

    const database = firestore;
    const unsubscribe = observeUser(auth, (user) => {
      const version = ++authVersion.current;
      const active = () => version === authVersion.current && previousUser.current?.uid === user?.uid;
      setState((previous) => ({
        ...previous,
        user,
        loading: Boolean(user),
        role: null,
        error: null,
        displayName: user?.displayName ?? "",
        photoURL: user?.photoURL ?? "",
      }));
      if (user && previousUser.current?.uid !== user.uid) {
        void recordUserSession(database, user).catch((error: unknown) => {
          if (!active()) return;
          setState((previous) => ({
            ...previous,
            error: errorMessage(error, "Could not sync your account profile."),
          }));
        });
      }
      previousUser.current = user;
      if (user) {
        void user.getIdTokenResult(true)
          .then((token) => {
            if (!active()) return;
            setState((previous) => ({
              ...previous,
              role: token.claims.admin === true ? "admin" : "builder",
              loading: false,
            }));
          })
          .catch((error: unknown) => {
            if (!active()) return;
            setState((previous) => ({
              ...previous,
              loading: false,
              role: null,
              error: errorMessage(error, "Could not verify account access. Sign out and try again."),
            }));
          });
        void withFirestoreContext("load profile", `users/${user.uid}`, () => getDoc(doc(database, "users", user.uid)))
          .then((snapshot) => {
            if (!snapshot.exists() || !active()) return;
            const profile = snapshot.data();
            setState((previous) => ({
              ...previous,
              displayName:
                typeof profile.displayName === "string"
                  ? profile.displayName
                  : previous.displayName,
              photoURL:
                typeof profile.photoURL === "string"
                  ? profile.photoURL
                  : previous.photoURL,
            }));
          })
          .catch((error: unknown) => {
            if (!active()) return;
            setState((previous) => ({
              ...previous,
              error: errorMessage(error, "Could not load your profile."),
            }));
          });
      }
    });
    return () => {
      authVersion.current += 1;
      previousUser.current = null;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!auth) throw new Error("Firebase sign-in is not configured.");
    await signInWithGoogle(auth);
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) throw new Error("Firebase sign-in is not configured.");
    let activityError: unknown;
    if (state.user && firestore) {
      try {
        await writeActivity(firestore, state.user, "session_ended");
      } catch (error) {
        activityError = error;
      }
    }
    await signOutUser(auth);
    if (activityError) {
      throw new Error(
        `Signed out, but sign-out activity could not be recorded: ${errorMessage(activityError, "unknown error")}`,
      );
    }
  }, [state.user]);

  const updateProfile = useCallback(
    async (displayName: string, photoURL: string) => {
      if (!state.user || !firestore) {
        throw new Error("Sign in before updating your profile.");
      }
      await saveUserProfile(firestore, state.user, displayName, photoURL);
      setState((previous) => ({ ...previous, displayName, photoURL }));
    },
    [state.user],
  );

  return {
    ...state,
    configured: firebaseConfigured,
    signIn,
    signOut,
    updateProfile,
    clearError: () => setState((previous) => ({ ...previous, error: null })),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
