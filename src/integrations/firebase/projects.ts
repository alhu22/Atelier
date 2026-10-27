import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import type { ProjectFiles, ProjectSettings, StudioProject } from "@/types";
import { writeActivity, type ActivityType } from "./auth";
import { withFirestoreContext } from "./errors";

export async function listProjects(
  database: Firestore,
  user: User | null,
): Promise<StudioProject[]> {
  if (!user) return [];
  const snapshot = await withFirestoreContext(
    "list projects", `users/${user.uid}/projects`,
    () => getDocsFromServer(collection(database, "users", user.uid, "projects")),
  );
  return projectRecords(snapshot.docs, user.uid);
}

export function observeProjects(
  database: Firestore,
  user: User,
  onProjects: (projects: StudioProject[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    collection(database, "users", user.uid, "projects"),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
        onProjects(projectRecords(snapshot.docs, user.uid));
      }
    },
    onError,
  );
}

function projectRecords(docs: QueryDocumentSnapshot[], owner: string): StudioProject[] {
  return docs.map((projectDoc) => {
    const value = projectDoc.data();
    return {
      id: projectDoc.id,
      name: typeof value.name === "string" ? value.name : "Untitled project",
      owner,
      pendingCreation: false,
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
  user: User | null,
  project: StudioProject,
): Promise<void> {
  if (!user) return;
  const projectRef = doc(database, "users", user.uid, "projects", project.id);
  await withFirestoreContext("save project (read/write)", projectRef.path, () => runTransaction(database, async (transaction) => {
    const existing = await transaction.get(projectRef);
    if (!existing.exists() && !project.pendingCreation) {
      throw new Error("This project was deleted from your account. It cannot be saved again.");
    }
    // Keep Firestore timestamp precision; rules require createdAt to stay unchanged.
    const createdAt = existing.data()?.createdAt ?? project.createdAt;
    transaction.set(projectRef, {
      name: project.name,
      owner: user.uid,
      settings: project.settings,
      files: project.files,
      entrypoint: project.entrypoint,
      generated: project.generated,
      createdAt,
      updatedAt: serverTimestamp(),
    });
  }));
}

export async function removeProject(
  database: Firestore,
  user: User | null,
  projectId: string,
): Promise<void> {
  if (!user) return;
  const reference = doc(database, "users", user.uid, "projects", projectId);
  await withFirestoreContext("delete project", reference.path, () => deleteDoc(reference));
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
