import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createServer as createHttpServer } from "node:http";
import { chromium } from "playwright";
import { createServer } from "vite";
import JSZip from "jszip";
import { checkProjectTypes, compileProject } from "../scripts/compile-project.mjs";

const root = process.cwd();
const templateRoot = path.join(root, "templates/react");
const files = {};
for (const name of await readdir(templateRoot, { recursive: true })) {
  if (name.split(path.sep).some((part) => ["dist", "node_modules", ".git"].includes(part))) continue;
  if (!/\.(tsx?|css|html|json|js|md|svg)$/.test(name) || name.endsWith("package-lock.json")) continue;
  files[name.split(path.sep).join("/")] = await readFile(path.join(templateRoot, name), "utf8");
}
let browser;
let server;
let base;
let compiled;

before(async () => {
  compiled = await compileProject(files, true);
  browser = await chromium.launch({ headless: true });
  server = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    root: path.join(root, "src"),
    cacheDir: path.join(root, "node_modules/.vite-test-builder"),
    envDir: false,
    plugins: [
      {
        name: "preserved-builder-under-test",
        enforce: "pre",
        transform(source, id) {
          if (id === path.join(root, "src/main.tsx")) {
            return source.replace('import { App } from "@/App";', 'import { Index as App } from "@/pages/Index";');
          }
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
  base = `http://127.0.0.1:${server.httpServer.address().port}`;
});

after(async () => {
  await server?.close();
  await browser?.close();
});

async function isolatedPage() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: "reduce" });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith(base) || url.startsWith("data:") ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return { context, page };
}

async function previewFrame(page, html = compiled) {
  await page.setContent('<style>body{margin:0}</style><iframe title="Generated website" sandbox="allow-scripts" style="display:block;width:100%;height:900px;border:0"></iframe>');
  await page.locator("iframe").evaluate((frame, source) => { frame.srcdoc = source; }, html);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: /STOR SMAK/ }).waitFor();
  return frame;
}

// Some headless CI hosts do not deliver animation frames; native clicks still work.
const click = (locator) => locator.click({ force: true });

test("delivered source passes strict types; invalid imports and types fail", async () => {
  assert.match(compiled, /STOR SMAK/);
  assert.throws(() => checkProjectTypes({
    ...files, "src/types/broken.ts": "export const count: number = 'wrong';",
  }), /not assignable/);
  await assert.rejects(compileProject({
    ...files, "src/main.tsx": "import '@/pages/Missing';",
  }), /Cannot resolve/);
  const withModule = await compileProject({
    ...files,
    "src/main.tsx": 'import { message } from "./message.mjs"; console.log(message);\n' + files["src/main.tsx"],
    "src/message.mjs": 'export const message = "ES modules are preserved";',
  });
  assert.match(withModule, /ES modules are preserved/);
});

test("preview refuses executable configuration and unavailable dependencies", async () => {
  await assert.rejects(compileProject({
    ...files, "src/styles/globals.css": '@config "/tmp/untrusted.js";',
  }), /cannot load executable configuration/);
  await assert.rejects(compileProject({
    ...files, "src/main.tsx": 'import "unavailable-package";',
  }), /not available/);
  const safe = await compileProject({ ...files, "vite.config.ts": "throw new Error('MUST NOT RUN');" });
  assert.match(safe, /STOR SMAK/);
});

