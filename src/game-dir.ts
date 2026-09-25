// ゲームディレクトリの解決。GAME_DIR 環境変数を不要にするための機構。
// ブリッジから取得した値をディスクへキャッシュしておくことで、ゲームがクラッシュ・
// フリーズしてブリッジに繋がらないときもクラッシュ後のログ検死（tail_log）を可能にする。
import { readFileSync, writeFileSync } from "node:fs";

export type GameDirSource = { pingGameDir(): Promise<string | undefined> };

export class GameDirResolver {
  constructor(
    private readonly source: GameDirSource,
    private readonly cacheFile: string,
    private readonly override?: string,
  ) {}

  /** 解決順: env 上書き → ブリッジ /ping（成功時はキャッシュ更新） → ディスクキャッシュ。 */
  async resolve(): Promise<string> {
    if (this.override) return this.override;

    let fromPing: string | undefined;
    try {
      fromPing = await this.source.pingGameDir();
    } catch {
      // ブリッジ未起動（ゲーム停止・クラッシュ中）→ キャッシュへフォールバック
    }
    if (fromPing) {
      this.saveCache(fromPing);
      return fromPing;
    }

    const cached = this.loadCache();
    if (cached) return cached;

    throw new Error(
      "ゲームディレクトリを解決できません。ゲームを一度起動してブリッジに接続するか、" +
        "GAME_DIR 環境変数でゲームのインストール先を指定してください。",
    );
  }

  private loadCache(): string | undefined {
    try {
      const v = readFileSync(this.cacheFile, "utf8").trim();
      return v.length > 0 ? v : undefined;
    } catch {
      return undefined; // キャッシュ未作成・読み込み不可は「初回起動」として扱う
    }
  }

  private saveCache(gameDir: string): void {
    try {
      if (this.loadCache() === gameDir) return; // 不要なディスク書き込みを避ける
      writeFileSync(this.cacheFile, gameDir, "utf8");
    } catch {
      // キャッシュ書き込み失敗は致命的ではない（次回 ping で再取得できる）
    }
  }
}
