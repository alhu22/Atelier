import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = process.cwd();
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function adminServer(mockAuth = false) {
  const fixtures = {
    "@/integrations/firebase/client": "export const auth = {}; export const firestore = {}; export const firebaseConfigured = true;",
    "@/integrations/firebase/auth": `
      const listeners = new Set();
      const makeUser = role => ({
        uid: role === "admin" ? "admin-uid" : "builder-uid",
        email: role + "@example.test", displayName: "Test " + role, photoURL: "",
        async getIdTokenResult() {
          await new Promise(resolve => setTimeout(resolve, Number(sessionStorage.getItem("test-role-delay") || 0)));
          if (sessionStorage.getItem("test-role-error")) throw new Error("Test access-check failure");
          return { claims: { admin: role === "admin" } };
        }
      });
      let user = sessionStorage.getItem("test-signed-in") ? makeUser(sessionStorage.getItem("test-signed-in")) : null;
      export function observeUser(auth, callback) {
        listeners.add(callback);
        window.testAuthObservers = listeners.size;
        queueMicrotask(() => { if (listeners.has(callback)) callback(user); });
        return () => { listeners.delete(callback); window.testAuthObservers = listeners.size; };
      }
      export async function signInWithGoogle() {
        if (sessionStorage.getItem("test-popup-error")) {
          sessionStorage.removeItem("test-popup-error");
          throw new Error("Test popup failure");
        }
        const role = sessionStorage.getItem("test-role") || "admin";
        user = makeUser(role);
        sessionStorage.setItem("test-signed-in", role);
        listeners.forEach(callback => callback(user));
      }
      export async function signOutUser() {
        user = null;
        sessionStorage.removeItem("test-signed-in");
        listeners.forEach(callback => callback(null));
      }
      export async function recordUserSession() {}
      export async function saveUserProfile() {}
      export async function writeActivity() {}
    `,
    "firebase/firestore": `
      export const doc = (...args) => args;
      export const collection = doc, collectionGroup = doc, query = doc, limit = doc, orderBy = doc;
      export const serverTimestamp = () => new Date();
      export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
      export const getDocs = async () => ({ docs: [], size: 0 });
      export const setDoc = async () => {};
      export const runTransaction = async (_database, update) => update({
        get: getDoc, set: () => {},
      });
      export const deleteDoc = async () => {};
    `,
  };
  const fixturePaths = Object.fromEntries(Object.entries(fixtures).map(([id, source]) => [
    id.startsWith("@/") ? path.join(root, "src", id.slice(2)) : id, source,
  ]));
  const server = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    root: path.join(root, "src"),
    cacheDir: path.join(root, "node_modules/.vite-test-admin-" + String(mockAuth)),
    envDir: false,
    plugins: [
      {
        name: "firebase-test-adapters",
        enforce: "pre",
        resolveId(id) {
          if (mockAuth && (id in fixtures || id in fixturePaths)) return "\0fixture:" + id;
        },
        load(id) {
          if (!id.startsWith("\0fixture:")) return;
          const name = id.slice("\0fixture:".length);
          return fixtures[name] ?? fixturePaths[name];
        },
      },
    ],
    resolve: { alias: { "@": path.join(root, "src") } },
    define: Object.fromEntries(["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "APP_ID"].map((name) =>
      [`import.meta.env.VITE_FIREBASE_${name}`, "undefined"])),
    server: { host: "127.0.0.1", port: 0, strictPort: false, fs: { allow: [root] } },
    logLevel: "error",
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const value = pathname === "/api/health" ? { modelConfigured: false }
      : pathname === "/api/preview" ? { html: "<html><body>Project preview</body></html>" }
      : { configured: false, connected: false, login: null };
    await route.fulfill({ json: value });
  });
  page.setDefaultTimeout(10_000);
  return { server, base, context, page };
}

