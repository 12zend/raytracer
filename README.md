# Raytracer

TurboWarp を基盤に、光の振る舞いをブロックでプログラムする実験的エディター。
GUI が入口、通常の制御は JS、GPU 定義は WebGL 2 のフラグメントシェーダーで実行します。

## Repository layout

- `scratch-gui`: editor, GPU block editor and costume upload for 3D assets
- `scratch-vm`: blocks, scene assets and GPU compiler
- `scratch-render`: WebGL 2 buffer renderer
- `scratch-blocks`: block editor

各ディレクトリは元の Git 履歴・ライセンスを保持する submodule です。
ローカルの変更は各 submodule 内にコミットし、親リポジトリはそのコミットを記録します。
未公開のローカルコミットがあるため、他の環境に移す際は submodule の変更も共有してください。

映像の観察と設計判断は `docs/video-study.md` に記録します。

## Setup and checks

```bash
npm run setup   # install each submodule and fetch the pinned scratch-blocks build
npm run build   # build scratch-gui into scratch-gui/build
npm test        # BVH, optics and GPU compiler unit tests
```

ブラウザー統合テスト `tests/browser.cjs` は、ビルドを `http://127.0.0.1:8601` で配信した状態で
Playwright（`PLAYWRIGHT_MODULE` で場所を指定可）を使って実行します。

## Assets

コスチュームのアップロードボタンから、画像に加えて OBJ / FBX / GLB / PMX、VMD / VPD、MP4、
TTF / OTF / WOFF を読み込めます。画像はコスチューム、それ以外は 3D シーン用アセットとして保存されます。
モデルのテクスチャは同名のコスチュームから解決し、プロジェクト保存時にモデルへ同梱されます。

`examples/ambient-occlusion.sb3` は、初回レイ → 半球方向へ 10 サンプル → AO を GPU 定義で組んだ例です
（`node scripts/create-example.cjs` で再生成）。
