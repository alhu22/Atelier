import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const virtualRoot = "/__atelier_project__";
const supportedPackages = new Set([
  "react", "react-dom", "react-router", "react-router-dom", "firebase",
]);

export function checkProjectTypes(files) {
  const config = ts.parseConfigFileTextToJson("tsconfig.json", files["tsconfig.json"]);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions ?? {}, virtualRoot);
  if (converted.errors.length) throw new Error("Invalid TypeScript compiler options.");
  const options = { ...converted.options, strict: true, noEmit: true, incremental: false, composite: false };
  const host = ts.createCompilerHost(options);
  const dependencyPath = (name) => (name === `${virtualRoot}/node_modules` || name.startsWith(`${virtualRoot}/node_modules/`))
    ? path.join(root, name.slice(virtualRoot.length + 1))
    : name;
  const allowedDependency = (name) => path.resolve(name) === path.join(root, "node_modules")
    || path.resolve(name).startsWith(path.join(root, "node_modules") + path.sep);
  host.readFile = (name) => {
    const relative = name.slice(virtualRoot.length + 1);
    if (name.startsWith(`${virtualRoot}/`) && Object.hasOwn(files, relative)) return files[relative];
    const dependency = dependencyPath(name);
    return allowedDependency(dependency) ? ts.sys.readFile(dependency) : undefined;
  };
  host.fileExists = (name) => host.readFile(name) !== undefined;
  host.directoryExists = (name) => {
    if (name === virtualRoot) return true;
    if (name.startsWith(`${virtualRoot}/`) &&
        Object.keys(files).some((file) => `${virtualRoot}/${file}`.startsWith(name + "/"))) return true;
    const dependency = dependencyPath(name);
    return allowedDependency(dependency + "/") && ts.sys.directoryExists(dependency);
  };
  host.realpath = (name) => dependencyPath(name);
  host.getCurrentDirectory = () => virtualRoot;
  host.getSourceFile = (name, languageVersion) => {
    const content = host.readFile(name);
    return content === undefined ? undefined : ts.createSourceFile(name, content, languageVersion);
  };
  const names = Object.keys(files).filter((name) =>
    (options.allowJs ? /\.(tsx?|jsx?)$/ : /\.tsx?$/).test(name) && !name.startsWith("public/"));
  const program = ts.createProgram(names.map((name) => `${virtualRoot}/${name}`), options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter((item) => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new Error(errors.slice(0, 12).map((item) => {
      const location = item.file && item.start !== undefined
        ? `${item.file.fileName.replace(virtualRoot + "/", "")}:${item.file.getLineAndCharacterOfPosition(item.start).line + 1}: `
        : "";
      return location + ts.flattenDiagnosticMessageText(item.messageText, "\n");
    }).join("\n"));
  }
}

