import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  getDocs,
  limit,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "@/integrations/firebase/client";
import type { ActivityEvent, AdminProject, UserProfile } from "@/types";

interface AdminData {
  profiles: UserProfile[];
  projects: AdminProject[];
  activity: ActivityEvent[];
  loading: boolean;
  isAdmin: boolean;
  error: string | null;
  limited: boolean;
}

export function useAdminDashboard(user: User | null) {
  const [data, setData] = useState<AdminData>({
    profiles: [],
    projects: [],
    activity: [],
    loading: true,
    isAdmin: false,
    error: null,
    limited: false,
  });
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const loadedUid = useRef<string | null>(null);
  const requestVersion = useRef(0);
  const currentUid = useRef(user?.uid);
  currentUid.current = user?.uid;

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const active = () => version === requestVersion.current && currentUid.current === user?.uid;
    if (!user || !firestore) {
      loadedUid.current = null;
      setSelectedUid(null);
      setData((current) => ({
        ...current,
        profiles: [],
        projects: [],
        activity: [],
        isAdmin: false,
        loading: false,
        error: "Sign in with an administrator account to view this dashboard.",
      }));
      return;
    }
    if (loadedUid.current !== user.uid) {
      loadedUid.current = user.uid;
      setSelectedUid(null);
      setData({
        profiles: [],
        projects: [],
        activity: [],
        loading: true,
        isAdmin: false,
        error: null,
        limited: false,
      });
    } else {
      setData((current) => ({ ...current, loading: true, error: null }));
    }
    try {
      const token = await user.getIdTokenResult(true);
      if (!active()) return;
      if (token.claims.admin !== true) {
        setData({
          profiles: [],
          projects: [],
          activity: [],
          loading: false,
          isAdmin: false,
          error: "This account does not have administrator access.",
          limited: false,
        });
        return;
      }
      const [profileSnapshot, projectSnapshot, activitySnapshot] =
        await Promise.all([
          getDocs(query(collection(firestore, "users"), limit(500))),
          getDocs(query(collectionGroup(firestore, "projects"), limit(1000))),
          getDocs(
            query(
              collectionGroup(firestore, "activity"),
              orderBy("occurredAt", "desc"),
              limit(250),
            ),
          ),
        ]);
      if (!active()) return;

      const profileRecords: UserProfile[] = profileSnapshot.docs.map((item) => {
        const value = item.data();
        return {
          uid: item.id,
          email: textValue(value.email),
          displayName: textValue(value.displayName),
          photoURL: textValue(value.photoURL),
          createdAt: timestampValue(value.createdAt),
          lastSeenAt: timestampValue(value.lastSeenAt),
        };
      });
      const projects: AdminProject[] = projectSnapshot.docs.map((item) => {
        const value = item.data();
        return {
          id: item.id,
          owner: item.ref.parent.parent?.id ?? "",
          name: textValue(value.name) || "Untitled project",
          entrypoint: textValue(value.entrypoint) || "index.html",
          updatedAt: timestampValue(value.updatedAt),
        };
      });
      const activity: ActivityEvent[] = activitySnapshot.docs.map((item) => {
        const value = item.data();
        return {
          id: item.id,
          owner: item.ref.parent.parent?.id ?? "",
          type: textValue(value.type),
          userEmail: textValue(value.userEmail),
          occurredAt: timestampValue(value.occurredAt),
        };
      });
      const profilesByUid = new Map(
        profileRecords.map((profile) => [profile.uid, profile]),
      );
      for (const project of projects) {
        if (!profilesByUid.has(project.owner)) {
          profilesByUid.set(project.owner, {
            uid: project.owner,
            email: "",
            displayName: "",
            photoURL: "",
            createdAt: null,
            lastSeenAt: project.updatedAt,
          });
        }
      }
      for (const event of activity) {
        const profile = profilesByUid.get(event.owner);
        if (!profile) {
          profilesByUid.set(event.owner, {
            uid: event.owner,
            email: event.userEmail,
            displayName: "",
            photoURL: "",
            createdAt: null,
            lastSeenAt: event.occurredAt,
          });
        } else if (
          dateMilliseconds(event.occurredAt) >
          dateMilliseconds(profile.lastSeenAt)
        ) {
          profilesByUid.set(event.owner, {
            ...profile,
            email: profile.email || event.userEmail,
            lastSeenAt: event.occurredAt,
          });
        }
      }
      const profiles = [...profilesByUid.values()].sort(
        (left, right) =>
          dateMilliseconds(right.lastSeenAt) - dateMilliseconds(left.lastSeenAt),
      );
      setData({
        profiles,
        projects,
        activity,
        loading: false,
        isAdmin: true,
        error: null,
        limited:
          profileSnapshot.size >= 500 ||
          projectSnapshot.size >= 1000 ||
          activitySnapshot.size >= 250,
      });
      setSelectedUid((current) => current ?? profiles[0]?.uid ?? null);
    } catch (error) {
      if (!active()) return;
      setData((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load administrator data.",
      }));
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  const visible = Boolean(user && loadedUid.current === user.uid && data.isAdmin);
  const profiles = visible ? data.profiles : [];
  const projects = visible ? data.projects : [];
  const activity = visible ? data.activity : [];
  const filteredProfiles = profiles.filter((profile) => {
    const needle = search.trim().toLowerCase();
    return (
      !needle ||
      [profile.uid, profile.email, profile.displayName]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  });
  const selectedProfile =
    profiles.find((profile) => profile.uid === selectedUid) ?? null;
  const selectedProjects = projects.filter(
    (project) => project.owner === selectedUid,
  );
  const selectedActivity = activity
    .filter((event) => event.owner === selectedUid)
    .slice(0, 8);

  return {
    ...data,
    profiles,
    projects,
    activity,
    isAdmin: visible,
    search,
    setSearch,
    selectedUid,
    setSelectedUid,
    selectedProfile,
    selectedProjects,
    selectedActivity,
    filteredProfiles,
    refresh,
  };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timestampValue(value: unknown): Timestamp | Date | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value as Timestamp;
  }
  return value instanceof Date ? value : null;
}

function dateMilliseconds(value: Timestamp | Date | null): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : value.toMillis();
}
