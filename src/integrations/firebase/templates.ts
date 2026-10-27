import { collection, doc, getDocFromServer, getDocsFromServer, type Firestore } from "firebase/firestore";
import type { ProjectFiles } from "@/types";
import { withFirestoreContext } from "./errors";
import { isProjectFiles } from "./projects";

export interface ProjectTemplate {
  id: string;
  name: string;
  previewImage: string | null;
  order: number;
}

export interface TemplateSource {
  name: string;
  files: ProjectFiles;
  entrypoint: string;
}

export async function listProjectTemplates(database: Firestore): Promise<ProjectTemplate[]> {
  const snapshot = await withFirestoreContext(
    "list templates", "templates",
    () => getDocsFromServer(collection(database, "templates")),
  );
  return snapshot.docs.map((item) => {
    const value = item.data();
    return {
      id: item.id,
      name: typeof value.name === "string" ? value.name : "Untitled template",
      previewImage: typeof value.previewImage === "string" && value.previewImage.startsWith("data:image/jpeg;base64,")
        ? value.previewImage : null,
      order: typeof value.order === "number" ? value.order : Number.MAX_SAFE_INTEGER,
    };
  }).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

export async function getTemplateSource(database: Firestore, id: string): Promise<TemplateSource> {
  const reference = doc(database, "templates", id);
  const snapshot = await withFirestoreContext(
    "load template", reference.path, () => getDocFromServer(reference),
  );
  if (!snapshot.exists()) throw new Error("This template is no longer available. Refresh the template list.");
  const value = snapshot.data();
  if (typeof value.name !== "string" || !isProjectFiles(value.files) ||
      !Object.keys(value.files).length || typeof value.entrypoint !== "string" ||
      !Object.hasOwn(value.files, value.entrypoint)) {
    throw new Error("This template is incomplete and cannot be copied.");
  }
  return { name: value.name, files: { ...value.files }, entrypoint: value.entrypoint };
}
