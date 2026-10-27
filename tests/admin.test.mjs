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
        email: sessionStorage.getItem("test-email") ?? role + "@example.test",
        displayName: sessionStorage.getItem("test-display-name") ?? "Test " + role, photoURL: "",
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
      export async function saveUserProfile(_database, user, displayName, photoURL) {
        if (sessionStorage.getItem("test-profile-error")) throw new Error("Test profile save failure");
        sessionStorage.setItem("test-profile-" + user.uid, JSON.stringify({ displayName, photoURL }));
      }
      export async function writeActivity() {}
    `,
    "firebase/firestore": `
      export const doc = (...args) => Object.assign(args, { path: args.slice(1).join("/") });
      export const collection = doc, collectionGroup = doc, query = doc, limit = doc, orderBy = doc;
      export const serverTimestamp = () => new Date();
      const storedData = () => JSON.parse(sessionStorage.getItem("test-admin-data") || "{}");
      export const getDoc = async (reference) => {
        if (reference[1] === "templates") {
          if (sessionStorage.getItem("test-template-pending")) {
            await new Promise(resolve => { window.resolveTemplateRead = resolve; });
          }
          const record = (storedData().templates || []).find(template => template.id === reference[2]);
          return { exists: () => Boolean(record), data: () => record };
        }
        if (reference.length === 3 && reference[1] === "users") {
          const profile = JSON.parse(sessionStorage.getItem("test-profile-" + reference[2]) || "null");
          return { exists: () => Boolean(profile), data: () => profile };
        }
        const record = (storedData().projects || []).find(project =>
          project.owner === reference[2] && project.id === reference[4]);
        return { exists: () => Boolean(record), data: () => record };
      };
      export const getDocFromServer = getDoc;
      export const getDocs = async (reference) => {
        (window.testReadPaths ||= []).push(reference.path);
        const data = JSON.parse(sessionStorage.getItem("test-admin-data") || "{}");
        const segments = reference.flat(Infinity);
        if (segments.includes("templates") && sessionStorage.getItem("test-template-error")) {
          throw new Error("Test templates unavailable");
        }
        let records = segments.includes("templates") ? data.templates || []
          : segments.includes("projects") ? data.projects || []
          : segments.includes("users") ? data.profiles || [] : [];
        if (segments.includes("users") && segments.includes("projects")) {
          records = records.filter(project => project.owner === segments[segments.indexOf("users") + 1]);
        }
        const docs = records.map(record => ({
          id: record.id,
          data: () => record,
          ref: { parent: { parent: { id: record.owner } } },
        }));
        return { docs, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } };
      };
      export const getDocsFromServer = getDocs;
      const subscriptions = new Set();
      const notify = async () => {
        for (const subscription of subscriptions) {
          subscription.next(await getDocs(subscription.reference));
        }
      };
      export const onSnapshot = (reference, _options, next) => {
        const subscription = { reference, next };
        subscriptions.add(subscription);
        window.testProjectSubscriptions = subscriptions.size;
        void getDocs(reference).then(snapshot => {
          if (subscriptions.has(subscription)) next(snapshot);
        });
        return () => {
          subscriptions.delete(subscription);
          window.testProjectSubscriptions = subscriptions.size;
        };
      };
      export const setDoc = async (reference, value) => {
        if (reference[1] !== "users" || reference[3] !== "projects") return;
        const data = storedData();
        const record = { ...value, id: reference[4] };
        data.projects = [
          ...(data.projects || []).filter(project => project.owner !== record.owner || project.id !== record.id),
          record,
        ];
        (window.testSavedPaths ||= []).push(reference.path);
        sessionStorage.setItem("test-admin-data", JSON.stringify(data));
        await notify();
      };
      export const runTransaction = async (_database, update) => update({
        get: getDoc, set: setDoc,
      });
      export const deleteDoc = async (reference) => {
        const segments = reference.slice(1);
        (window.testDeletedPaths ||= []).push(segments.join("/"));
        if (sessionStorage.getItem("test-delete-pending")) {
          await new Promise(resolve => { window.resolveProjectDeletion = resolve; });
        }
        if (sessionStorage.getItem("test-delete-error")) throw new Error("Test deletion failure");
        const data = JSON.parse(sessionStorage.getItem("test-admin-data") || "{}");
        data.projects = (data.projects || []).filter(project =>
          project.owner !== segments[1] || project.id !== segments[3]);
        sessionStorage.setItem("test-admin-data", JSON.stringify(data));
        await notify();
      };
      window.testRemoteDelete = (owner, id) => deleteDoc(doc({}, "users", owner, "projects", id));
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
    for (const route of ["/", "/main", "/admin", "/builder-uid", "/builder-uidprofile", "/builder-uid/projects/private", "/unknown/path"]) {
      await page.goto(base + route);
      await page.getByRole("heading", { name: "Welcome, there" }).waitFor().catch(async (error) => {
        throw new Error(`${route} -> ${page.url()}: ${await page.locator("body").innerText()}`, { cause: error });
      });
      assert.equal(new URL(page.url()).pathname, "/main");
      assert.equal(await page.title(), "Atelier — Website Studio");
      await page.getByRole("textbox", { name: "Describe a website to start building" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "My profile", exact: true }).count(), 0);
      assert.equal(await page.getByRole("link", { name: "Back to studio" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Sign in with Google" }).isDisabled(), true);
      await page.getByText("Firebase sign-in is not configured.", { exact: false }).waitFor();
    }
    assert.ok(apiRequests.every((url) => ["/api/health", "/api/github/status"].includes(new URL(url).pathname)));
  } finally {
    await context.close();
    await server.close();
  }
});

