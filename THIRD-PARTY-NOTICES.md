# Third-Party Notices

COM3D25.DevBridge は次のサードパーティ製ソフトウェアを同梱して配布しています。

- BepInEx プラグイン（Releases の zip と `plugin/lib/`）: Mono.CSharp.dll（下記）
- MCP サーバーのバンドル（`agent-plugin/dist/server.mjs`）: npm パッケージ。
  一覧とライセンス文は [agent-plugin/dist/THIRD-PARTY-NOTICES.txt](agent-plugin/dist/THIRD-PARTY-NOTICES.txt)（`npm run bundle` が生成）

## Mono.CSharp.dll

- 配布元: Unity 2022.3.62f2 エディタ同梱の MonoBleedingEdge（https://github.com/Unity-Technologies/mono）
- 元のプロジェクト: Mono（https://github.com/mono/mono）
- ライセンス: MIT License
  - コンパイラ（mcs）のソースは MIT X11 と GNU GPL のデュアルライセンスで、本リポジトリは MIT を選択して再配布する
  - 著作権表示は mcs のソースヘッダ（`mcs/mcs/driver.cs`）から、許諾文は Mono の `LICENSE` にある MIT License の本文から引用

```
Copyright 2001, 2002, 2003 Ximian, Inc (http://www.ximian.com)
Copyright 2004, 2005, 2006, 2007, 2008 Novell, Inc
Copyright 2011 Xamarin Inc

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
