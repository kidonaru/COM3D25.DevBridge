// plugin の csproj <Version>、MCP サーバ（package.json / package-lock.json）、
// エージェント向けプラグインのマニフェストの version をまとめて上げ、
// 再生成したバンドルと合わせてそれらのファイルだけをコミットする。
import { readFileSync, writeFileSync } from 'node:fs';
import { bundle, bundleOutfile } from './bundle.mjs';
import {
  capture,
  claudePluginJsonPath,
  codexPluginJsonPath,
  ConfigError,
  csprojPath,
  packageJsonPath,
  packageLockPath,
  readNpmVersion,
  readPluginVersion,
  run,
  runMain,
  serverVersionPath,
} from './plugin-common.mjs';
import { bumpVersion } from './semver.mjs';

/** bump で version を書き換えるファイル。 */
const bumpTargets = [
  csprojPath,
  packageJsonPath,
  packageLockPath,
  claudePluginJsonPath,
  codexPluginJsonPath,
  serverVersionPath,
];

/** コミット対象（bump 対象 + 再生成したバンドル）。 */
const commitTargets = [...bumpTargets, bundleOutfile];

/**
 * bump 対象にバージョン以外の未コミット変更が無いか確認する。
 * git commit --only は指定パスの現在の内容全体をコミットするため、
 * 他の編集が残っていると chore コミットに巻き込まれてしまう。
 */
function assertTargetsHaveNoOtherChanges() {
  const diff = capture('git', ['diff', 'HEAD', '--', ...bumpTargets]).trim();
  if (diff) {
    throw new ConfigError(
      'バージョン更新対象に未コミットの変更があります。先にコミットするか退避してから再実行してください。\n' +
        `  git diff -- ${bumpTargets.join(' ')}`,
    );
  }
}

/**
 * JSON 内の version フィールドを先頭から count 件だけ差し替えた内容を返す（書き込みはしない）。
 * package.json は CRLF、package-lock.json は LF と改行コードが異なるため、
 * JSON.parse/stringify の再生成ではなく現在値のピンポイント置換で書き換える。
 */
function renderJsonVersion(path, current, next, count) {
  const text = readFileSync(path, 'utf8');
  const pattern = new RegExp(`("version":\\s*")${current.replace(/\./g, '\\.')}(")`, 'g');
  let replaced = 0;
  const updated = text.replace(pattern, (match, head, tail) =>
    replaced++ < count ? `${head}${next}${tail}` : match,
  );
  if (replaced < count) {
    throw new ConfigError(`${path} の version ${current} を ${count} 箇所見つけられませんでした（実際 ${replaced} 箇所）`);
  }
  return updated;
}

/** src/version.ts の SERVER_VERSION を差し替えた内容を返す（書き込みはしない）。 */
function renderServerVersion(current, next) {
  const text = readFileSync(serverVersionPath, 'utf8');
  const pattern = `SERVER_VERSION = "${current}"`;
  if (!text.includes(pattern)) {
    throw new ConfigError(`${serverVersionPath} に ${pattern} が見つかりません。package.json の version に合わせてから再実行してください`);
  }
  return text.replace(pattern, `SERVER_VERSION = "${next}"`);
}

/**
 * package-lock.json が「ルート → packages[""] の順に current 版を持つ」構造であることを検証する。
 * 先頭 2 件だけを置換する実装は npm の出力順序（依存の version はこの 2 つより後ろ）に依存しているため、
 * 前提が崩れていたら依存パッケージの版を書き換える前に停止する。
 */
function assertLockStructure(current) {
  const lock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
  const firstPackageKey = Object.keys(lock.packages ?? {})[0];
  if (lock.version !== current || firstPackageKey !== '' || lock.packages['']?.version !== current) {
    throw new ConfigError(
      `${packageLockPath} が想定の構造ではありません（ルートと packages[""] の version が ${current} で先頭に並ぶこと）。\n` +
        'npm install で作り直してから再実行してください。',
    );
  }
}

/** バンドルは HEAD のコードから作る。src やビルド設定に未コミット変更があると tag と中身がずれる。 */
function assertBundleSourcesClean() {
  const inputs = ['src', 'package-lock.json', 'scripts/bundle.mjs', 'tsconfig.json'];
  const status = capture('git', ['status', '--porcelain', '--', ...inputs]).trim();
  if (status) {
    throw new ConfigError(`バンドル元に未コミットの変更があります。コミットしてから再実行してください:\n${status}`);
  }
}

runMain(async () => {
  const kind = process.argv[2] ?? 'patch';
  const current = readPluginVersion();
  let next;
  try {
    next = bumpVersion(current, kind);
  } catch (err) {
    // 引数の指定ミスはスタックトレースではなく要点だけを見せる
    throw new ConfigError(err.message);
  }

  // 手作業で片方だけ編集された状態から bump すると乖離が固定化するため先に弾く
  const npmCurrent = readNpmVersion();
  if (npmCurrent !== current) {
    throw new ConfigError(
      `plugin (${current}) と MCP サーバ (${npmCurrent}) のバージョンが揃っていません。\n` +
        '先に package.json / package-lock.json を csproj に合わせてからやり直してください。',
    );
  }

  assertLockStructure(current);
  assertTargetsHaveNoOtherChanges();
  assertBundleSourcesClean();

  // 全ファイルの新しい内容を先に作り切ってから書く（途中で失敗しても部分適用を残さない）
  const xml = readFileSync(csprojPath, 'utf8');
  const updated = [
    [csprojPath, xml.replace(/<Version>[^<]+<\/Version>/, `<Version>${next}</Version>`)],
    [packageJsonPath, renderJsonVersion(packageJsonPath, current, next, 1)],
    [packageLockPath, renderJsonVersion(packageLockPath, current, next, 2)], // ルート + packages[""]
    [claudePluginJsonPath, renderJsonVersion(claudePluginJsonPath, current, next, 1)],
    [codexPluginJsonPath, renderJsonVersion(codexPluginJsonPath, current, next, 1)],
    [serverVersionPath, renderServerVersion(current, next)],
  ];
  for (const [path, content] of updated) {
    writeFileSync(path, content);
  }

  try {
    // バンドル生成の失敗でも書き換え済みのファイルを巻き戻せるよう、コミットと同じ try に入れる
    await bundle();
    // --only で対象ファイルだけをコミットする（index の他の変更を巻き込まない）
    run('git', ['commit', '--only', '-m', `chore: v${next}`, '--', ...commitTargets]);
  } catch (err) {
    // バンドル生成失敗・commit hook 拒否等で失敗したら書き換えを巻き戻す
    // （対象ファイルに他の未コミット変更が無いことは事前に検証済みなので破棄して安全）
    run('git', ['checkout', '--', ...commitTargets]);
    throw new ConfigError(`バンドル生成またはコミットに失敗したためバージョン更新を巻き戻しました: ${err.message}`);
  }

  console.log(`バージョン更新: ${current} → ${next}（plugin / MCP サーバ / エージェント向けプラグイン）`);
});
