import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { pageImagePlugin } from './page-image-plugin.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(projectRoot, 'extension');
const outputDirectory = resolve(projectRoot, 'dist');
const imagesPlugin = pageImagePlugin(projectRoot, sourceDirectory);

if (dirname(outputDirectory) !== projectRoot || outputDirectory === projectRoot) {
  throw new Error('Output directory must be dist inside the project.');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const asset of ['manifest.json', '_locales', 'icons']) {
  await cp(resolve(sourceDirectory, asset), resolve(outputDirectory, asset), { recursive: true });
}

for (const asset of ['popup/popup.css', 'options/options.css', 'shared/styles.css']) {
  await cp(resolve(sourceDirectory, asset), resolve(outputDirectory, asset.split('/').at(-1)!));
}

for (const name of ['popup', 'options']) {
  const html = await readFile(resolve(sourceDirectory, name, name + '.html'), 'utf8');
  await writeFile(
    resolve(outputDirectory, name + '.html'),
    html.replaceAll('../shared/styles.css', 'styles.css').replaceAll('../icons/', 'icons/')
  );
}

await build({
  absWorkingDir: projectRoot,
  tsconfigRaw: {},
  entryPoints: [resolve(sourceDirectory, 'content/page-analysis.ts')],
  outfile: resolve(outputDirectory, 'page-analysis.js'),
  bundle: true,
  format: 'iife',
  globalName: 'html2mdAnalysis',
  footer: { js: 'html2mdAnalysis.analyzePage(document);' },
});

for (const [name, globalName, start] of [
  ['popup', 'html2md', 'startPopup'],
  ['options', 'html2mdOptions', 'startOptions'],
]) {
  await build({
    absWorkingDir: projectRoot,
    tsconfigRaw: {},
    entryPoints: [resolve(sourceDirectory, name, 'main.ts')],
    plugins: [imagesPlugin],
    outfile: resolve(outputDirectory, name + '.js'),
    bundle: true,
    format: 'iife',
    globalName,
    footer: { js: globalName + '.' + start + '();' },
  });
}

console.log('Extension built in dist/');
