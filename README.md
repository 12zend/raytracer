# Raytracer

TurboWarp を基盤に、光の振る舞いをブロックでプログラムする実験的エディター。
GUI が入口、通常の制御は JS、GPU 定義は WebGL 2 のフラグメントシェーダーで実行します。

## Repository layout

- `scratch-gui`: editor and Media interface
- `scratch-vm`: blocks, scene/media state and GPU compiler
- `scratch-render`: WebGL 2 buffer renderer
- `scratch-blocks`: block editor

各ディレクトリは元の Git 履歴・ライセンスを保持する submodule です。
ローカルの変更は各 submodule 内にコミットし、親リポジトリはそのコミットを記録します。
未公開のローカルコミットがあるため、他の環境に移す際は submodule の変更も共有してください。

映像の観察と設計判断は `docs/video-study.md` に記録します。
