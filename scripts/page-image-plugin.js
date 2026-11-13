import { build } from 'esbuild';
import { resolve } from 'node:path';

// Compile dependencies into the function body at build time, without runtime eval.
export function pageImagePlugin(projectRoot, sourceDirectory) {
  let compiled;
  return {
    name: 'self-contained-page-images',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]browser[\\/]image-function\.js$/ }, async () => {
        compiled ??= build({
          absWorkingDir: projectRoot,
          tsconfigRaw: {},
          entryPoints: [resolve(sourceDirectory, 'browser/image-function.js')],
          bundle: true,
          write: false,
          format: 'iife',
          globalName: 'html2mdPageImages',
        });
        const result = await compiled;
        return {
          loader: 'js',
          contents: `export function fetchImagesInPage(urls, maxTotalBytes) {
${result.outputFiles[0].text}
return html2mdPageImages.fetchImagesInPage(urls, maxTotalBytes);
}`,
        };
      });
    },
  };
}
