// MCP サーバーが initialize で名乗るバージョン。package.json はバンドル配布時に同梱されず
// 実行時に読めないため定数で持ち、`npm run plugin:bump` が他の version と一緒に書き換える。
export const SERVER_VERSION = "0.6.1";