test("Kebabhouse fits desktop, tablet and mobile with working navigation and bundled artwork", async () => {
  const { context, page } = await isolatedPage();
  try {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const frame = await previewFrame(page);
    assert.equal(await frame.getByRole("navigation").getByRole("link").count(), 4);
    assert.equal(await frame.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(246, 241, 231)");
    assert.equal(await frame.getByRole("link", { name: "Se vår meny" }).evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(168, 62, 44)");
    for (const width of [1440, 1024, 768, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await frame.locator("#hem").evaluate((hero) => {
        const bounds = (element) => {
          const { top, right, bottom, left } = element.getBoundingClientRect();
          return { top, right, bottom, left };
        };
        const title = hero.querySelector("h1");
        const image = hero.querySelector("img");
        return {
          columns: getComputedStyle(hero).gridTemplateColumns.split(" ").length,
          overflow: document.documentElement.scrollWidth > innerWidth,
          hero: bounds(hero), title: bounds(title), image: bounds(image),
          badge: bounds(hero.querySelector(".hero-badge")),
          loaded: image.complete && image.naturalWidth > 0,
          titleSize: [title.scrollHeight, title.clientHeight, title.scrollWidth, title.clientWidth],
          clipped: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1,
        };
      });
      assert.equal(layout.columns, width <= 700 ? 1 : 2, `columns at ${width}`);
      assert.equal(layout.overflow, false, `horizontal overflow at ${width}`);
      assert.equal(layout.clipped, false, `headline clipping at ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.title.bottom < layout.hero.bottom);
      assert.ok(layout.loaded);
      for (const edge of ["top", "left"]) assert.ok(layout.badge[edge] >= layout.image[edge], `${edge} badge inset at ${width}`);
      for (const edge of ["bottom", "right"]) assert.ok(layout.badge[edge] <= layout.image[edge], `${edge} badge inset at ${width}`);
      if (width <= 700) assert.ok(layout.image.top > layout.title.bottom);
      assert.equal(await frame.getByRole("button", { name: "Öppna menyn" }).isVisible(), width <= 700);
    }
    const menuToggle = frame.getByRole("button", { name: "Öppna menyn" });
    await menuToggle.focus();
    await menuToggle.press("Enter");
    assert.equal(await frame.getByRole("navigation").isVisible(), true);
    await frame.getByRole("button", { name: "Stäng menyn" }).press("Escape");
    assert.equal(await frame.getByRole("navigation").isVisible(), false);
    for (const [label, id] of [["Om oss", "om-oss"], ["Mer", "mer"], ["Beställ online", "bestall"], ["Hem", "hem"]]) {
      await click(frame.getByRole("button", { name: "Öppna menyn" }));
      await click(frame.getByRole("navigation").getByRole("link", { name: label, exact: true }));
      assert.equal(await frame.getByRole("navigation").isVisible(), false);
      assert.equal(await frame.locator(`#${id}`).evaluate((element) => document.activeElement === element), true);
      assert.ok(await frame.locator(`#${id}`).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top < innerHeight && bounds.bottom > 0;
      }));
    }
    for (const link of await frame.locator('a[href^="#"]').all()) {
      const href = await link.getAttribute("href");
      assert.equal(await frame.locator(href).count(), 1, `${href} resolves`);
    }
    await click(frame.getByRole("link", { name: "Se vår meny" }));
    assert.ok(await frame.locator("#meny").evaluate((element) => Math.abs(element.getBoundingClientRect().top - 24) <= 1));
    await click(frame.getByRole("link", { name: "Till toppen" }));
    assert.equal(await frame.locator("#hem").evaluate((element) => document.activeElement === element), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("follow-up route, hook interaction and local SVG work in compiled preview", async () => {
  const next = { ...files };
  next["src/hooks/useCounter.ts"] = 'import { useState } from "react"; export function useCounter() { const [count, setCount] = useState(0); return { count, increment: () => setCount(value => value + 1) }; }';
  next["src/pages/Counter.tsx"] = 'import { useCounter } from "@/hooks/useCounter"; export function Counter() { const {count, increment} = useCounter(); return <button onClick={increment}>Count {count}</button>; }';
  next["src/app/router.tsx"] = 'import { Counter } from "@/pages/Counter";\n' + next["src/app/router.tsx"].replace("{ index: true", '{ path: "counter", element: <Counter /> }, { index: true');
  next["src/components/layout/Navbar.tsx"] = next["src/components/layout/Navbar.tsx"].replace("</nav>", '<Link to="/counter">Counter</Link><Link to="/missing">Missing</Link></nav>');
  next["public/assets/mark.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>';
  next["src/components/sections/HeroSection.tsx"] = next["src/components/sections/HeroSection.tsx"].replace("<div>", '<div><img src="/assets/mark.svg" alt="Local mark" />');
  const html = await compileProject(next, true);
  const { context, page } = await isolatedPage();
  try {
    const frame = await previewFrame(page, html);
    assert.match(await frame.getByAltText("Local mark").getAttribute("src"), /^data:image\/svg\+xml;base64,/);
    await click(frame.getByRole("link", { name: "Counter", exact: true }));
    await click(frame.getByRole("button", { name: "Count 0" }));
    await frame.getByRole("button", { name: "Count 1" }).waitFor();
    await click(frame.getByRole("link", { name: "Missing", exact: true }));
    await frame.getByRole("heading", { name: "Sidan hittades inte" }).waitFor();
    await click(frame.getByRole("link", { name: "Till startsidan" }));
    await frame.getByRole("heading", { name: /STOR SMAK/ }).waitFor();
  } finally { await context.close(); }
});

test("native internal navigation stays in the sandbox and broken routes render recoverable errors", async () => {
  const next = { ...files };
  next["src/components/layout/Navbar.tsx"] = `export function Navbar() {
    return <nav>{[["/#hem", "Hem"], ["/#om-oss", "Om oss"], ["/mer", "Mer"], ["/bestall", "Beställ online"], ["/broken", "Broken"], ["/missing", "Missing"]].map(([href, text]) => <a key={href} href={href}>{text}</a>)}</nav>;
  }`;
  next["src/pages/Broken.tsx"] = 'export function Broken(): never { throw new Error("Broken route fixture"); }';
  next["src/app/router.tsx"] = 'import { Broken } from "@/pages/Broken";\n' + next["src/app/router.tsx"].replace(
    "{ index: true", '{ path: "broken", element: <Broken /> }, { index: true');
  const html = await compileProject(next, true);
  const { context, page } = await isolatedPage();
  try {
    const frame = await previewFrame(page, html);
    for (const [label, id] of [["Om oss", "om-oss"], ["Mer", "mer"], ["Beställ online", "bestall"], ["Hem", "hem"]]) {
      const link = frame.getByRole("link", { name: label, exact: true });
      await link.focus();
      await link.press("Enter");
      await page.frames()[1].waitForFunction((id) => document.activeElement?.id === id, id, { polling: 100 });
      assert.notEqual(page.frames()[1].url(), "about:blank#blocked");
    }
    await click(frame.getByRole("link", { name: "Missing", exact: true }));
    await frame.getByRole("heading", { name: "Sidan hittades inte" }).waitFor();
    await click(frame.getByRole("link", { name: "Till startsidan" }));
    await click(frame.getByRole("link", { name: "Broken", exact: true }));
    await frame.getByRole("heading", { name: "Sidan kunde inte visas" }).waitFor();
    await click(frame.getByRole("link", { name: "Till startsidan" }));
    await frame.getByRole("heading", { name: /STOR SMAK/ }).waitFor();
  } finally { await context.close(); }
});

test("Vite proxies the registered chat route to the configured backend PORT", async () => {
  let received;
  const backend = createHttpServer((request, response) => {
    received = request.url;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end('data: {"type":"done","project":null}\n\n');
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const oldPort = process.env.PORT;
  process.env.PORT = String(backend.address().port);
  let proxy;
  try {
    proxy = await createServer({
      configFile: path.join(root, "vite.config.ts"),
      server: { port: 0, strictPort: false },
      logLevel: "error",
    });
    await proxy.listen();
    const response = await fetch(`http://127.0.0.1:${proxy.httpServer.address().port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Hello" }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"type":"done"/);
    assert.equal(received, "/api/chat");
  } finally {
    if (oldPort === undefined) delete process.env.PORT;
    else process.env.PORT = oldPort;
    await proxy?.close();
    await new Promise((resolve) => backend.close(resolve));
  }
});

async function mockApi(page, migrate) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/migrate") return migrate(route);
    const value = pathname === "/api/preview" ? { html: compiled }
      : pathname === "/api/health" ? { modelConfigured: false }
      : { configured: false, connected: false, login: null };
    await route.fulfill({ json: value });
  });
}

test("builder initializes and ZIP-exports actual React source, not its own frontend", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockApi(page, () => assert.fail("React starter must not request migration"));
    await page.goto(base);
    await page.frameLocator('iframe[title="Website preview"]').getByRole("heading", { name: /STOR SMAK/ }).waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("atelier-studio-project-v1:local:current")));
    assert.deepEqual(Object.keys(stored.files).sort(), Object.keys(files).sort());
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      click(page.getByRole("button", { name: "↓ ZIP" })),
    ]);
    const archive = await JSZip.loadAsync(await readFile(await download.path()));
    assert.equal(await archive.file("src/pages/Index.tsx").async("string"), files["src/pages/Index.tsx"]);
    assert.ok(archive.file("package.json"));
    assert.equal(archive.file("src/hooks/useStudio.ts"), null);
  } finally { await context.close(); }
});

test("Files panel persists its width and tree supports nested keyboard navigation without losing expansions", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockApi(page, () => assert.fail("React starter must not request migration"));
    await page.goto(base);
    await click(page.getByRole("button", { name: "code", exact: true }));
    const tree = page.getByRole("tree", { name: "Project files" });
    const item = (path) => tree.getByTitle(path, { exact: true });
    assert.equal(await item("src").getAttribute("aria-expanded"), "false");
    assert.equal(await item("index.html").getAttribute("aria-selected"), "true");
    assert.equal(await item("README.md").isVisible(), true);
    assert.equal(await item("src/components").count(), 0);
    await item("src").focus();
    await item("src").press("ArrowRight");
    await item("src").press("ArrowRight");
    assert.equal(await item("src/app").evaluate((el) => el === document.activeElement), true);
    await item("src/app").press("Enter");
    await item("src/app").press("ArrowRight");
    await item("src/app/App.tsx").press("Enter");
    assert.equal(await item("src/app/App.tsx").getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("textbox", { name: "Selected project file source" }).inputValue(), files["src/app/App.tsx"]);
    await click(item("src/components"));
    await click(item("src/components/sections"));
    await click(item("src/components/sections/HeroSection.tsx"));
    assert.equal(await item("src/app").getAttribute("aria-expanded"), "true");
    assert.equal(await item("src/components/sections/HeroSection.tsx").getAttribute("aria-level"), "4");
    assert.equal(await item("src/components/sections/HeroSection.tsx").innerText(), "HeroSection.tsx");
    await item("src/components/sections/HeroSection.tsx").press("ArrowLeft");
    await item("src/components/sections").press("ArrowLeft");
    assert.equal(await item("src/components/sections").getAttribute("aria-expanded"), "false");
    await item("src/components/sections").press("ArrowDown");
    await item("src/components/ui").press("ArrowUp");
    assert.equal(await item("src/components/sections").evaluate((el) => el === document.activeElement), true);
    await item("src/components/sections").press("Home");
    assert.equal(await tree.getByRole("treeitem").first().evaluate((el) => el === document.activeElement), true);
    await tree.getByRole("treeitem").first().press("End");
    assert.equal(await tree.getByRole("treeitem").last().evaluate((el) => el === document.activeElement), true);
    await click(item("src/components/sections"));
    const toggle = page.getByRole("button", { name: "Toggle files panel" });
    const editor = page.getByRole("textbox", { name: "Selected project file source" });
    const before = await editor.boundingBox();
    await toggle.focus();
    await toggle.press("Enter");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await tree.isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "Add file" }).count(), 0);
    const after = await editor.boundingBox();
    assert.ok(after.width > before.width + 50);
    assert.equal(await page.locator('aside[aria-label="Project files"]').evaluate((el) => el.getBoundingClientRect().width), 40);
    await toggle.press("Space");
    assert.equal(await item("src/app").getAttribute("aria-expanded"), "true");
    assert.equal(await item("src/components/sections").getAttribute("aria-expanded"), "true");
    await click(toggle);
    await page.reload();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await click(toggle);
    assert.equal(await item("src/components/sections").getAttribute("aria-expanded"), "true");
    assert.equal(await item("src/components/sections/HeroSection.tsx").getAttribute("aria-selected"), "true");
    assert.equal(await item("src/app").getAttribute("aria-expanded"), "false");
    await page.reload();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  } finally { await context.close(); }
});

test("Builder preview grows to page content without nested scrolling at each device size", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockApi(page, () => assert.fail("React starter must not request migration"));
    await page.goto(base);
    const iframe = page.locator('iframe[title="Website preview"]');
    await iframe.waitFor();
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.getByRole("heading", { name: /STOR SMAK/ }).waitFor();
    for (const device of ["desktop", "tablet", "mobile", "desktop"]) {
      await click(page.getByRole("button", { name: device, exact: true }));
      try {
        await frame.waitForFunction(() =>
          innerHeight > 1000 && document.documentElement.scrollHeight <= innerHeight + 1,
          undefined,
          { polling: 100 },
        );
      } catch (error) {
        assert.fail(`${device}: ${JSON.stringify(await frame.evaluate(() => ({
          viewport: innerHeight, document: document.documentElement.scrollHeight,
          body: document.body.scrollHeight,
        })))}; ${error.message}`);
      }
      assert.equal(await frame.locator("body").evaluate(() =>
        [...document.querySelectorAll("*")].some((el) =>
          ["scroll", "auto"].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1),
      ), false);
      assert.equal(await frame.locator("html").evaluate((el) => el.scrollWidth <= innerWidth), true);
    }
    await click(page.getByRole("button", { name: "Toggle files panel" }));
    await frame.waitForFunction(() => document.documentElement.scrollHeight <= innerHeight + 1, undefined, { polling: 100 });
    await click(page.getByRole("button", { name: "code", exact: true }));
    await click(page.getByRole("button", { name: "preview", exact: true }));
    await page.frameLocator('iframe[title="Website preview"]').getByRole("heading", { name: /STOR SMAK/ }).waitFor();
  } finally { await context.close(); }
});

test("Builder columns collapse independently, persist and preserve chat drafts and messages", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockApi(page, () => assert.fail("React starter must not request migration"));
    let submitted;
    await page.route("**/api/chat", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"type":"delta","text":"Your project is ready."}\n\ndata: {"type":"done","project":null}\n\n',
      });
    });
    await page.goto(base);
    const sidebar = page.locator("#workspace-sidebar");
    const chat = page.locator("#workspace-chat");
    const project = page.locator(".builder-project");
    const sidebarToggle = sidebar.getByRole("button", { name: "Toggle sidebar" });
    const chatToggle = chat.getByRole("button", { name: "Toggle chat" });
    const input = chat.getByRole("textbox");
    const preview = page.locator('iframe[title="Website preview"]');
    await preview.waitFor();
    const source = await preview.getAttribute("srcdoc");
    const bounds = async () => Promise.all([sidebar, chat, project].map((item) => item.boundingBox()));
    const [initialSidebar, initialChat, initialProject] = await bounds();
    assert.equal(initialSidebar.x, 0);
    assert.equal(initialSidebar.width, 240);
    assert.equal(initialChat.x, 240);
    assert.equal(initialChat.width, 380);
    assert.equal(initialProject.x, 620);
    await input.fill(suggestionsForTest);
    await sidebarToggle.press("Enter");
    const [rail, unchangedChat, widerProject] = await bounds();
    assert.equal(rail.width, 56);
    assert.equal(unchangedChat.width, 380);
    assert.equal(widerProject.width, initialProject.width + 184);
    assert.equal(await sidebar.getByRole("button", { name: "New project" }).count(), 0);
    for (const label of ["Builder", "Projects", "Settings"]) {
      assert.equal(await sidebar.getByTitle(label, { exact: true }).isVisible(), true);
    }
    assert.equal(await sidebar.getByRole("button", { name: "My profile" }).isVisible(), true);
    await chatToggle.press("Enter");
    const [, chatRail, fullProject] = await bounds();
    assert.equal(chatRail.width, 40);
    assert.equal(fullProject.x, 96);
    assert.equal(fullProject.width, 1400 - 96);
    assert.equal(await input.isVisible(), false);
    assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await chatToggle.getAttribute("aria-expanded"), "false");
    await chatToggle.press("Space");
    assert.equal(await input.inputValue(), suggestionsForTest);
    await input.press("Enter");
    await chat.getByText("Your project is ready.", { exact: false }).waitFor();
    assert.equal(submitted.prompt, suggestionsForTest);
    await click(chatToggle);
    await click(chatToggle);
    assert.equal(await chat.getByText(suggestionsForTest, { exact: true }).isVisible(), true);
    await click(chatToggle);
    await page.reload();
    assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await chatToggle.getAttribute("aria-expanded"), "false");
    await click(sidebarToggle);
    await page.reload();
    assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "true");
    assert.equal(await chatToggle.getAttribute("aria-expanded"), "false");
    await click(chatToggle);
    await page.reload();
    assert.equal(await chatToggle.getAttribute("aria-expanded"), "true");
    await preview.waitFor();
    assert.equal(await preview.getAttribute("srcdoc"), source);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await context.close(); }
});

const suggestionsForTest = "A warm, editorial site for a neighborhood bakery";

async function mockChatStream(page) {
  await mockApi(page, () => assert.fail("React starter must not request migration"));
  await page.addInitScript(() => {
    const original = window.fetch;
    window.chatRequests = [];
    window.fetch = async (url, init) => {
      if (url !== "/api/chat") return original(url, init);
      const request = { body: JSON.parse(init.body), aborted: false };
      window.chatRequests.push(request);
      if (window.chatHttpStatus) return new Response("Not Found", { status: window.chatHttpStatus });
      return new Response(new ReadableStream({
        start(controller) {
          request.emit = (event) => {
            const bytes = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
            for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
          };
          request.end = () => controller.close();
          request.fail = () => controller.error(new TypeError("Failed to fetch"));
          init.signal.addEventListener("abort", () => {
            request.aborted = true;
            controller.error(new DOMException("Aborted", "AbortError"));
          });
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => { window.copiedText = text; } } });
  });
}

async function chatEvent(page, event) {
  await page.evaluate((value) => window.chatRequests.at(-1).emit(value), event);
}

test("Chat sends suggestions, streams Markdown, applies files and supports editing, retry and stop", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockChatStream(page);
    await page.goto(base);
    const chat = page.locator("#workspace-chat");
    const input = chat.getByRole("textbox");
    assert.equal(await chat.getByRole("button", { name: "Send message", exact: true }).isDisabled(), true);
    await click(chat.getByRole("button", { name: suggestionsForTest }));
    await chat.getByRole("status", { name: "Atelier is typing" }).waitFor();
    assert.equal(await input.inputValue(), "");
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    assert.equal(await chat.getByRole("heading", { name: "What are we making?" }).count(), 0);
    assert.equal(await page.evaluate(() => window.chatRequests[0].body.prompt), suggestionsForTest);
    assert.ok(await page.evaluate(() => window.chatRequests[0].body.currentFiles["src/main.tsx"]));
    await chatEvent(page, { type: "delta", text: "Café **code**:\n\n```tsx\nconst name = 'Atelier';\n```\n\n" });
    await chat.locator("strong").filter({ hasText: "code" }).waitFor();
    await chat.getByText("Café code:", { exact: true }).waitFor();
    await click(chat.getByRole("button", { name: "Copy code", exact: true }));
    assert.equal(await page.evaluate(() => window.copiedText), "const name = 'Atelier';");
    await chatEvent(page, { type: "delta", text: "Updating your heading." });
    const updated = { ...files, "src/pages/Index.tsx": files["src/pages/Index.tsx"] + "\n// Chat edit\n" };
    const previewRefresh = page.waitForRequest("**/api/preview");
    await chatEvent(page, { type: "done", project: { files: updated, entrypoint: "index.html" } });
    await previewRefresh;
    await chat.getByText("Changes applied", { exact: true }).waitFor();
    await click(chat.getByRole("button", { name: "Open src/pages/Index.tsx in Code view", exact: true }));
    assert.match(await page.getByRole("textbox", { name: "Selected project file source" }).inputValue(), /Chat edit/);
    assert.equal(await chat.locator("time").count(), 2);
    await input.fill("A follow-up");
    await input.press("Shift+Enter");
    await input.press("End");
    await input.type("with a second line");
    assert.match(await input.inputValue(), /\n/);
    await input.press("Enter");
    await page.waitForFunction(() => window.chatRequests.length === 2);
    assert.equal(await page.evaluate(() => window.chatRequests[1].body.conversation.length), 2);
    await chatEvent(page, { type: "error", error: "Network unavailable" });
    await chat.getByRole("alert").filter({ hasText: "Network unavailable" }).waitFor();
    await click(chat.getByRole("button", { name: "Retry response" }));
    await page.waitForFunction(() => window.chatRequests.length === 3);
    await chatEvent(page, { type: "delta", text: "Retry succeeded" });
    await chatEvent(page, { type: "done", project: null });
    await chat.getByRole("button", { name: "Send message", exact: true }).waitFor();
    await click(chat.getByRole("button", { name: "Edit and resend message" }));
    await input.fill("Edited follow-up");
    await input.press("Enter");
    await page.waitForFunction(() => window.chatRequests.length === 4);
    await chat.getByText("Edited follow-up", { exact: true }).waitFor();
    assert.equal(await chat.getByText("Retry succeeded", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.chatRequests[3].body.conversation.length), 2);
    await click(chat.getByRole("button", { name: "Stop response" }));
    await chat.getByText("Response stopped.", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.chatRequests[3].aborted), true);
    await click(chat.getByRole("button", { name: "Regenerate reply" }).last());
    await page.waitForFunction(() => window.chatRequests.length === 5);
    await page.evaluate(() => window.chatRequests.at(-1).end());
    await chat.getByRole("alert").filter({ hasText: "connection ended" }).waitFor();
    page.once("dialog", (dialog) => dialog.dismiss());
    await click(chat.getByRole("button", { name: "New chat", exact: true }));
    assert.equal(await chat.getByRole("article", { name: "Your message" }).count(), 2);
    page.once("dialog", (dialog) => dialog.accept());
    await click(chat.getByRole("button", { name: "New chat", exact: true }));
    await chat.getByRole("heading", { name: "What are we making?" }).waitFor();
  } finally { await context.close(); }
});

test("Chat keeps 100 messages per project, preserves manual scrolling and restores history", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockChatStream(page);
    await page.addInitScript(() => {
      if (localStorage.getItem("chat-seeded")) return;
      localStorage.setItem("chat-seeded", "true");
      localStorage.setItem("atelier-chat-v1:local:current", JSON.stringify(Array.from({ length: 104 }, (_, i) => ({
        id: String(i), role: i % 2 ? "assistant" : "user", content: `History ${i}\n\n${"A long response. ".repeat(20)}`,
        createdAt: new Date().toISOString(), status: "complete",
      }))));
    });
    await page.goto(base);
    const chat = page.locator("#workspace-chat");
    const log = chat.getByRole("log");
    const input = chat.getByRole("textbox");
    assert.equal(await log.getByRole("article").count(), 100);
    assert.equal(await log.getAttribute("aria-live"), "polite");
    await input.fill("Continue");
    await input.press("Enter");
    await page.waitForFunction(() => window.chatRequests.length === 1);
    assert.equal(await page.evaluate(() => window.chatRequests[0].body.conversation.length), 20);
    await chatEvent(page, { type: "delta", text: "Start\n\n" + "Streaming text.\n\n".repeat(20) });
    assert.equal(await log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 8), true);
    await log.evaluate((el) => { el.scrollTop = 100; el.dispatchEvent(new Event("scroll")); });
    await chat.getByRole("button", { name: "Jump to latest message" }).waitFor();
    await chatEvent(page, { type: "delta", text: "More text\n\n".repeat(20) });
    assert.equal(await log.evaluate((el) => el.scrollTop), 100);
    await click(chat.getByRole("button", { name: "Jump to latest message" }));
    assert.equal(await log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 8), true);
    await chatEvent(page, { type: "done", project: null });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("atelier-chat-v1:local:current")).at(-1).status === "complete");
    await page.reload();
    assert.equal(await log.getByRole("article").count(), 100);
    await chat.getByText("Continue", { exact: true }).waitFor();
    await click(page.getByRole("button", { name: "New project" }));
    await chat.getByRole("heading", { name: "What are we making?" }).waitFor();
    await input.fill("Separate project");
    await input.press("Enter");
    await page.waitForFunction(() => window.chatRequests.length === 1);
    await click(page.getByRole("button", { name: "Projects", exact: true }));
    await click(page.getByRole("button", { name: /Kebabhouse Karlskrona.*files/ }));
    await chat.getByText("Continue", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.chatRequests[0].aborted), true);
    assert.equal(await chat.getByText("Separate project", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("atelier-chat-v1:local:"))
      .some(([, value]) => JSON.parse(value).some((message) => message.content === "Separate project"))), true);
    await input.fill("line\n".repeat(20));
    assert.equal(await input.evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight <= 160), true);
  } finally { await context.close(); }
});

test("Chat never overwrites edits made during generation and reports network failures", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockChatStream(page);
    await page.goto(base);
    const chat = page.locator("#workspace-chat");
    const input = chat.getByRole("textbox");
    await input.fill("Update this site");
    await input.press("Enter");
    await chat.getByRole("button", { name: "Stop response" }).waitFor();
    await click(page.getByRole("button", { name: "code", exact: true }));
    const source = page.getByRole("textbox", { name: "Selected project file source" });
    const edited = await source.inputValue() + "\n<!-- My edit -->";
    await source.fill(edited);
    await chatEvent(page, { type: "done", project: { files, entrypoint: "index.html" } });
    await chat.getByRole("alert").filter({ hasText: "Project files changed while generating" }).waitFor();
    assert.equal(await source.inputValue(), edited);
    assert.equal(await chat.getByText("Changes applied", { exact: true }).count(), 0);
    await click(chat.getByRole("button", { name: "Retry response" }));
    await page.waitForFunction(() => window.chatRequests.length === 2);
    assert.equal(await page.evaluate(() => window.chatRequests[1].body.currentFiles["index.html"]), edited);
    await page.evaluate(() => window.chatRequests.at(-1).fail());
    await chat.getByRole("alert").filter({ hasText: "Failed to fetch" }).waitFor();
  } finally { await context.close(); }
});

test("Chat route failures show diagnostics and retry the same message without duplicates", async () => {
  const { context, page } = await isolatedPage();
  try {
    await mockChatStream(page);
    await page.goto(base);
    await page.evaluate(() => { window.chatHttpStatus = 404; });
    const chat = page.locator("#workspace-chat");
    await chat.getByRole("textbox").fill("Try this request");
    await chat.getByRole("textbox").press("Enter");
    await chat.getByRole("alert").filter({ hasText: "The chat route /api/chat was not found" }).waitFor();
    await page.evaluate(() => { window.chatHttpStatus = 0; });
    await click(chat.getByRole("button", { name: "Retry response" }));
    await page.waitForFunction(() => window.chatRequests.length === 2);
    assert.equal(await page.evaluate(() => window.chatRequests[0].body.prompt === window.chatRequests[1].body.prompt), true);
    assert.equal(await chat.getByRole("article", { name: "Your message" }).count(), 1);
    await chatEvent(page, { type: "delta", text: "Recovered" });
    await chatEvent(page, { type: "done", project: null });
    await chat.getByText("Recovered", { exact: true }).waitFor();
  } finally { await context.close(); }
});
test("Tablet and mobile use focus-trapped overlay drawers without squeezing the project", async () => {
  const { context, page } = await isolatedPage();
  try {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(page, () => assert.fail("React starter must not request migration"));
    await page.goto(base);
    await page.locator("#workspace-chat").getByRole("textbox").fill("Keep this draft across breakpoints");
    const project = page.locator(".builder-project");
    const triggers = page.locator(".builder-drawer-triggers");
    for (const width of [1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      // This CI browser defers native resize events because compositor frames are unavailable.
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await triggers.waitFor();
      await page.locator('#workspace-sidebar[role="dialog"]:not([open])').waitFor({ state: "attached" });
      const initial = await project.boundingBox();
      assert.equal(initial.x, 0);
      assert.equal(initial.width, width);
      for (const [name, id, title] of [
        ["sidebar", "workspace-sidebar", "Workspace navigation"],
        ["chat", "workspace-chat", "Build with Atelier"],
      ]) {
        const trigger = triggers.getByRole("button", { name: `Toggle ${name}` });
        await click(trigger);
        const drawer = page.getByRole("dialog", { name: title, exact: true });
        await page.locator(`#${id}:modal`).waitFor();
        assert.equal(await drawer.evaluate((el) => el.matches(":modal")), true);
        assert.equal(await drawer.getByRole("button", { name: `Toggle ${name}` }).getAttribute("aria-expanded"), "true");
        const opened = await project.boundingBox();
        assert.equal(opened.width, initial.width);
        assert.equal(opened.x, 0);
        assert.equal(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
        if (name === "chat") {
          assert.equal(await drawer.getByRole("textbox").inputValue(), "Keep this draft across breakpoints");
          const inputBounds = await drawer.getByRole("textbox").boundingBox();
          assert.ok(inputBounds.y >= 0 && inputBounds.y + inputBounds.height <= 844);
        }
        if (width === 390) {
          for (let index = 0; index < 12; index += 1) {
            await page.keyboard.press("Tab");
            assert.equal(await page.evaluate((expected) =>
              document.activeElement === document.body || document.activeElement.closest("dialog")?.id === expected, id), true);
          }
        }
        await page.keyboard.press("Escape");
        assert.equal(await drawer.isVisible(), false);
        assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await click(triggers.getByRole("button", { name: "Toggle chat" }));
      await page.mouse.click(width - 8, 200);
      assert.equal(await page.getByRole("dialog", { name: "Build with Atelier" }).isVisible(), false);
      for (const device of ["desktop", "tablet", "mobile"]) {
        await click(page.getByRole("button", { name: device, exact: true }));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    await click(triggers.getByRole("button", { name: "Toggle chat" }));
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.locator("#workspace-sidebar[open]").waitFor();
    assert.equal(await page.locator("dialog:modal").count(), 0);
    assert.equal(await page.locator("#workspace-chat").getByRole("textbox").inputValue(), "Keep this draft across breakpoints");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await triggers.waitFor();
    assert.equal(await page.locator("#workspace-sidebar").isVisible(), false);
    assert.equal(await page.locator("#workspace-chat").isVisible(), false);
    assert.equal((await project.boundingBox()).width, 390);
    await click(triggers.getByRole("button", { name: "Toggle sidebar" }));
    await page.locator("#workspace-sidebar:modal").waitFor();
    await click(page.locator("#workspace-sidebar").getByRole("button", { name: "Toggle sidebar" }));
    assert.equal(await page.locator("#workspace-sidebar").isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

const legacy = { name: "Legacy cabin", html: "<!doctype html><html><body><h1>Original cabin</h1></body></html>", generated: true, history: [], historyIndex: -1 };

test("opening a legacy project migrates once into a separate persisted copy", async () => {
  const { context, page } = await isolatedPage();
  try {
    await context.addInitScript((value) => {
      if (!localStorage.getItem("atelier-studio-project-v1")) localStorage.setItem("atelier-studio-project-v1", JSON.stringify(value));
    }, legacy);
    let count = 0;
    await mockApi(page, async (route) => {
      count += 1;
      assert.equal(route.request().postDataJSON().currentFiles["index.html"], legacy.html);
      await route.fulfill({ json: { files, entrypoint: "index.html" } });
    });
    await page.goto(base);
    await page.getByTitle("Rename project").filter({ hasText: "(React)" }).waitFor();
    const saved = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith("atelier-studio-project-v1:local:"))
      .map(([, value]) => JSON.parse(value)));
    assert.equal(saved.find((item) => item.projectId === "current").files["index.html"], legacy.html);
    assert.ok(saved.find((item) => item.settings.migrationSourceId === "current" && item.files["src/main.tsx"]));
    await page.reload();
    await page.getByTitle("Rename project").filter({ hasText: "(React)" }).waitFor();
    assert.equal(count, 1);
  } finally { await context.close(); }
});

test("failed migration leaves the original usable and provides a retry", async () => {
  const { context, page } = await isolatedPage();
  try {
    await context.addInitScript((value) => localStorage.setItem("atelier-studio-project-v1", JSON.stringify(value)), legacy);
    let count = 0;
    await mockApi(page, async (route) => {
      count += 1;
      if (count === 1) await route.fulfill({ status: 502, json: { error: "Model unavailable" } });
      else await route.fulfill({ json: { files, entrypoint: "index.html" } });
    });
    await page.goto(base);
    await page.getByRole("button", { name: "Retry React migration" }).waitFor();
    await page.frameLocator('iframe[title="Website preview"]').getByRole("heading", { name: "Original cabin" }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("atelier-studio-project-v1")).html), legacy.html);
    await click(page.getByRole("button", { name: "Retry React migration" }));
    await page.getByTitle("Rename project").filter({ hasText: "(React)" }).waitFor();
    assert.equal(count, 2);
  } finally { await context.close(); }
});

test("switching projects during migration cannot overwrite the selected project", async () => {
  const { context, page } = await isolatedPage();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  try {
    await context.addInitScript((value) => localStorage.setItem("atelier-studio-project-v1", JSON.stringify(value)), legacy);
    await mockApi(page, async (route) => {
      await pending;
      await route.fulfill({ json: { files, entrypoint: "index.html" } });
    });
    await page.goto(base);
    await page.getByText("Creating a React copy of this website.", { exact: false }).waitFor();
    await click(page.getByRole("button", { name: "New project" }));
    await page.getByTitle("Rename project").filter({ hasText: "Untitled project" }).waitFor();
    release();
    await page.frameLocator('iframe[title="Website preview"]').getByRole("heading", { name: /STOR SMAK/ }).waitFor();
    const saved = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith("atelier-studio-project-v1:local:"))
      .map(([, value]) => JSON.parse(value)));
    assert.equal(saved.find((item) => item.projectId === "current").files["index.html"], legacy.html);
    assert.ok(saved.some((item) => item.name === "Untitled project" && item.files["src/main.tsx"]));
    assert.equal(saved.some((item) => item.settings.migrationSourceId), false);
  } finally {
    release();
    await context.close();
  }
});