test("guests can browse the welcome page but must sign in before starting a project", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.getByRole("heading", { name: "Welcome, there" }).waitFor();
    await page.getByText("Sign in to browse templates and start building.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.testReadPaths ?? []), []);
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths ?? []), []);
    await page.evaluate(() => {
      sessionStorage.setItem("test-role", "builder");
      sessionStorage.setItem("test-popup-error", "true");
    });
    await page.getByRole("textbox", { name: "Describe a website to start building" }).fill("A portfolio");
    await page.getByRole("button", { name: "Send message" }).click({ force: true });
    await page.getByText("Test popup failure").waitFor();
    assert.equal(new URL(page.url()).pathname, "/main");
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths ?? []), []);
    assert.equal(await page.getByRole("dialog", { name: "My workspace projects" }).count(), 0);
    await page.getByRole("button", { name: "Projects", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "Welcome, Test" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths ?? []), []);
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
    await page.getByRole("button", { name: "My profile", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "My profile", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin-uidprofile");
    await page.getByText("Administrator", { exact: true }).waitFor();
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
    for (const route of ["/admin", "/another-user", "/another-userprofile", "/another-user/projects/private", "/main"]) {
      await page.goto(base + route);
      await page.getByRole("button", { name: "New project" }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/builder-uid");
      assert.equal(await page.getByRole("heading", { name: "Users & activity" }).count(), 0);
    }
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    await page.getByRole("button", { name: "New project" }).click({ force: true });
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
    await page.route("**/api/chat", route => route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"done","project":null}\n\n' }));
    await page.getByRole("textbox", { name: "Describe a website to start building", exact: true }).fill("A portfolio");
    await page.getByRole("textbox", { name: "Describe a website to start building", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Sign out", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "Welcome, there" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/main");
  } finally {
    await context.close();
    await server.close();
  }
});

test("My profile opens the owner page and saves, cancels, and reloads personal information", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => {
      sessionStorage.setItem("test-signed-in", "builder");
      sessionStorage.setItem("test-display-name", "");
    });
    await page.goto(base + "/builder-uid");
    await page.getByRole("button", { name: "My profile", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "My profile", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uidprofile");
    await page.getByText("builder@example.test", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("User ID", { exact: true }).count(), 0);
    assert.equal(await page.getByText("builder-uid", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Profile photo URL", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog", { name: "My profile" }).count(), 0);
    await page.waitForFunction(() => window.testProjectSubscriptions === 0);
    const name = page.getByLabel("Display name", { exact: true });
    const photo = page.getByLabel("Choose profile photo", { exact: true });
    const image = page.getByRole("img", { name: "Profile photo", exact: true });
    const upload = {
      name: "portrait.png",
      mimeType: "image/png",
      buffer: Buffer.from(await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 400;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 800, 400);
        gradient.addColorStop(0, "#2040a0");
        gradient.addColorStop(1, "#f0a020");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 800, 400);
        return canvas.toDataURL("image/png").split(",")[1];
      }), "base64"),
    };
    assert.equal(await name.inputValue(), "");
    await name.fill("Discard me");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload profile photo", exact: true }).click({ force: true });
    await (await chooser).setFiles(upload);
    await image.waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click({ force: true });
    assert.equal(await name.inputValue(), "");
    assert.equal(await image.count(), 0);
    await name.fill("  Taylor Builder  ");
    await photo.setInputFiles(upload);
    await image.waitFor();
    const savedPhoto = await image.getAttribute("src");
    assert.match(savedPhoto, /^data:image\/jpeg;base64,/);
    assert.ok(savedPhoto.length <= 102400);
    await page.waitForFunction(() => document.querySelector('img[alt="Profile photo"]')?.naturalWidth === 256);
    assert.equal(await image.evaluate(element => element.naturalHeight), 128);
    await page.evaluate(() => sessionStorage.setItem("test-profile-error", "true"));
    await page.getByRole("button", { name: "Save profile", exact: true }).click({ force: true });
    await page.getByRole("alert").filter({ hasText: "Test profile save failure" }).waitFor();
    assert.equal(await name.inputValue(), "  Taylor Builder  ");
    await page.evaluate(() => sessionStorage.removeItem("test-profile-error"));
    await page.getByRole("button", { name: "Save profile", exact: true }).click({ force: true });
    await page.getByText("Profile saved.", { exact: true }).waitFor();
    assert.equal(await name.inputValue(), "Taylor Builder");
    await page.reload();
    await page.getByRole("heading", { name: "My profile", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector("#profile-name")?.value === "Taylor Builder");
    assert.equal(await image.getAttribute("src"), savedPhoto);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole("link", { name: "Back to studio", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "Welcome, Taylor", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
  } finally {
    await context.close();
    await server.close();
  }
});

