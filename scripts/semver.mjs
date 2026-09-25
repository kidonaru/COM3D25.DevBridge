// plugin バージョンの semver 加算ロジック（単体テスト対象）。

/** 加算可能な種別。 */
export const bumpKinds = ['major', 'minor', 'patch'];

/**
 * semver を指定種別で 1 つ上げる。
 *
 * @param {string} version `1.2.3` 形式のバージョン
 * @param {'major'|'minor'|'patch'} kind 加算する桁
 * @returns {string} 加算後のバージョン
 */
export function bumpVersion(version, kind) {
  if (!bumpKinds.includes(kind)) {
    throw new Error(`不正な bump 種別です: ${kind}（${bumpKinds.join(' / ')} のいずれか）`);
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`不正なバージョン文字列です: ${version}（major.minor.patch 形式のみ対応）`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
