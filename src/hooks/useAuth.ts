import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, firebaseConfigured, firestore } from "@/integrations/firebase/client";
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
}

export function useAuth() {
  const previousUser = useRef<User | null>(null);
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: firebaseConfigured,
    error: null,
    displayName: "",
    photoURL: "",
  });

  useEffect(() => {
    if (!auth || !firestore) return;

    const database = firestore;
    return observeUser(auth, (user) => {
      setState((previous) => ({
        ...previous,
        user,
        loading: false,
        error: null,
        displayName: user?.displayName ?? "",
        photoURL: user?.photoURL ?? "",
      }));
      if (user && previousUser.current?.uid !== user.uid) {
        void recordUserSession(database, user).catch((error: unknown) => {
          setState((previous) => ({
            ...previous,
            error: errorMessage(error, "Could not sync your account profile."),
          }));
        });
      }
      previousUser.current = user;
      if (user) {
        void getDoc(doc(database, "users", user.uid))
          .then((snapshot) => {
            if (!snapshot.exists() || previousUser.current?.uid !== user.uid) return;
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
            setState((previous) => ({
              ...previous,
              error: errorMessage(error, "Could not load your profile."),
            }));
          });
      }
    });
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