test("profile photo uploads reject unsupported, oversized, and unreadable images", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => sessionStorage.setItem("test-signed-in", "builder"));
    await page.goto(base + "/builder-uidprofile");
    const photo = page.getByLabel("Choose profile photo", { exact: true });
    for (const [name, mimeType, buffer, error] of [
      ["file.txt", "text/plain", Buffer.from("Not an image"), "Choose a JPEG, PNG, WebP, or GIF image."],
      ["large.png", "image/png", Buffer.alloc(5 * 1024 * 1024 + 1), "Choose an image smaller than 5 MB."],
      ["broken.png", "image/png", Buffer.from("Not an image"), "This image could not be read. Please choose another image."],
    ]) {
      await photo.setInputFiles({ name, mimeType, buffer });
      await page.getByRole("alert").filter({ hasText: error }).waitFor();
      assert.equal(await page.getByRole("img", { name: "Profile photo", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Save profile", exact: true }).isEnabled(), true);
    }
  } finally {
    await context.close();
    await server.close();
  }
});

test("profile GitHub controls show configuration, retry errors, disconnect, and start OAuth", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => sessionStorage.setItem("test-signed-in", "builder"));
    await page.goto(base + "/builder-uidprofile");
    await page.getByText("GitHub connection is not configured.", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Connect GitHub", exact: true }).count(), 0);
    let statusError = true;
    let disconnectError = true;
    let connected = true;
    await page.route("**/api/github/status", route => route.fulfill(statusError
      ? { status: 503, json: { error: "Test GitHub status failure" } }
      : { json: { configured: true, connected, login: connected ? "taylor" : null } }));
    await page.route("**/api/github/logout", route => {
      assert.equal(route.request().method(), "POST");
      if (disconnectError) return route.fulfill({ status: 503, json: { error: "Test disconnect failure" } });
      connected = false;
      return route.fulfill({ json: { connected: false } });
    });
    await page.reload();
    await page.getByText("Test GitHub status failure", { exact: true }).waitFor();
    statusError = false;
    await page.route("https://github.com/taylor.png?size=96", route => route.fulfill({
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64"),
    }));
    await page.getByRole("button", { name: "Retry connection check" }).click({ force: true });
    const githubPhoto = page.getByRole("img", { name: "GitHub profile photo for @taylor", exact: true });
    await githubPhoto.waitFor();
    await page.waitForFunction(() => document.querySelector('img[alt="GitHub profile photo for @taylor"]')?.naturalWidth > 0);
    assert.equal(await githubPhoto.getAttribute("src"), "https://github.com/taylor.png?size=96");
    assert.equal(await page.getByRole("link", { name: "Connected GitHub profile: @taylor" }).getAttribute("href"), "https://github.com/taylor");
    assert.equal(await page.getByText("Connected as @taylor.", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Disconnect GitHub", exact: true }).click({ force: true });
    await page.getByText("Test disconnect failure", { exact: true }).waitFor();
    disconnectError = false;
    await page.getByRole("button", { name: "Disconnect GitHub", exact: true }).click({ force: true });
    await page.getByText("GitHub is not connected.", { exact: true }).waitFor();
    await page.route("**/api/github/login", route => route.fulfill({ contentType: "text/plain", body: "OAuth started" }));
    await page.getByRole("button", { name: "Connect GitHub", exact: true }).click({ force: true });
    await page.waitForURL(base + "/api/github/login");
  } finally {
    await context.close();
    await server.close();
  }
});