export async function compileProject(files, checkTypes = false) {
  if (checkTypes) checkProjectTypes(files);
  const manifest = JSON.parse(files["package.json"]);
  const theme = JSON.parse(files["src/styles/theme.json"] ?? "{}");
  const content = Object.entries(files)
    .filter(([name]) => /\.(html|tsx?|jsx?)$/.test(name))
    .map(([name, raw]) => ({ raw, extension: path.extname(name).slice(1) }));
  const cssProcessor = postcss([
    tailwindcss({ content, theme: { extend: theme }, plugins: [] }),
    autoprefixer(),
  ]);
  const resolveLocal = (specifier, importer = "") => {
    const clean = specifier.split(/[?#]/)[0];
    const relative = clean.startsWith("@/") ? "src/" + clean.slice(2)
      : clean.startsWith("/") ? clean.slice(1)
      : path.posix.join(path.posix.dirname(importer), clean);
    const normalized = path.posix.normalize(relative);
    if (normalized.startsWith("../")) throw new Error("Imports must stay inside the project.");
    const candidates = [normalized, ...[".tsx", ".ts", ".jsx", ".js", ".json", "/index.tsx", "/index.ts", "/index.js"].map((ext) => normalized + ext), "public/" + normalized];
    const found = candidates.find((name) => Object.hasOwn(files, name));
    if (!found) throw new Error(`Cannot resolve ${specifier} from ${importer || "index.html"}.`);
    return found;
  };
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/main.tsx"],
    outdir: "/__atelier_output__",
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    logLevel: "silent",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env": JSON.stringify({ MODE: "preview", BASE_URL: "/", DEV: false, PROD: true }),
    },
    plugins: [{
      name: "project-files",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          args.kind === "entry-point" ? { path: "src/main.tsx", namespace: "project" } : undefined);
        builder.onResolve({ filter: /.*/, namespace: "project" }, async (args) => {
          if (/^(?:https?:|data:)/.test(args.path)) {
            if (args.kind === "url-token") return { path: args.path, external: true };
            throw new Error("Remote code imports are not supported in local preview.");
          }
          if (/^(?:\.|\/|@\/)/.test(args.path)) {
            return { path: resolveLocal(args.path, args.importer), namespace: "project" };
          }
          const packageName = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0];
          if (!supportedPackages.has(packageName) || !manifest.dependencies?.[packageName]) {
            throw new Error(`Preview dependency '${packageName}' is not available. No packages are installed from generated projects.`);
          }
          if (args.path === "react-router-dom") return { path: args.path, namespace: "preview-router" };
          return builder.resolve(args.path, { resolveDir: root, kind: args.kind });
        });
        builder.onLoad({ filter: /.*/, namespace: "preview-router" }, () => ({
          contents: readFileSync(new URL("./preview-router.jsx", import.meta.url), "utf8"),
          loader: "jsx",
          resolveDir: root,
        }));
        builder.onLoad({ filter: /.*/, namespace: "project" }, async ({ path: name }) => {
          let source = files[name];
          const extension = path.posix.extname(name).slice(1);
          if (extension === "css") {
            // Tailwind's @config can load JS from disk; project configuration is never executed.
            if (/@(?:config|plugin)\b/i.test(source)) throw new Error("Preview CSS cannot load executable configuration.");
            source = (await cssProcessor.process(source, { from: undefined })).css;
          }
          const loader = ["mjs", "cjs"].includes(extension) ? "js"
            : ["ts", "tsx", "js", "jsx", "css", "json"].includes(extension) ? extension : "dataurl";
          return { contents: source, loader };
        });
      },
    }],
  });
  let javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  if (!javascript) throw new Error("Project compilation produced no JavaScript.");
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  let html = files["index.html"];
  for (const [name, source] of Object.entries(files)) {
    if (!name.startsWith("public/")) continue;
    const url = "/" + name.slice("public/".length);
    const mime = name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".json") ? "application/json" : "text/plain";
    const dataUrl = `data:${mime};base64,${Buffer.from(source).toString("base64")}`;
    javascript = javascript.replaceAll(JSON.stringify(url), JSON.stringify(dataUrl));
    html = html.replaceAll(`"${url}"`, `"${dataUrl}"`).replaceAll(`'${url}'`, `'${dataUrl}'`);
  }
  // Preserve document metadata and external styles/fonts, replacing only the Vite entry script.
  html = html.replace(/<script\b(?=[^>]*\bsrc=["']\/?src\/main\.tsx["'])[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/<\/head\s*>/i, () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style></head>`);
  const anchors = 'document.addEventListener("click",e=>{if(e.defaultPrevented)return;const a=e.target instanceof Element?e.target.closest("a[href]"):null;const h=a?.getAttribute("href");if(h?.startsWith("#")){e.preventDefault();document.getElementById(decodeURIComponent(h.slice(1)))?.scrollIntoView()}});';
  return html.replace(/<\/body\s*>/i, () => `<script>${javascript.replace(/<\/script/gi, "<\\/script")}\n${anchors}</script></body>`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const html = await compileProject(input.files, input.checkTypes === true);
    process.stdout.write(JSON.stringify({ html }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : "Project compilation failed." }));
    process.exitCode = 1;
  }
}
