import { describe, expect, it } from 'vitest';
// @ts-expect-error 型定義のない自前スクリプト
import { bumpVersion } from '../scripts/semver.mjs';

describe('bumpVersion', () => {
  it('patch を 1 上げる', () => {
    expect(bumpVersion('0.3.0', 'patch')).toBe('0.3.1');
  });

  it('minor を上げると patch は 0 に戻る', () => {
    expect(bumpVersion('0.3.4', 'minor')).toBe('0.4.0');
  });

  it('major を上げると minor と patch は 0 に戻る', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('不正な種別はエラーになる', () => {
    expect(() => bumpVersion('1.2.3', 'build')).toThrow(/不正な bump 種別/);
  });

  it('不正なバージョン文字列はエラーになる', () => {
    expect(() => bumpVersion('1.2', 'patch')).toThrow(/不正なバージョン文字列/);
  });
});