test("home waits for auth, creates nothing, and starts one project with the first prompt", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => {
      sessionStorage.setItem("test-signed-in", "builder");
      sessionStorage.setItem("test-display-name", "Basir Rahman");
      sessionStorage.setItem("test-role-delay", "600");
    });
    let requests = [];
    await page.route("**/api/chat", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"type":"delta","text":"Building from your idea."}\n\ndata: {"type":"done","project":null}\n\n',
      });
    });
    await page.goto(base + "/builder-uid");
    await page.getByText("Checking your account…").waitFor();
    assert.equal(await page.getByRole("heading", { name: /Welcome,/ }).count(), 0);
    await page.getByRole("heading", { name: "Welcome, Basir" }).waitFor();
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    assert.equal(await page.locator('iframe[title="Website preview"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("atelier-studio-project"))), []);
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths || []), []);
    assert.equal(requests.length, 0);
    const input = page.getByRole("textbox", { name: "Describe a website to start building", exact: true });
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await input.fill(Array(20).fill("A line of the website brief").join("\n"));
    await page.waitForFunction(() => document.querySelector(".welcome-input").clientHeight === 240);
    assert.equal(await input.evaluate(element => element.scrollHeight > element.clientHeight), true);
    await input.fill("");
    await page.waitForFunction(() => document.querySelector(".welcome-input").clientHeight === 120);
    await page.getByRole("region", { name: "Atelier templates" }).waitFor();
    assert.equal(await page.getByText("Try one of these", { exact: true }).count(), 0);
    assert.equal(requests.length, 0);
    await input.fill("A personal portfolio");
    await input.press("Shift+Enter");
    await input.press("End");
    await input.type("with a contact page");
    const prompt = await input.inputValue();
    assert.match(prompt, /\n/);
    await input.press("Enter");
    await page.getByText("Building from your idea.", { exact: true }).waitFor();
    const projectId = new URL(page.url()).pathname.split("/").at(-1);
    assert.match(new URL(page.url()).pathname, /^\/builder-uid\/projects\/[^/]+$/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].prompt, prompt);
    assert.deepEqual(requests[0].conversation, []);
    assert.match(requests[0].currentFiles["src/components/sections/HeroSection.tsx"], /Your new website/);
    assert.match(requests[0].currentFiles["README.md"], /^# Untitled project/);
    await page.waitForFunction((id) => (window.testSavedPaths || []).includes("users/builder-uid/projects/" + id), projectId);
    const messages = await page.evaluate(id => JSON.parse(localStorage.getItem("atelier-chat-v1:builder-uid:" + id)), projectId);
    assert.equal(messages.filter(message => message.role === "user").length, 1);
    assert.equal(messages[0].content, prompt);
    await page.reload();
    await page.getByText("Building from your idea.", { exact: true }).waitFor();
    assert.equal(requests.length, 1);
    await page.getByRole("button", { name: "New project" }).click({ force: true });
    await page.getByRole("heading", { name: "Welcome, Basir" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-admin-data")).projects.length), 1,
      await page.evaluate(() => JSON.stringify(JSON.parse(sessionStorage.getItem("test-admin-data")).projects.map(({ id, name }) => ({ id, name })))));
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths || []), []);
    await page.getByRole("button", { name: "New project" }).click({ force: true });
    await page.getByRole("heading", { name: "Welcome, Basir" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-admin-data")).projects.length), 1);
    assert.equal(requests.length, 1);
    assert.equal(await page.getByRole("article", { name: "Your message" }).count(), 0);
  } finally {
    await context.close();
    await server.close();
  }
});

