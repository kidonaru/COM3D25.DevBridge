// plugin を Debug ビルドして COM3D2.5 の BepInEx plugins へ配備する（dev 用）。
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  artifactDlls,
  buildOutputDir,
  buildPlugin,
  resolveGameDir,
  runMain,
} from './plugin-common.mjs';

const configuration = 'Debug';

runMain(() => {
  const gameDir = resolveGameDir();

  buildPlugin(configuration, gameDir);

  const outDir = buildOutputDir(configuration);
  const destDir = resolve(gameDir, 'BepInEx/plugins/COM3D25.DevBridge');
  mkdirSync(destDir, { recursive: true });
  for (const dll of artifactDlls) {
    try {
      copyFileSync(join(outDir, dll), join(destDir, dll));
    } catch (err) {
      // ゲーム起動中は plugin DLL がロードされたままでコピーできない
      throw new Error(
        `${dll} の配備に失敗しました: ${err.message}\n` +
          'COM3D2.5 が起動中の可能性があります。ゲームを終了してから再実行してください。',
      );
    }
  }

  console.log(`配備完了: ${destDir}`);
});
