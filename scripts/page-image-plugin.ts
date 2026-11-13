import type { Plugin, BuildResult } from 'esbuild';
import { build } from 'esbuild';
import { resolve } from 'node:path';

export function pageImagePlugin(projectRoot: string, sourceDirectory: string): Plugin {
  let compiled: Promise<BuildResult> | undefined;
  return {
    name: 'self-contained-page-images',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]browser[\\/]image-function\.ts$/ }, async () => {
        compiled ??= build({
          absWorkingDir: projectRoot,
          tsconfigRaw: {},
          entryPoints: [resolve(sourceDirectory, 'browser/image-function.ts')],
          bundle: true,
          write: false,
          format: 'iife',
          globalName: 'html2mdPageImages',
        });
        const result = await compiled;
        return {
          loader: 'js',
          contents: `export function fetchImagesInPage(urls, maxTotalBytes) {
            ${result.outputFiles![0].text}
            return html2mdPageImages.fetchImagesInPage(urls, maxTotalBytes);
          }`,
        };
      });
    },
  };
}
