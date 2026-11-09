import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(projectRoot, 'extension');
const outputDirectory = resolve(projectRoot, 'dist');

if (dirname(outputDirectory) !== projectRoot || outputDirectory === projectRoot) {
  throw new Error('Output directory must be dist inside the project.');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });
await rm(resolve(outputDirectory, 'page-analysis.js'));
await rm(resolve(outputDirectory, 'markdown.js'));
await rm(resolve(outputDirectory, 'image-archive.js'));
await rm(resolve(outputDirectory, 'code-blocks.js'));
await build({
  absWorkingDir: projectRoot,
  tsconfigRaw: {},
  entryPoints: [resolve(sourceDirectory, 'page-analysis.js')],
  outfile: resolve(outputDirectory, 'page-analysis.js'),
  bundle: true,
  format: 'iife',
  globalName: 'html2mdAnalysis',
  footer: { js: 'html2mdAnalysis.analyzePage(document);' },
});
await build({
  absWorkingDir: projectRoot,
  tsconfigRaw: {},
  entryPoints: [resolve(sourceDirectory, 'popup.js')],
  outfile: resolve(outputDirectory, 'popup.js'),
  bundle: true,
  format: 'iife',
  globalName: 'html2md',
  footer: { js: 'html2md.initializePopup();' },
});

console.log('Extension built in dist/');
