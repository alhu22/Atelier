import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import type { ProjectFiles, ProjectSettings, StudioProject } from "@/types";
import { writeActivity, type ActivityType } from "./auth";

export async function listProjects(
  database: Firestore,
  user: User,
): Promise<StudioProject[]> {
  const snapshot = await getDocs(
    query(collection(database, "users", user.uid, "projects"), limit(100)),
  );
  return snapshot.docs.map((projectDoc) => {
    const value = projectDoc.data();
    return {
      id: projectDoc.id,
      name: typeof value.name === "string" ? value.name : "Untitled project",
      owner: typeof value.owner === "string" ? value.owner : user.uid,
      files: isProjectFiles(value.files)
        ? value.files
        : typeof value.html === "string"
          ? { "index.html": value.html }
          : {},
      entrypoint: typeof value.entrypoint === "string" ? value.entrypoint : "index.html",
      generated: value.generated === true,
      settings: isProjectSettings(value.settings) ? value.settings : {},
      createdAt: value.createdAt?.toDate?.() ?? new Date(),
      updatedAt: value.updatedAt?.toDate?.() ?? new Date(),
    };
  });
}

export async function saveProject(
  database: Firestore,
  user: User,
  project: StudioProject,
): Promise<void> {
  await setDoc(
    doc(database, "users", user.uid, "projects", project.id),
    {
      name: project.name,
      owner: user.uid,
      settings: project.settings,
      files: project.files,
      entrypoint: project.entrypoint,
      generated: project.generated,
      createdAt: project.createdAt,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function removeProject(
  database: Firestore,
  user: User,
  projectId: string,
): Promise<void> {
  await deleteDoc(doc(database, "users", user.uid, "projects", projectId));
}

export async function logProjectActivity(
  database: Firestore,
  user: User,
  type: ActivityType,
): Promise<void> {
  await writeActivity(database, user, type);
}

export function isProjectFiles(value: unknown): value is ProjectFiles {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((file) => typeof file === "string")
  );
}

function isProjectSettings(value: unknown): value is ProjectSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
