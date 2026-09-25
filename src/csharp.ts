// ゲームへ送る C# ソースを組み立てる共通ヘルパー。衣装・Mod ファイルの双方から使う。

/** C# の逐語的文字列としてエスケープし、コードへの入力混入を防ぐ。 */
export function csharpString(value: string): string {
  return '@"' + value.replaceAll('"', '""') + '"';
}

/** 単一の式にして REPL の永続変数や自動ラップに依存しない。 */
export function expression(body: string): string {
  return `(new System.Func<string>(() => {\n${body}\n}))()`;
}
