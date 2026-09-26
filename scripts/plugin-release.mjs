// plugin を Release ビルドし、zip 化して tag push → GitHub Release まで一括で行う。
// --dry-run を付けると tag push / release create をスキップし、zip の内容だけを表示する。
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  artifactDlls,
  buildOutputDir,
  buildPlugin,
  capture,
  readPluginVersion,
  repoRoot,
  resolveGameDir,
  run,
  runMain,
} from './plugin-common.mjs';
import { bundle, bundleNoticesFile, bundleOutfile } from './bundle.mjs';
import { createZip } from './zip.mjs';

const configuration = 'Release';
/** zip に DLL と並べて入れるライセンス文書（リポジトリ直下からの相対パス）。 */
const releaseNoticeFiles = ['LICENSE', 'THIRD-PARTY-NOTICES.md'];
const dryRun = process.argv.slice(2).includes('--dry-run');

/** working tree が clean か確認する（未追跡ファイルも対象）。 */
function assertCleanWorkTree() {
  const status = capture('git', ['status', '--porcelain']).trim();
  if (status) {
    throw new Error(`working tree に未コミットの変更があります。コミットしてから再実行してください:\n${status}`);
  }
}

// gh auth status の終了コードで認証済みか判定する
function assertGhAuth() {
  try {
    capture('gh', ['auth', 'status']);
  } catch {
    throw new Error('gh CLI が未認証です。`gh auth login` を実行してください');
  }
}

/** リモートと同期した上で tag / Release の有無を調べる。 */
function inspectExistingRelease(tag) {
  run('git', ['fetch', '--tags', '--force']);
  const tags = capture('git', ['tag', '--list', tag]).trim();
  if (!tags) {
    return { tagExists: false, releaseExists: false };
  }
  // 既定の取得件数は 30 件。リリースが増えても取りこぼさないよう明示的に広げる
  const result = capture('gh', ['release', 'list', '--limit', '200', '--json', 'tagName']);
  const releaseExists = JSON.parse(result).some((r) => r.tagName === tag);
  return { tagExists: true, releaseExists };
}

runMain(async () => {
  const version = readPluginVersion();
  const tag = `v${version}`;

  // tag も Release も既にある＝バージョン上げ忘れ。tag だけある場合は途中失敗の再実行とみなす
  let skipTagPush = false;
  if (!dryRun) {
    assertCleanWorkTree();
    assertGhAuth();
    const { tagExists, releaseExists } = inspectExistingRelease(tag);
    if (tagExists && releaseExists) {
      throw new Error(
        `${tag} は既にリリース済みです。\`npm run plugin:bump\` でバージョンを上げてください`,
      );
    }
    if (tagExists) {
      console.log(`${tag} は既に存在しますが Release がありません。再実行とみなし tag push をスキップします`);
      skipTagPush = true;
    }
  }

  // コードより古いバンドルを tag に載せないため、再生成して差分が出たら止める
  await bundle();
  const stale = capture('git', ['status', '--porcelain', '--', bundleOutfile, bundleNoticesFile]).trim();
  if (stale) {
    throw new Error('agent-plugin/dist/ のバンドルがコードと一致しません。`npm run bundle` の結果をコミットしてから再実行してください');
  }

  buildPlugin(configuration, resolveGameDir());

  const outDir = buildOutputDir(configuration);
  // Mono.CSharp.dll（MIT）の再配布にはライセンス表示の同梱が要るため、DLL と並べて入れる
  const files = [
    ...artifactDlls.map((dll) => join(outDir, dll)),
    ...releaseNoticeFiles.map((f) => resolve(repoRoot, f)),
  ];
  const entries = files.map((path) => ({
    // BepInEx/plugins/ 直下に展開できるフォルダ構成にする
    name: `COM3D25.DevBridge/${basename(path)}`,
    data: readFileSync(path),
    mtime: statSync(path).mtime,
  }));

  const artifactDir = resolve(repoRoot, 'plugin/bin/release-artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const zipPath = join(artifactDir, `COM3D25.DevBridge-${tag}.zip`);
  writeFileSync(zipPath, createZip(entries));

  console.log(`zip 作成: ${zipPath}`);
  for (const entry of entries) {
    console.log(`  ${entry.name} (${entry.data.length} bytes)`);
  }

  if (dryRun) {
    console.log('--dry-run のため tag push と gh release create はスキップしました');
    return;
  }

  if (!skipTagPush) {
    run('git', ['tag', tag]);
    run('git', ['push', 'origin', tag]);
  }

  run('gh', ['release', 'create', tag, zipPath, '--title', tag, '--generate-notes']);
  console.log(`リリース完了: ${tag}`);
});