test("home layout adapts to narrow screens and respects keyboard focus and reduced motion", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedTemplates(page);
    await page.evaluate(() => {
      sessionStorage.setItem("test-signed-in", "builder");
      sessionStorage.setItem("test-display-name", "Basir Rahman");
    });
    await page.goto(base + "/builder-uid");
    const heading = page.getByRole("heading", { name: "Welcome, Basir" });
    await heading.waitFor();
    await page.locator(".welcome-templates").evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    const main = await page.locator("main").boundingBox();
    const card = await page.locator(".welcome-card").boundingBox();
    const intro = await page.locator(".welcome-intro").boundingBox();
    assert.equal(card.width, 760);
    assert.equal(card.x + card.width / 2, main.x + main.width / 2);
    assert.equal(card.y - (intro.y + intro.height), 24);
    assert.equal((await page.locator(".welcome-input").boundingBox()).height, 120);
    assert.ok(intro.y / 900 >= 0.3 && intro.y / 900 <= 0.35);
    assert.equal(await heading.evaluate(element => getComputedStyle(element).fontSize), "48px");
    const templates = page.getByRole("region", { name: "Atelier templates" });
    assert.equal(await templates.getByRole("heading").count(), 0);
    assert.equal(await page.getByText("Start with a curated website. Make it your own.", { exact: true }).count(), 0);
    assert.equal(await templates.getByText("A curated home and lifestyle store.", { exact: true }).count(), 0);
    const templateCard = await templates.getByRole("button").first().boundingBox();
    assert.equal(templateCard.width, 540);
    assert.equal(templateCard.x + templateCard.width / 2, card.x + card.width / 2);
    assert.ok(templateCard.height >= 400 && templateCard.height < 450);
    assert.ok(templateCard.y - (card.y + card.height) >= 96);
    const preview = templates.getByRole("img", { name: "Maison — Home & Lifestyle homepage preview" });
    await preview.scrollIntoViewIfNeeded();
    await preview.evaluate(image => image.decode());
    assert.equal(await preview.evaluate(image => image.naturalWidth), 1440);
    await templates.getByText("Preview unavailable", { exact: true }).waitFor();

    const input = page.locator(".welcome-input");
    await input.fill("A portfolio");
    await input.press("Tab");
    assert.equal(await page.locator(".welcome-submit").evaluate(element =>
      element === document.activeElement && getComputedStyle(element).outlineStyle === "solid"), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".welcome-template").first().evaluate(element =>
      element === document.activeElement && getComputedStyle(element).outlineStyle === "solid"), true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.reload();
      await heading.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator(".welcome-card").evaluate(element =>
        getComputedStyle(element).animationName), "none");
      if (width < 640) {
        assert.equal(await heading.evaluate(element => getComputedStyle(element).fontSize), "32px");
        const mobileCard = await page.locator(".welcome-card").boundingBox();
        assert.equal(mobileCard.x, 16);
        assert.equal(mobileCard.width, width - 32);
        for (const chip of await page.locator(".welcome-template").all()) {
          const bounds = await chip.boundingBox();
          assert.equal(bounds.x, 16);
          assert.equal(bounds.width, width - 32);
        }
      }
    }
  } finally {
    await context.close();
    await server.close();
  }
});

async function seedTemplates(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 900;
    const paint = canvas.getContext("2d");
    paint.fillStyle = "#f8f5ee";
    paint.fillRect(0, 0, 1440, 900);
    paint.fillStyle = "#27241f";
    paint.font = "72px serif";
    paint.fillText("Maison", 80, 120);
    const maison = {
      id: "maison", name: "Maison — Home & Lifestyle", description: "A curated home and lifestyle store.", order: 0,
      previewImage: canvas.toDataURL("image/jpeg"),
      files: { "package.json": "{}", "src/main.tsx": "export {};", "index.html": "<html>Maison</html>" },
      entrypoint: "index.html",
    };
    const data = JSON.parse(sessionStorage.getItem("test-admin-data") || "{}");
    data.templates = [{ ...maison, previewImage: undefined, id: "second", name: "Another template", order: 1 }, maison];
    sessionStorage.setItem("test-admin-data", JSON.stringify(data));
    return maison;
  });
}

