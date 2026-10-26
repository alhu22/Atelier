export async function withFirestoreContext<T>(
  operation: string,
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const detail = error instanceof Error ? error.message : String(error);
    const denied = code.endsWith("permission-denied") || detail.includes("insufficient permissions");
    throw new Error(
      `Firestore ${operation} failed at ${path}${code ? ` (${code})` : ""}: ${detail}` +
      (denied ? " Check the signed-in UID and the deployed firestore.rules for this path; projects use the owner field and support up to 100 files." : ""),
      { cause: error },
    );
  }
}
