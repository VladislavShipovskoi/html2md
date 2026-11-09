import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(projectRoot, "extension");
const outputDirectory = resolve(projectRoot, "dist");

if (
  dirname(outputDirectory) !== projectRoot ||
  outputDirectory === projectRoot
) {
  throw new Error("Output directory must be dist inside the project.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });
await rm(resolve(outputDirectory, "page-analysis.mjs"));
await build({
  absWorkingDir: projectRoot,
  tsconfigRaw: {},
  entryPoints: [resolve(sourceDirectory, "page-analysis.mjs")],
  outfile: resolve(outputDirectory, "page-analysis.js"),
  bundle: true,
  format: "iife",
  globalName: "html2mdAnalysis",
  footer: { js: "html2mdAnalysis.analyzePage(document);" },
});

console.log("Extension built in dist/");
