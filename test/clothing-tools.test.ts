import { afterEach, describe, expect, it, vi } from "vitest";
import { registerClothingTools } from "../src/tools/clothing.js";
import { inspectClothingCode, reloadClothingCode } from "../src/clothing.js";
import { csharpString } from "../src/csharp.js";
import { missingMenuReferenceCode } from "../src/menu-refs.js";
import { collectTools } from "./helpers.js";

const target = { maidIndex: 2, mpn: "stkg", slot: "stkg" };
const input = { ...target, expectedMaidId: 41, expectedMenu: "sample.menu", timeoutMs: 500 };
const snapshot = {
  maidId: 41, name: "テスト", visible: true, busy: false, menu: "sample.menu", temporaryMenu: "",
  propType: 3,
  dirtyEquipment: [], slotMpn: "stkg", noScale: true, model: "sample.model",
  renderers: [{ meshId: 10, vertexCount: 300, subMeshCount: 2, materials: [{ name: "布" }] }],
  equipment: { stkg: ["sample.menu", ""], shoes: ["shoes.menu", ""] },
};
const reply = (state: unknown) => ({ ok: true, result: JSON.stringify(state) });

function setup() {
  const bridge = {
    pingRaw: vi.fn().mockResolvedValue(JSON.stringify({ mainThreadAlive: true })),
    evalCs: vi.fn(),
  };
  const { server, tools } = collectTools();
  registerClothingTools(server, bridge as never);
  return { bridge, inspect: tools.get("inspect_clothing")!, reload: tools.get("reload_clothing")! };
}

afterEach(() => vi.useRealTimers());