test("templates create independent persisted copies without generating or changing existing projects", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedWorkspace(page);
    const maison = await seedTemplates(page);
    const originals = await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-admin-data")));
    let generations = 0;
    page.on("request", request => { if (request.url().endsWith("/api/chat")) generations += 1; });
    await page.goto(base + "/builder-uid");
    const templates = page.getByRole("region", { name: "Atelier templates" });
    const useMaison = templates.getByRole("button", { name: `Use ${maison.name} template`, exact: true });
    await useMaison.waitFor();
    assert.match(await templates.getByRole("button").first().innerText(), /Maison/);
    await page.evaluate(() => sessionStorage.setItem("test-template-pending", "true"));
    await useMaison.focus();
    await useMaison.press("Enter");
    await page.waitForFunction(() => Boolean(window.resolveTemplateRead));
    assert.equal(await useMaison.isDisabled(), true);
    await useMaison.dispatchEvent("click");
    await page.evaluate(() => {
      sessionStorage.removeItem("test-template-pending");
      window.resolveTemplateRead();
    });
    await page.waitForURL(/\/builder-uid\/projects\/[^/]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1);
    assert.notEqual(id, maison.id);
    await page.waitForFunction(id => (window.testSavedPaths || []).includes("users/builder-uid/projects/" + id), id);
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-admin-data")));
    const copy = saved.projects.find(project => project.id === id);
    assert.equal(saved.projects.length, originals.projects.length + 1);
    assert.deepEqual(saved.projects.filter(project => project.id !== id), originals.projects);
    assert.deepEqual(saved.templates, originals.templates);
    assert.equal(copy.owner, "builder-uid");
    assert.equal(copy.name, maison.name);
    assert.equal(copy.generated, true);
    assert.deepEqual(copy.files, maison.files);
    assert.equal(generations, 0);
    const chat = page.locator("#workspace-chat");
    await chat.getByRole("heading", { name: "Make it your own" }).waitFor();
    await chat.getByText(`${maison.name} is ready to customize.`, { exact: false }).waitFor();
    assert.equal(await chat.getByRole("heading", { name: "What are we making?" }).count(), 0);
    assert.equal(await chat.getByRole("button", { name: "A warm, editorial site for a neighborhood bakery" }).count(), 0);
    await page.getByRole("button", { name: "code", exact: true }).click({ force: true });
    const editor = page.getByRole("textbox", { name: "Selected project file source" });
    await editor.fill("<html>My Maison copy</html>");
    await page.waitForFunction(id =>
      JSON.parse(sessionStorage.getItem("test-admin-data")).projects.find(project => project.id === id)
        .files["index.html"] === "<html>My Maison copy</html>", id);
    await page.reload();
    await chat.getByRole("heading", { name: "Make it your own" }).waitFor();
    await page.getByRole("button", { name: "code", exact: true }).click({ force: true });
    assert.equal(await editor.inputValue(), "<html>My Maison copy</html>");
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-admin-data")).templates), originals.templates);
    assert.equal(generations, 0);
  } finally {
    await context.close();
    await server.close();
  }
});

test("templates expose recoverable list errors and never create a project from a removed template", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await page.evaluate(() => {
      sessionStorage.setItem("test-signed-in", "builder");
      sessionStorage.setItem("test-template-error", "true");
    });
    const maison = await seedTemplates(page);
    await page.goto(base + "/builder-uid");
    await page.getByRole("alert").filter({ hasText: "Test templates unavailable" }).waitFor();
    await page.evaluate(() => sessionStorage.removeItem("test-template-error"));
    await page.getByRole("button", { name: "Retry templates" }).click();
    const useMaison = page.getByRole("button", { name: `Use ${maison.name} template`, exact: true });
    await useMaison.waitFor();
    await page.evaluate(() => sessionStorage.setItem("test-admin-data", JSON.stringify({ templates: [] })));
    await useMaison.click();
    await page.getByRole("alert").filter({ hasText: "no longer available" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/builder-uid");
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths || []), []);
    await page.reload();
    await page.getByText("Templates are coming soon.", { exact: false }).waitFor();
  } finally {
    await context.close();
    await server.close();
  }
});

test("leaving the welcome page cancels a pending template copy", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedTemplates(page);
    await page.evaluate(() => {
      sessionStorage.setItem("test-signed-in", "builder");
      sessionStorage.setItem("test-template-pending", "true");
    });
    await page.goto(base + "/builder-uid");
    await page.getByRole("button", { name: /Use Maison.*template/ }).click();
    await page.waitForFunction(() => Boolean(window.resolveTemplateRead));
    await page.getByRole("button", { name: "My profile", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "My profile", exact: true }).waitFor();
    await page.evaluate(async () => {
      window.resolveTemplateRead();
      await new Promise(resolve => setTimeout(resolve, 300));
    });
    assert.equal(new URL(page.url()).pathname, "/builder-uidprofile");
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("atelier-studio-project"))), []);
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths || []), []);
  } finally {
    await context.close();
    await server.close();
  }
});

