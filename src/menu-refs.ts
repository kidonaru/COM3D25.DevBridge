// menu が参照する model・子 menu が検索対象に入っているかを確認する C# テンプレート。
import { csharpString, expression } from "./csharp.js";

/**
 * 欠けている最初のファイル名（すべて揃っていれば空文字列）を返す C# 式を組み立てる。
 * menu のバイナリ形式は ModItemExplorer の ModMenuLoader と同じ読み方をする:
 * ヘッダ "CM3D2_MENU" + int32 + string×4 + int32 のあと、
 * 「byte（要素数）+ その数の string」というコマンドブロックが 0 バイトまで並ぶ。
 */
export function missingMenuReferenceCode(menuName: string): string {
  return expression(`
// 存在確認は Mod 側を先に見る。大文字小文字の違いで取りこぼさないよう小文字でも確認する。
System.Func<string, bool> exists = (string name) => {
  if (System.String.IsNullOrEmpty(name)) return false;
  System.Func<string, bool> probe = (string n) =>
    (GameUty.FileSystemMod != null && GameUty.FileSystemMod.IsExistentFile(n))
    || (GameUty.FileSystem != null && GameUty.FileSystem.IsExistentFile(n));
  return probe(name) || (name.ToLower() != name && probe(name.ToLower()));
};
var pending = new System.Collections.Generic.Stack<string>();
var visited = new System.Collections.Generic.HashSet<string>();
// 起点だけは呼び出し元の表記のまま積む（欠落時にその名前をそのまま返して伝えるため）。
// 子メニューは移植元と同じく小文字化して積む。
pending.Push(${csharpString(menuName)});
while (pending.Count > 0) {
  var current = pending.Pop();
  // 循環参照や重複参照で無限ループしないよう、確認済みは辿り直さない。
  if (!visited.Add(current)) continue;
  if (!exists(current)) return current;
  byte[] buffer;
  using (var file = GameUty.FileOpen(current)) {
    if (file == null || !file.IsValid()) return current;
    buffer = file.ReadAll();
  }
  using (var reader = new System.IO.BinaryReader(new System.IO.MemoryStream(buffer), System.Text.Encoding.UTF8)) {
    if (reader.ReadString() != "CM3D2_MENU") continue;
    reader.ReadInt32();
    reader.ReadString(); reader.ReadString(); reader.ReadString(); reader.ReadString();
    reader.ReadInt32();
    for (;;) {
      byte count = reader.ReadByte();
      if (count == 0) break;
      // UTY.GetStringCom/GetStringList はゲーム本来の menu テキスト行と同じ "..." 区切りを
      // 前提にするため、読み取った各トークンを再度クォートで囲み直してから渡す。
      var text = "";
      for (int i = 0; i < (int)count; i++) text = text + '"' + reader.ReadString() + '"';
      if (System.String.IsNullOrEmpty(text)) continue;
      var command = UTY.GetStringCom(text);
      var values = UTY.GetStringList(text);
      if (command == "end") break;
      if (command == "additem") {
        if (values.Length > 1 && !System.String.IsNullOrEmpty(values[1]) && !exists(values[1])) return values[1];
      } else if (command == "アイテム") {
        // セット系メニューは子メニューのモデルも読み込まれるため再帰的に確認する。
        if (values.Length > 1 && !System.String.IsNullOrEmpty(values[1])) pending.Push(values[1].ToLower());
      }
    }
  }
}
return "";
`);
}