describe("衣装の状態確認と再読み込み", () => {
  it("全材質情報を保持して状態を返す", async () => {
    const s = setup();
    s.bridge.evalCs.mockResolvedValue(reply(snapshot));
    const result = await s.inspect(target);
    const { equipment, ...rest } = JSON.parse(result.content[0].text!);
    const { equipment: _raw, ...snapshotCore } = snapshot;
    expect(rest).toEqual(snapshotCore);
    expect(equipment).toEqual({ stkg: "sample.menu", shoes: "shoes.menu" });
    expect(s.bridge.evalCs).toHaveBeenCalledTimes(1);
  });

  it("装備一覧は空スロット（_del）を省き、一時装備だけ併記する", async () => {
    const s = setup();
    s.bridge.evalCs.mockResolvedValue(reply({
      ...snapshot,
      equipment: { stkg: ["sample.menu", "try.menu"], wear: ["_I_wear_del.menu", ""], shoes: ["shoes.menu", ""] },
    }));
    const result = await s.inspect(target);
    expect(JSON.parse(result.content[0].text!).equipment).toEqual({ stkg: "sample.menu（一時: try.menu）", shoes: "shoes.menu" });
  });

  it.each([
    [{ maidId: 42 }, "メイド"], [{ busy: true }, "処理中"], [{ visible: false }, "非表示"],
    [{ menu: "other.menu" }, "メニュー"],
    [{ propType: 1 }, "ファイル指定"],
    [{ slotMpn: "shoes" }, "対応"], [{ dirtyEquipment: ["shoes"] }, "未処理"],
  ])("対象条件 %j の不一致では変更しない", async (change, message) => {
    const s = setup();
    s.bridge.evalCs.mockResolvedValue(reply({ ...snapshot, ...change }));
    const result = await s.reload(input);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(s.bridge.evalCs).toHaveBeenCalledTimes(1);
  });

  it("停止したメインスレッドへ評価を送らない", async () => {
    const s = setup();
    s.bridge.pingRaw.mockResolvedValue('{"mainThreadAlive":false}');
    expect((await s.reload(input)).isError).toBe(true);
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it("入力へのコード混入を評価前に拒否する", async () => {
    const s = setup();
    expect((await s.reload({ ...input, mpn: 'stkg); throw new Exception();' })).isError).toBe(true);
    expect(s.bridge.pingRaw).not.toHaveBeenCalled();
    expect(csharpString('x";危険')).toBe('@"x"";危険"');
  });

  it("busy終了を待ち、通常ロードと表示・形状の検証を区別する", async () => {
    vi.useFakeTimers();
    const s = setup();
    const after = { ...snapshot, renderers: [{ meshId: 20, vertexCount: 350, subMeshCount: 3 }] };
    s.bridge.evalCs.mockResolvedValueOnce(reply(snapshot)).mockResolvedValueOnce({ ok: true, result: "" })
      .mockResolvedValueOnce({ ok: true, result: "started" })
      .mockResolvedValueOnce(reply({ ...snapshot, busy: true })).mockResolvedValue(reply(after));
    const promise = s.reload(input);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text!);
    const { equipment: _beforeEquipment, dirtyEquipment: _beforeDirty, ...beforeCore } = snapshot;
    const { equipment: _afterEquipment, dirtyEquipment: _afterDirty, ...afterCore } = after;
    expect(body).toMatchObject({ normalLoadCompleted: true, visualVerified: false, geometryVerified: false, meshIdsChanged: true, before: beforeCore, after: afterCore, equipmentChanged: [] });
    // 装備一覧は比較済み（equipmentChanged）なので、出力には含めない
    expect(body.before.equipment).toBeUndefined();
    expect(body.after.equipment).toBeUndefined();
    expect(s.bridge.evalCs).toHaveBeenCalledTimes(5);
  });

  it.each([
    [{ busy: true }, "待機上限"], [{ dirtyEquipment: ["stkg"] }, "待機上限"],
    [{ renderers: [] }, "Mesh"],
    [{ maidId: 99 }, "メイド"],
    [{ noScale: false }, "装備"],
    [{ equipment: { ...snapshot.equipment, shoes: ["changed.menu", ""] } }, "対象外装備"],
  ])("再読み込み後の異常 %j を成功にしない", async (change, message) => {
    vi.useFakeTimers();
    const s = setup();
    s.bridge.evalCs.mockResolvedValueOnce(reply(snapshot)).mockResolvedValueOnce({ ok: true, result: "" })
      .mockResolvedValueOnce({ ok: true, result: "started" })
      .mockResolvedValue(reply({ ...snapshot, ...change }));
    const promise = s.reload(input);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(result.content[0].text).toContain("送信済み");
    expect(s.bridge.evalCs.mock.calls.filter(([code]) => code.includes("AllProcPropSeqStart"))).toHaveLength(1);
  });

  it("開始失敗後に状態取得を繰り返さない", async () => {
    const s = setup();
    s.bridge.evalCs.mockResolvedValueOnce(reply(snapshot)).mockResolvedValueOnce({ ok: true, result: "" })
      .mockResolvedValueOnce({ ok: false, error: "コンパイル失敗" });
    expect((await s.reload(input)).isError).toBe(true);
    expect(s.bridge.evalCs).toHaveBeenCalledTimes(3);
  });

  it("同時更新を拒否し、終了後はロックを解放する", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.bridge.evalCs.mockResolvedValueOnce(reply(snapshot)).mockResolvedValueOnce({ ok: true, result: "" })
      .mockResolvedValueOnce({ ok: true, result: "started" }).mockResolvedValue(reply(snapshot));
    const first = s.reload(input);
    expect((await s.reload(input)).content[0].text).toContain("進行中");
    await vi.runAllTimersAsync();
    expect((await first).isError).toBeUndefined();
    s.bridge.pingRaw.mockResolvedValue('{"mainThreadAlive":false}');
    expect((await s.reload(input)).content[0].text).toContain("メインスレッド");
  });

  it("待機中に非表示になったら完了扱いにしない", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.bridge.evalCs.mockResolvedValueOnce(reply(snapshot)).mockResolvedValueOnce({ ok: true, result: "" })
      .mockResolvedValueOnce({ ok: true, result: "started" })
      .mockResolvedValue(reply({ ...snapshot, visible: false }));
    const promise = s.reload(input);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("非表示");
  });

  it("状態応答の形状が不正なら成功にしない", async () => {
    const s = setup();
    s.bridge.evalCs.mockResolvedValue(reply({ ...snapshot, renderers: "壊れた応答" }));
    const result = await s.inspect(target);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("不正");
  });

  it("JSONでないping応答を分かるエラーにする", async () => {
    const s = setup();
    s.bridge.pingRaw.mockResolvedValue("<html>error</html>");
    const result = await s.inspect(target);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("/ping");
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it("一時装備を対象にでき、boTempDut を立てる", async () => {
    vi.useFakeTimers();
    const s = setup();
    const temporary = { ...snapshot, temporaryMenu: "temp.menu" };
    s.bridge.evalCs.mockResolvedValueOnce(reply(temporary)).mockResolvedValueOnce({ ok: true, result: "" })
      .mockResolvedValueOnce({ ok: true, result: "started" })
      .mockResolvedValue(reply(temporary));
    const promise = s.reload({ ...input, expectedMenu: "temp.menu" });
    await vi.runAllTimersAsync();
    expect((await promise).isError).toBeUndefined();
    const [code] = s.bridge.evalCs.mock.calls.find(([c]) => c.includes("AllProcPropSeqStart"))!;
    expect(code).toContain("boTempDut = true");
  });

  it("menu名・RID・スケール設定を書き換えない", () => {
    const code = reloadClothingCode(target, 41, "sample.menu");
    expect(code).not.toContain("SetProp");
    expect(code).not.toContain("nFileNameRID");
    expect(code).not.toContain("bNoScale");
    expect(code).toContain("maid.AllProcPropSeqStart();");
  });

  it("ファイル指定でない装備はゲーム側でも拒否する", () => {
    expect(reloadClothingCode(target, 41, "sample.menu")).toContain("prop.type != 3");
  });

  it("参照先ファイルが欠けていれば再読み込みを送らない", async () => {
    const s = setup();
    s.bridge.evalCs.mockResolvedValueOnce(reply(snapshot)).mockResolvedValueOnce({ ok: true, result: "missing.model" });
    const result = await s.reload(input);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing.model");
    expect(result.content[0].text).not.toContain("送信済み");
    expect(s.bridge.evalCs.mock.calls.some(([c]) => c.includes("AllProcPropSeqStart"))).toBe(false);
  });

  it("参照先がすべて揃っていれば再読み込みへ進む", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.bridge.evalCs.mockResolvedValueOnce(reply(snapshot)).mockResolvedValueOnce({ ok: true, result: "" })
      .mockResolvedValueOnce({ ok: true, result: "started" }).mockResolvedValue(reply(snapshot));
    const promise = s.reload(input);
    await vi.runAllTimersAsync();
    expect((await promise).isError).toBeUndefined();
  });

  it("参照確認のC#はadditemと子アイテムを辿る", () => {
    const code = missingMenuReferenceCode("sample.menu");
    expect(code).toContain('@"sample.menu"');
    expect(code).toContain('"CM3D2_MENU"');
    expect(code).toContain('== "additem"');
    expect(code).toContain('== "アイテム"');
    // 循環参照で無限ループしないこと
    expect(code).toContain("HashSet<string>");
  });

  it("C#は実行直前に対象を再確認し、有効なmenuだけを再処理する", () => {
    const code = reloadClothingCode(target, 41, 'sample"name.menu');
    expect(code).toContain('slot.m_ParentMPN != mpn');
    expect(code).toContain('@"sample""name.menu"');
    expect(code.indexOf('maid.GetInstanceID() != 41')).toBeLessThan(code.indexOf('maid.AllProcPropSeqStart()'));
    expect(inspectClothingCode(target)).toContain('GetComponentsInChildren<UnityEngine.SkinnedMeshRenderer>(true)');
    // IsBusy は IsAllProcPropBusy && Visible のため、非表示中は完了前でも false になる
    expect(inspectClothingCode(target)).toContain('{ "busy", maid.IsAllProcPropBusy }');
    expect(code).toContain('maid.IsAllProcPropBusy');
  });
});