test("home greeting falls back to email then there and preserves existing files", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedWorkspace(page);
    const original = await page.evaluate(() => sessionStorage.getItem("test-admin-data"));
    await page.evaluate(() => {
      sessionStorage.setItem("test-display-name", "");
      sessionStorage.setItem("test-email", "basir@example.test");
    });
    await page.goto(base + "/builder-uid");
    await page.getByRole("heading", { name: "Welcome, basir" }).waitFor();
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("test-admin-data")), original);
    assert.deepEqual(await page.evaluate(() => window.testSavedPaths || []), []);
    await page.evaluate(() => sessionStorage.setItem("test-email", ""));
    await page.reload();
    await page.getByRole("heading", { name: "Welcome, there" }).waitFor();
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("test-admin-data")), original);
  } finally {
    await context.close();
    await server.close();
  }
});

async function seedAdminProjects(page) {
  await page.evaluate(() => {
    sessionStorage.setItem("test-signed-in", "admin");
    sessionStorage.setItem("test-admin-data", JSON.stringify({
      profiles: [
        { id: "builder-uid", displayName: "Builder", email: "builder@example.test" },
        { id: "other-uid", displayName: "Other", email: "other@example.test" },
      ],
      projects: [
        { id: "shared-id", owner: "builder-uid", name: "Builder project", entrypoint: "index.html" },
        { id: "shared-id", owner: "other-uid", name: "Other project", entrypoint: "index.html" },
      ],
    }));
  });
}

test("admins delete the selected owner's project without a confirmation dialog and update saved counts", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedAdminProjects(page);
    await page.goto(base + "/admin");
    const savedCount = page.locator("article").filter({ hasText: "Saved projects" });
    const deleteButton = page.getByRole("button", { name: "Delete Builder project", exact: true });
    await deleteButton.waitFor();
    assert.match(await savedCount.innerText(), /2$/);
    const dialogs = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.evaluate(() => sessionStorage.setItem("test-delete-pending", "true"));
    await deleteButton.click({ force: true });
    await page.waitForFunction(() => Boolean(window.resolveProjectDeletion));
    assert.equal(await deleteButton.isDisabled(), true);
    assert.equal(await deleteButton.innerText(), "Deleting…");
    assert.equal(await page.getByRole("button", { name: "Refresh data" }).isDisabled(), true);
    await page.evaluate(() => window.resolveProjectDeletion());
    await page.getByText("No saved projects.", { exact: true }).waitFor();
    assert.deepEqual(dialogs, []);
    assert.match(await savedCount.innerText(), /1$/);
    assert.deepEqual(await page.evaluate(() => window.testDeletedPaths), [
      "users/builder-uid/projects/shared-id",
    ]);
    await page.getByRole("button", { name: "Other other@example.test" }).click({ force: true });
    await page.getByRole("button", { name: "Delete Other project", exact: true }).waitFor();
    await page.reload();
    await page.getByText("No saved projects.", { exact: true }).waitFor();
    assert.match(await savedCount.innerText(), /1$/);
    await page.getByRole("button", { name: "Other other@example.test" }).click({ force: true });
    await page.getByRole("button", { name: "Delete Other project", exact: true }).waitFor();
  } finally {
    await context.close();
    await server.close();
  }
});

test("failed admin deletions keep the project and allow retry", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedAdminProjects(page);
    await page.evaluate(() => sessionStorage.setItem("test-delete-error", "true"));
    await page.goto(base + "/admin");
    const deleteButton = page.getByRole("button", { name: "Delete Builder project", exact: true });
    await deleteButton.waitFor();
    await deleteButton.click({ force: true });
    await page.getByText("Test deletion failure", { exact: false }).waitFor();
    assert.equal(await deleteButton.isEnabled(), true);
    assert.match(await page.locator("article").filter({ hasText: "Saved projects" }).innerText(), /2$/);
    await page.evaluate(() => sessionStorage.removeItem("test-delete-error"));
    await deleteButton.click({ force: true });
    await page.getByText("No saved projects.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Test deletion failure", { exact: false }).count(), 0);
  } finally {
    await context.close();
    await server.close();
  }
});

