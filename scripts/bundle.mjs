// MCP サーバーを依存込みの単一 ESM にまとめる。プラグインはインストール時にビルドも
// npm install も走らないため、この生成物をコミットして配布する。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './plugin-common.mjs';

export const bundleOutfile = resolve(repoRoot, 'agent-plugin/dist/server.mjs');
export const bundleNoticesFile = noticesFileFor(bundleOutfile);

function noticesFileFor(outfile) {
  return join(dirname(outfile), 'THIRD-PARTY-NOTICES.txt');
}

export async function bundle(outfile = bundleOutfile) {
  const { metafile } = await build({
    entryPoints: [resolve(repoRoot, 'src/index.ts')],
    outfile,
    // metafile の入力パスをリポジトリ基準にして node_modules を引けるようにする
    absWorkingDir: repoRoot,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    // 依存の CJS モジュールが require する node 組み込みを ESM バンドル内で解決させる
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
  });
  // ソース中の legal comment だけでは再配布の表示要件を満たせないため、LICENSE ファイルの本文を隣に書き出す
  writeFileSync(noticesFileFor(outfile), renderNotices(bundledPackages(metafile)));
}

/** バンドルに実際に取り込まれた npm パッケージのディレクトリ（node_modules 配下の相対パス）を返す。 */
function bundledPackages(metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (m) dirs.add(m[1]);
  }
  return [...dirs].sort();
}

function renderNotices(packageDirs) {
  const sections = packageDirs.map((dir) => {
    const abs = resolve(repoRoot, dir);
    const pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8'));
    const licenseFile = readdirSync(abs).find((f) => /^licen[cs]e/i.test(f));
    if (!licenseFile) {
      throw new Error(`${pkg.name} に LICENSE ファイルが見つかりません。THIRD-PARTY-NOTICES.txt を生成できません`);
    }
    // 旧式のオブジェクト形式や未記入だと見出しが "(undefined)" などに壊れるため止める
    if (typeof pkg.license !== 'string' || !pkg.license) {
      throw new Error(`${pkg.name} の package.json に license（SPDX 識別子の文字列）がありません。THIRD-PARTY-NOTICES.txt を生成できません`);
    }
    const text = readFileSync(join(abs, licenseFile), 'utf8').replace(/\r\n/g, '\n').trim();
    return `${pkg.name}@${pkg.version} (${pkg.license})\n${'-'.repeat(72)}\n${text}\n`;
  });
  return (
    'server.mjs は次の npm パッケージを同梱しています。\n' +
    'This bundle includes the following npm packages.\n\n' +
    sections.join('\n\n')
  );
}

// node -e / REPL から import したときは argv[1] が無い
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await bundle();
  console.log(`バンドル生成: ${bundleOutfile}`);
}