test("signed-out visitors land on /main without loading protected workspaces", async () => {
  const { server, base, context, page } = await adminServer();
  try {
    const apiRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
    });
    for (const route of ["/", "/main", "/admin", "/builder-uid", "/unknown/path"]) {
      await page.goto(base + route);
      await page.getByRole("heading", { name: "Welcome to Atelier" }).waitFor().catch(async (error) => {
        throw new Error(`${route} -> ${page.url()}: ${await page.locator("body").innerText()}`, { cause: error });
      });
      assert.equal(new URL(page.url()).pathname, "/main");
      assert.equal(await page.title(), "Atelier — Website Studio");
      assert.equal(await page.getByRole("button", { name: "New project" }).count(), 0);
      assert.equal(await page.getByRole("link", { name: "Back to studio" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Sign in with Google" }).isDisabled(), true);
      await page.getByText("Firebase sign-in is not configured.", { exact: false }).waitFor();
    }
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
    await server.close();
  }
});

test("Google admin claim redirects to /admin and sign-out returns to /main", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/");
    await page.evaluate(() => sessionStorage.setItem("test-popup-error", "true"));
    // Frame-stability checks are unavailable on some headless hosts; dispatch real native clicks.
    await page.getByRole("button", { name: "Sign in with Google" }).click({ force: true });
    await page.getByText("Test popup failure").waitFor();
    await page.getByRole("button", { name: "Sign in with Google" }).click({ force: true });
    await page.getByRole("heading", { name: "Users & activity" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin");
    assert.equal(await page.evaluate(() => window.testAuthObservers), 1);
    await page.setViewportSize({ width: 1440, height: 900 });
    const projectsLink = page.getByRole("link", { name: "My projects", exact: true });
    assert.equal(await projectsLink.getAttribute("href"), "/admin-uid");
    await projectsLink.click({ force: true });
    await page.getByRole("button", { name: "New project" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin-uid");
    await page.reload();
    await page.getByRole("button", { name: "New project" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin-uid");
    await page.getByRole("link", { name: "Users", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "Users & activity" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin");
    await page.goto(base + "/builder-uid");
    await page.getByRole("heading", { name: "Users & activity" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin");
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click({ force: true });
    await page.getByRole("button", { name: "Sign in with Google" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/main");
    assert.equal(await page.getByRole("button", { name: "Refresh data" }).count(), 0);
  } finally {
    await context.close();
    await server.close();
  }
});

test("builder users land on their UID and cannot select another user or admin route", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => sessionStorage.setItem("test-role", "builder"));
    await page.getByRole("button", { name: "Sign in with Google" }).click({ force: true });
    await page.getByRole("button", { name: "New project" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
    assert.equal(await page.evaluate(() => window.testAuthObservers), 1);
    for (const route of ["/admin", "/another-user", "/main"]) {
      await page.goto(base + route);
      await page.getByRole("button", { name: "New project" }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/builder-uid");
      assert.equal(await page.getByRole("heading", { name: "Users & activity" }).count(), 0);
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "Welcome to Atelier" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/main");
  } finally {
    await context.close();
    await server.close();
  }
});

test("role loading and verification errors never expose a protected workspace", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => {
      sessionStorage.setItem("test-role-delay", "500");
      sessionStorage.setItem("test-role-error", "true");
    });
    await page.getByRole("button", { name: "Sign in with Google" }).click({ force: true });
    await page.getByText("Checking your account…").waitFor();
    assert.equal(await page.getByRole("heading", { name: "Users & activity" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "New project" }).count(), 0);
    await page.getByText("Test access-check failure").waitFor();
    assert.equal(new URL(page.url()).pathname, "/main");
    await page.getByRole("button", { name: "Sign out and try again" }).click({ force: true });
    await page.getByRole("button", { name: "Sign in with Google" }).waitFor();
  } finally {
    await context.close();
    await server.close();
  }
});

test("OAuth result query survives the /main redirect to the builder workspace", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => sessionStorage.setItem("test-role", "builder"));
    await page.goto(base + "/?github=connected");
    await page.getByRole("button", { name: "Sign in with Google" }).click({ force: true });
    await page.getByText("GitHub connected.", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
  } finally {
    await context.close();
    await server.close();
  }
});