async function seedWorkspace(page, { staleLocal = false } = {}) {
  await page.evaluate(({ staleLocal }) => {
    sessionStorage.setItem("test-signed-in", "builder");
    const makeProject = (id, name) => ({
      id, projectId: id, owner: "builder-uid", name,
      files: { "package.json": "{}", "src/main.tsx": "export {};" },
      entrypoint: "src/main.tsx", settings: {}, generated: true,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    });
    const sunday = makeProject("sunday", "Sunday House");
    const keeper = makeProject("keeper", "Saved website");
    const inactive = makeProject("inactive", "Inactive project");
    sessionStorage.setItem("test-admin-data", JSON.stringify({
      projects: staleLocal ? [keeper] : [sunday, keeper, inactive],
    }));
    const local = staleLocal
      ? [sunday, keeper, { ...makeProject("draft", "Offline draft"), pendingCreation: true }]
      : [sunday, keeper, inactive];
    for (const project of local) {
      localStorage.setItem("atelier-studio-project-v1:builder-uid:" + project.id, JSON.stringify(project));
    }
  }, { staleLocal });
}

test("workspace drops deleted cached projects on reload but preserves unsynced drafts", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedWorkspace(page, { staleLocal: true });
    await page.goto(base + "/builder-uid");
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    await page.getByRole("button", { name: "Projects", exact: true }).click({ force: true });
    const dialog = page.getByRole("dialog", { name: "My workspace projects" });
    await dialog.getByRole("button", { name: /Saved website/ }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: /Sunday House/ }).count(), 0);
    await dialog.getByRole("button", { name: /Offline draft/ }).click({ force: true });
    await page.waitForFunction(() => (window.testSavedPaths || []).includes("users/builder-uid/projects/draft"));
    await page.reload();
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    await page.getByRole("button", { name: "Projects", exact: true }).click({ force: true });
    await dialog.getByRole("button", { name: /Offline draft/ }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: /Sunday House/ }).count(), 0);
    assert.equal(await page.evaluate(() =>
      localStorage.getItem("atelier-studio-project-v1:builder-uid:sunday")), null);
    assert.equal(await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("test-admin-data")).projects.some(project => project.id === "sunday")), false);
  } finally {
    await context.close();
    await server.close();
  }
});

test("remote deletions remove open workspace projects and caches without resurrecting them", async () => {
  const { server, base, context, page } = await adminServer(true);
  try {
    await page.goto(base + "/main");
    await seedWorkspace(page);
    await page.goto(base + "/builder-uid");
    await page.waitForFunction(() => window.testProjectSubscriptions === 1);
    const renameButton = page.getByTitle("Rename project");
    await page.getByRole("button", { name: "Projects", exact: true }).click({ force: true });
    const dialog = page.getByRole("dialog", { name: "My workspace projects" });
    await dialog.getByRole("button", { name: /Sunday House/ }).click({ force: true });
    await page.getByRole("button", { name: "Projects", exact: true }).click({ force: true });
    await page.evaluate(() => window.testRemoteDelete("builder-uid", "inactive"));
    await page.waitForFunction(() =>
      !localStorage.getItem("atelier-studio-project-v1:builder-uid:inactive"));
    assert.equal(await dialog.getByRole("button", { name: /Inactive project/ }).count(), 0);
    assert.match(await renameButton.innerText(), /Sunday House/);
    await page.evaluate(() => window.testRemoteDelete("builder-uid", "sunday"));
    await page.waitForFunction(() => document.querySelector('[title="Rename project"]')?.textContent.includes("Saved website"));
    assert.equal(await dialog.getByRole("button", { name: /Sunday House/ }).count(), 0);
    await page.evaluate(() => window.testRemoteDelete("builder-uid", "keeper"));
    await page.waitForFunction(() => document.querySelector('[title="Rename project"]')?.textContent.includes("Untitled project"));
    await page.waitForFunction(() =>
      JSON.parse(sessionStorage.getItem("test-admin-data")).projects.some(project => project.name === "Untitled project"));
    for (const id of ["sunday", "keeper", "inactive"]) {
      assert.equal(await page.evaluate((id) =>
        localStorage.getItem("atelier-studio-project-v1:builder-uid:" + id), id), null);
      assert.equal(await page.evaluate((id) =>
        JSON.parse(sessionStorage.getItem("test-admin-data")).projects.some(project => project.id === id), id), false);
    }
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click({ force: true });
    await page.getByRole("button", { name: "Sign out", exact: true }).click({ force: true });
    await page.getByRole("heading", { name: "Welcome, there" }).waitFor();
    assert.equal(await page.evaluate(() => window.testProjectSubscriptions), 0);
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
