// ファイル導入後の衣装を通常ロードし、変更前後の状態を返す。
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pingInfo, type BridgeClient } from "../bridge.js";
import { clothingTargetSchema, FILE_PROP_TYPE, inspectClothingCode, reloadClothingCode, type ClothingTarget } from "../clothing.js";
import { missingMenuReferenceCode } from "../menu-refs.js";
import { textResult, wrap } from "./types.js";

// フィールド構成は src/clothing.ts の inspectClothingCode が返す辞書と対応させること。
const snapshotSchema = z.object({
  maidId: z.number().int(), name: z.string(), visible: z.boolean(), busy: z.boolean(),
  menu: z.string(), temporaryMenu: z.string(), slotMpn: z.string(), noScale: z.boolean(), propType: z.number().int(),
  renderers: z.array(z.object({ meshId: z.number(), vertexCount: z.number(), subMeshCount: z.number() }).passthrough()),
  equipment: z.record(z.array(z.string())), dirtyEquipment: z.array(z.string()),
}).passthrough();
type Snapshot = z.infer<typeof snapshotSchema>;

/** 現在有効な menu 名。一時装備があればそちらが実際に読み込まれている。 */
function activeMenuOf(snapshot: Snapshot): string {
  return snapshot.temporaryMenu || snapshot.menu;
}

const reloadSchema = clothingTargetSchema.extend({
  expectedMaidId: z.number().int().describe("inspect_clothing で確認した maidId"),
  // 禁止文字は refresh_mod_files の files キーと揃える。
  expectedMenu: z.string().min(1).regex(/^[^/\\:\r\n\0]+\.menu$/i).describe("inspect_clothing で確認した現在有効なmenu名（一時装備があればそちら）。装備変更は行わない"),
  timeoutMs: z.number().int().min(500).max(30000).default(10000).describe("読み込み完了の待機上限"),
});
type ReloadInput = z.infer<typeof reloadSchema>;

// 完了待機のポーリング間隔。短いロードに追従しつつ、長引いたときに
// メインスレッドへ重い inspect を送り続けないよう倍々で伸ばして頭打ちにする。
const POLL_INTERVAL_MS = 100;
const POLL_INTERVAL_MAX_MS = 1000;

async function ensureAlive(bridge: BridgeClient): Promise<void> {
  const ping = await pingInfo(bridge);
  if (ping.mainThreadAlive !== true) throw new Error("メインスレッドの生存を確認できないため操作を中止しました");
}

async function inspect(bridge: BridgeClient, target: ClothingTarget): Promise<Snapshot> {
  const response = await bridge.evalCs(inspectClothingCode(target));
  if (!response.ok) throw new Error(`衣装の状態取得に失敗しました: ${response.error ?? "詳細不明"}`);
  const parsed = snapshotSchema.safeParse(typeof response.result === "string" ? JSON.parse(response.result) : response.result);
  if (!parsed.success) throw new Error("衣装の状態応答が不正です");
  return parsed.data;
}

/** 再読み込みを開始してよい状態か、変更前スナップショットと入力を突き合わせて確認する。 */
function assertReloadable(before: Snapshot, input: ReloadInput): void {
  if (before.maidId !== input.expectedMaidId) throw new Error("対象メイドが一致しません");
  if (!before.visible || before.busy) throw new Error("対象メイドが非表示または処理中です");
  if (before.propType !== FILE_PROP_TYPE) throw new Error("ファイル指定の装備ではないため再読み込みできません");
  if (before.slotMpn !== input.mpn) throw new Error("MPN とスロットが対応していません");
  if (before.dirtyEquipment.length) throw new Error("未処理の装備変更があるため再読み込みできません");
  if (activeMenuOf(before).toLowerCase() !== input.expectedMenu.toLowerCase()) throw new Error("着用中メニューが一致しません");
}

/** menu が参照する model・子 menu が揃っているか、ゲーム側の検索一覧で確認する。 */
async function assertReferencesResolvable(bridge: BridgeClient, menuName: string): Promise<void> {
  const response = await bridge.evalCs(missingMenuReferenceCode(menuName));
  if (!response.ok) throw new Error(`参照先ファイルの確認に失敗しました: ${response.error ?? "詳細不明"}`);
  const missing = String(response.result ?? "");
  if (missing) throw new Error(`参照先ファイルが見つかりません: ${missing}。refresh_mod_files で導入先を登録したか確認してください`);
}

/** AllProcPropSeqStart の完了を待ち、完了時点のスナップショットを返す。 */
async function waitForCompletion(bridge: BridgeClient, input: ReloadInput, before: Snapshot): Promise<Snapshot> {
  const deadline = Date.now() + input.timeoutMs;
  let interval = POLL_INTERVAL_MS;
  let after: Snapshot;
  do {
    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(interval * 2, POLL_INTERVAL_MAX_MS);
    await ensureAlive(bridge);
    after = await inspect(bridge, input);
    if (after.maidId !== before.maidId) throw new Error("待機中に対象メイドが変更されました");
    // 非表示になると busy 判定に使う値の意味が変わるため、待機を打ち切って状態を報告する。
    if (!after.visible) throw new Error("待機中に対象メイドが非表示になりました");
    if (!after.busy && !after.dirtyEquipment.length) break;
  } while (Date.now() < deadline);
  if (after.busy || after.dirtyEquipment.length) throw new Error("待機上限に達しました。ログ・ダイアログを確認してください");
  return after;
}

