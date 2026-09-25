// plugin ビルド系スクリプトの共通処理。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** リポジトリのルート（scripts/ の 1 つ上）。 */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 開発者ごとの設定を書く .env。リポジトリにはコミットしない。 */
export const envFilePath = resolve(repoRoot, '.env');

/** plugin プロジェクトファイルのパス。 */
export const csprojPath = resolve(repoRoot, 'plugin/COM3D25.DevBridge.csproj');

/**
 * MCP サーバ（npm パッケージ）のバージョンを持つファイル。
 * リリースタグ v<Version> は csproj 基準で打たれ、MCP の pin 先も同じタグを指すため、
 * plugin と MCP のバージョンは常に揃える（bump は両方をまとめて上げる）。
 */
export const packageJsonPath = resolve(repoRoot, 'package.json');
export const packageLockPath = resolve(repoRoot, 'package-lock.json');

/**
 * エージェント向けプラグインのマニフェスト。version で更新が判定されるため、
 * plugin / MCP サーバと同じバージョンに揃える。
 */
export const claudePluginJsonPath = resolve(repoRoot, 'agent-plugin/.claude-plugin/plugin.json');
export const codexPluginJsonPath = resolve(repoRoot, 'agent-plugin/.codex-plugin/plugin.json');

/** MCP サーバーが initialize で名乗る SERVER_VERSION 定数を持つファイル。 */
export const serverVersionPath = resolve(repoRoot, 'src/version.ts');

/** ビルド成果物に含める DLL（ゲーム由来 DLL は絶対に入れない）。 */
export const artifactDlls = ['COM3D25.DevBridge.dll', 'Mono.CSharp.dll'];

/** ビルド先のターゲットフレームワーク。 */
export const targetFramework = 'netstandard2.1';

/** 設定不足を伝えるためのエラー（スタックトレースを出さずに終了させる）。 */
export class ConfigError extends Error {}

/**
 * .env から値を 1 つ読む。
 * process.loadEnvFile() は Node 20.12 以降でしか使えず、package.json の engines
 * （MCP サーバー側の要件。>=18）と食い違うため、必要最小限の自前パースにしている。
 */
function readEnvFile(key) {
  if (!existsSync(envFilePath)) return undefined;
  for (const line of readFileSync(envFilePath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] !== key) continue;
    // 値を囲む引用符だけを剥がす（Windows のパス区切りをエスケープ解釈しないため）
    return match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

/**
 * COM3D2.5 のインストール先を解決する。
 * インストール先は開発者ごとに異なるため既定値は持たず、未設定ならエラーにする。
 * 解決順: 既存の GAME_DIR 環境変数 → リポジトリ直下の .env。
 */
export function resolveGameDir() {
  const gameDir = process.env.GAME_DIR?.trim() || readEnvFile('GAME_DIR');
  if (!gameDir) {
    throw new ConfigError(
      'GAME_DIR が未設定です。.env.example を .env にコピーし、' +
        'COM3D2.5 のインストール先を GAME_DIR に書いてください。\n' +
        `  ${envFilePath}`,
    );
  }
  if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) {
    throw new ConfigError(`GAME_DIR のディレクトリが存在しません: ${gameDir}`);
  }
  return gameDir;
}

/** スクリプト本体を実行し、設定不足は要点だけを出して終了する。 */
export async function runMain(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** spawnSync を実行し、起動失敗・非ゼロ終了をエラーにする。 */
function spawnChecked(command, args, options) {
  const result = spawnSync(command, args, { cwd: repoRoot, ...options });
  if (result.error) {
    throw new Error(`${command} の起動に失敗しました: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr ? `\n${result.stderr}` : '';
    throw new Error(
      `${command} ${args.join(' ')} が終了コード ${result.status} で失敗しました${detail}`,
    );
  }
  return result;
}

/** コマンドを継承 stdio で実行する。 */
export function run(command, args) {
  return spawnChecked(command, args, { stdio: 'inherit' });
}

/** コマンドの標準出力を文字列で取得する。 */
export function capture(command, args) {
  return spawnChecked(command, args, { encoding: 'utf8' }).stdout ?? '';
}

/** dotnet build を実行する。configuration は Debug / Release。 */
export function buildPlugin(configuration, gameDir) {
  run('dotnet', ['build', csprojPath, '-c', configuration, `-p:GameDir=${gameDir}`]);
}

/** csproj から <Version> を読み取る。 */
export function readPluginVersion() {
  const xml = readFileSync(csprojPath, 'utf8');
  const match = xml.match(/<Version>([^<]+)<\/Version>/);
  if (!match) {
    throw new Error(`${csprojPath} に <Version> が見つかりません`);
  }
  return match[1].trim();
}

/** package.json から version を読み取る。 */
export function readNpmVersion() {
  const json = readFileSync(packageJsonPath, 'utf8');
  const match = json.match(/"version":\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`${packageJsonPath} に version が見つかりません`);
  }
  return match[1];
}

/** ビルド成果物ディレクトリ（plugin/bin/<configuration>/<tfm>）。 */
export function buildOutputDir(configuration) {
  return resolve(repoRoot, 'plugin/bin', configuration, targetFramework);
}
