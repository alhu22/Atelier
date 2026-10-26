import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/integrations/firebase/projects.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [{
    name: "firebase-test-adapters",
    setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$|^\.\/auth$/ }, ({ path }) => ({
        path, namespace: "fixture",
      }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "./auth" ? "export async function writeActivity() {}" : `
          export const doc = (_database, ...segments) => ({ path: segments.join("/") });
          export const collection = doc, query = value => value, limit = () => {};
          export const serverTimestamp = () => "server-timestamp";
          export const deleteDoc = async () => {};
          export const getDocs = async () => ({ docs: [{
            id: "current", data: () => state.document,
          }] });
          export const setDoc = async (ref, data, options) => {
            state.ref = ref.path;
            state.document = options?.merge ? { ...state.document, ...data } : data;
          };
          export const runTransaction = async (_database, update) => update({
            get: async () => {
              if (state.error) throw state.error;
              return { data: () => state.document };
            },
            set: setDoc,
          });
        `,
      }));
    },
  }],
});

function adapter(document, error) {
  const state = { document, error };
  const context = { module: { exports: {} }, state };
  vm.runInNewContext(outputFiles[0].text, context);
  return { ...context.module.exports, state };
}

const user = { uid: "owner" };
const project = {
  id: "current",
  name: "Test project",
  files: { "index.html": "<html>Updated</html>" },
  entrypoint: "index.html",
  settings: {},
  generated: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

test("saving a loaded cloud project preserves the exact creation timestamp", async () => {
  const timestamp = {
    seconds: 1767225600,
    nanoseconds: 123456000,
    toDate: () => new Date("2026-01-01T00:00:00.123Z"),
  };
  const { listProjects, saveProject, state } = adapter({ ...project, createdAt: timestamp });
  const [loaded] = await listProjects({}, user);
  assert.notEqual(loaded.createdAt, timestamp);
  await saveProject({}, user, loaded);
  assert.equal(state.document.createdAt, timestamp);
  assert.equal(state.ref, "users/owner/projects/current");
});

test("saving legacy HTML projects replaces obsolete fields with the current schema", async () => {
  const { listProjects, saveProject, state } = adapter({
    name: "Legacy", html: "<html>Original</html>", createdAt: project.createdAt,
  });
  const [loaded] = await listProjects({}, user);
  await saveProject({}, user, { ...loaded, files: project.files });
  assert.equal(Object.hasOwn(state.document, "html"), false);
  assert.equal(state.document.files["index.html"], "<html>Updated</html>");
  assert.equal(state.document.owner, user.uid);
  assert.equal(state.document.createdAt, project.createdAt);
});

test("new projects retain their local creation date and save all files", async () => {
  const { saveProject, state } = adapter();
  const files = {
    ...project.files,
    ...Object.fromEntries(Array.from({ length: 99 }, (_, index) => [`src/file${index}.ts`, ""])),
  };
  await saveProject({}, user, { ...project, files });
  assert.equal(state.document.createdAt, project.createdAt);
  assert.equal(Object.keys(state.document.files).length, 100);
  assert.equal(state.document.updatedAt, "server-timestamp");
});

test("failed cloud reads reject without replacing the saved project", async () => {
  const error = new Error("Missing or insufficient permissions.");
  const { saveProject, state } = adapter(project, error);
  await assert.rejects(saveProject({}, user, project), (reason) =>
    reason.cause === error && /save project.*users\/owner\/projects\/current/.test(reason.message));
  assert.equal(state.document, project);
});

test("signed-out project operations do not contact Firestore", async () => {
  const { listProjects, saveProject, removeProject, state } = adapter(project, new Error("Must not contact Firestore"));
  assert.equal((await listProjects({}, null)).length, 0);
  await saveProject({}, null, project);
  await removeProject({}, null, project.id);
  assert.equal(state.ref, undefined);
  assert.equal(state.document, project);
});

test("Firestore rules allow owner saves up to 100 files without allowing cross-account writes", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const projectId = "demo-atelier-rules";
  const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/users/owner/projects/current`;
  const timestamp = { timestampValue: "2026-01-01T00:00:00.123456Z" };
  const fields = {
    name: { stringValue: "Test project" },
    owner: { stringValue: "owner" },
    settings: { mapValue: { fields: {} } },
    files: { mapValue: { fields: Object.fromEntries([
      ["index.html", { stringValue: "<html>Test</html>" }],
      ...Array.from({ length: 99 }, (_, index) => [`src/file${index}.ts`, { stringValue: "" }]),
    ]) } },
    entrypoint: { stringValue: "index.html" },
    generated: { booleanValue: true },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  function token(uid, admin = false) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode({ alg: "none", typ: "JWT" })}.${encode({
      aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
      sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now,
      firebase: { sign_in_provider: "custom", identities: {} }, admin,
    })}.`;
  }
  async function request(method, credential, data = fields) {
    return fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      ...(method === "PATCH" ? { body: JSON.stringify({ fields: data }) } : {}),
    });
  }
  async function expectStatus(response, status) {
    assert.equal(response.status, status, await response.text());
  }

  const owner = token("owner");
  await expectStatus(await request("PATCH", owner), 200);
  await expectStatus(await request("PATCH", owner, {
    ...fields, name: { stringValue: "Updated project" },
  }), 200);
  await expectStatus(await request("PATCH", owner, {
    ...fields,
    files: { mapValue: { fields: {
      ...fields.files.mapValue.fields, "extra.ts": { stringValue: "" },
    } } },
  }), 403);
  await expectStatus(await request("PATCH", owner, {
    ...fields, createdAt: { timestampValue: project.createdAt.toISOString() },
  }), 403);
  await expectStatus(await request("PATCH", token("other")), 403);
  await expectStatus(await request("PATCH", token("admin", true)), 403);
  await expectStatus(await request("PATCH", null), 403);
  await expectStatus(await request("GET", token("other")), 403);
  await expectStatus(await request("GET", token("admin", true)), 200);
  await expectStatus(await request("DELETE", owner), 200);
});