/** 再読み込み対象以外の装備で menu が変わった MPN を返す。 */
function diffOtherEquipment(before: Snapshot, after: Snapshot, mpn: string): string[] {
  return [...new Set([...Object.keys(before.equipment), ...Object.keys(after.equipment)])]
    .filter((key) => key !== mpn && JSON.stringify(before.equipment[key]) !== JSON.stringify(after.equipment[key]));
}

/**
 * inspect_clothing の出力用に装備一覧を「MPN → menu」へ畳む。
 * 全身で約 60 枠あり、そのまま返すと応答の大半を占めるため、空スロット（_del）を省き一時装備だけ併記する。
 */
function summarizeEquipment(equipment: Snapshot["equipment"]): Record<string, string> {
  const summary: Record<string, string> = {};
  // 各値は [通常menu, 一時menu]（src/clothing.ts の inspectClothingCode が生成する並び）
  for (const [mpn, [menu = "", temporary = ""]] of Object.entries(equipment)) {
    if (/_del\.menu$/i.test(menu) && !temporary) continue;
    summary[mpn] = temporary ? `${menu}（一時: ${temporary}）` : menu;
  }
  return summary;
}

/** reload_clothing の出力から、比較済みの装備一覧（equipmentChanged で報告する）を除く。 */
function withoutEquipment(snapshot: Snapshot): Omit<Snapshot, "equipment" | "dirtyEquipment"> {
  const { equipment: _equipment, dirtyEquipment: _dirty, ...rest } = snapshot;
  return rest;
}

/** 完了後のスナップショットが、対象装備の再読み込み以外の変化を含まないことを確認する。 */
function assertOnlyTargetReloaded(before: Snapshot, after: Snapshot, input: ReloadInput): string[] {
  if (after.menu !== before.menu || after.temporaryMenu !== before.temporaryMenu || after.slotMpn !== input.mpn || after.noScale !== before.noScale) {
    throw new Error("待機中に対象装備が変更されました");
  }
  const equipmentChanged = diffOtherEquipment(before, after, input.mpn);
  if (equipmentChanged.length) throw new Error(`対象外装備が変更されました: ${equipmentChanged.join(", ")}`);
  if (!after.renderers.length || after.renderers.some((r) => !r.meshId || r.vertexCount <= 0)) throw new Error("読み込み後の衣装Meshを確認できません");
  return equipmentChanged;
}

export function registerClothingTools(server: McpServer, bridge: BridgeClient): void {
  // このサーバーからの衣装更新は同時に実行しない。
  let reloading = false;
  server.registerTool("inspect_clothing", {
    description:
      "ストック番号・MPN・TBodyスロットで衣装を調査する。" +
      "メイドID、通常／一時menu、全SkinnedMeshRendererのMesh・材質・テクスチャ情報と装備一覧（MPN→menu。空スロットは省略）を返す。" +
      "ファイルコピーや装備変更は行わない。",
    inputSchema: clothingTargetSchema.shape,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap(async (args) => {
    const target = clothingTargetSchema.parse(args);
    await ensureAlive(bridge);
    const snapshot = await inspect(bridge, target);
    return textResult(JSON.stringify({ ...snapshot, equipment: summarizeEquipment(snapshot.equipment) }, null, 2));
  }));

  server.registerTool("reload_clothing", {
    description:
      "導入済みの衣装を現在有効なmenuのまま再読み込みする。" +
      "先にinspect_clothingでメイドID・menu・MPN・スロットを確認すること。非表示・busy・未処理の装備変更がある間は拒否。" +
      "SetPropを使わずboDut／boTempDutを立ててAllProcPropSeqStartを回すため、menu名・RID・スケール設定は書き換えない。" +
      "一時装備は一時装備のまま再処理する。開始後は有限待機し、変更前後のMesh等と対象外装備を比較する。" +
      "ファイル導入・SceneEditorモデル・保存・再起動には非対応。" +
      "結果だけで形状や表示の完全一致とはせず、screenshotで確認する。",
    inputSchema: reloadSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, wrap(async (args) => {
    const input = reloadSchema.parse(args);
    if (reloading) throw new Error("衣装の再読み込みが既に進行中です");
    reloading = true;
    let started = false;
    try {
      await ensureAlive(bridge);
      const before = await inspect(bridge, input);
      assertReloadable(before, input);
      await assertReferencesResolvable(bridge, activeMenuOf(before));
      // 通信が失われた場合にも、再送で処理を重ねないよう明示する。
      started = true;
      const result = await bridge.evalCs(reloadClothingCode(input, before.maidId, activeMenuOf(before)));
      if (!result.ok) throw new Error(`再読み込み要求に失敗しました: ${result.error ?? "詳細不明"}`);
      if (result.result !== "started") throw new Error("再読み込み開始の応答が不正です");
      const after = await waitForCompletion(bridge, input, before);
      const equipmentChanged = assertOnlyTargetReloaded(before, after, input);
      return textResult(JSON.stringify({
        status: "completed", normalLoadCompleted: true, visualVerified: false, geometryVerified: false,
        meshIdsChanged: JSON.stringify(before.renderers.map((r) => r.meshId)) !== JSON.stringify(after.renderers.map((r) => r.meshId)),
        before: withoutEquipment(before), after: withoutEquipment(after), equipmentChanged,
      }, null, 2));
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}${started ? "。再読み込み要求は送信済みです。自動再試行せず現在の状態を確認してください" : ""}`);
    } finally {
      reloading = false;
    }
  }));
}
