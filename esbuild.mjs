// Bundles the extension and the language server into dist/ for packaging.
//
//   node esbuild.mjs               development build with source maps
//   node esbuild.mjs --production  minified, no source maps (used by vscode:prepublish)
//   node esbuild.mjs --watch       rebuild on change
//
// Type checking stays with tsc (npm run compile / lint:types); esbuild only transpiles.
import * as esbuild from "esbuild";
import { cp, rm } from "node:fs/promises";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const schemasDir = "src/language-service/src/schemas";

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: {
    extension: "src/extension.ts",
    server: "src/server/server.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "cjs",
  // VS Code 1.101 (the engines.vscode minimum) runs extensions on Node 22
  target: "node22",
  // Prefer the ES module builds so unused code can be dropped
  mainFields: ["module", "main"],
  external: [
    // Provided by VS Code at runtime
    "vscode",
    // Optional native speed-ups that ws loads inside try/catch
    "bufferutil",
    "utf-8-validate",
  ],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "info",
};

// Data files the bundles load at runtime:
// - schemaService reads mappings.json and json/*.json from its own directory
//   (__dirname), which in the bundle is dist/.
// - package.json contributes the snippets from dist/snippets.
async function copyAssets() {
  await cp(`${schemasDir}/json`, "dist/json", { recursive: true });
  await cp(`${schemasDir}/mappings.json`, "dist/mappings.json");
  await cp("src/snippets", "dist/snippets", { recursive: true });
}

await rm("dist", { recursive: true, force: true });
await copyAssets();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
