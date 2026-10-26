import type { Timestamp } from "firebase/firestore";

export type ProjectFiles = Record<string, string>;

export interface ProjectSettings {
  [key: string]: string | number | boolean | null;
}

export interface StudioProject {
  id: string;
  name: string;
  owner?: string;
  files: ProjectFiles;
  entrypoint: string;
  generated: boolean;
  settings: ProjectSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSnapshot {
  files: ProjectFiles;
  entrypoint: string;
  activeFile: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: Timestamp | Date | null;
  lastSeenAt: Timestamp | Date | null;
}

export interface AdminProject {
  id: string;
  name: string;
  owner: string;
  entrypoint: string;
  updatedAt: Timestamp | Date | null;
}

export interface ActivityEvent {
  id: string;
  owner: string;
  type: string;
  userEmail: string;
  occurredAt: Timestamp | Date | null;
}

export interface GitHubRepository {
  full_name: string;
  private: boolean;
  default_branch: string | null;
}
