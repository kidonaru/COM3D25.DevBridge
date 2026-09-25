// MCP サーバーを依存込みの単一 ESM にまとめる。プラグインはインストール時にビルドも
// npm install も走らないため、この生成物をコミットして配布する。
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './plugin-common.mjs';

export const bundleOutfile = resolve(repoRoot, 'agent-plugin/dist/server.mjs');

export async function bundle(outfile = bundleOutfile) {
  await build({
    entryPoints: [resolve(repoRoot, 'src/index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    // 依存の CJS モジュールが require する node 組み込みを ESM バンドル内で解決させる
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    legalComments: 'none',
    logLevel: 'warning',
  });
}

// node -e / REPL から import したときは argv[1] が無い
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await bundle();
  console.log(`バンドル生成: ${bundleOutfile}`);
}
