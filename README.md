# Raytracer

TurboWarp を基盤に、光の振る舞いをブロックでプログラムする実験的エディター。
GUI が入口、通常の制御は JS、GPU 定義は WebGL 2 のフラグメントシェーダーで実行します。

## Repository layout

- `scratch-gui`: editor, GPU block editor and costume upload for 3D assets
- `scratch-vm`: blocks, scene assets and GPU compiler
- `scratch-render`: WebGL 2 buffer renderer
- `scratch-blocks`: block editor

4 つのディレクトリは TurboWarp の各リポジトリを取り込んだ通常のディレクトリで、
変更はこのリポジトリに直接コミットします（各ディレクトリのライセンスはそのまま有効です）。
取り込み元の上流コミットは `chore(workspace): vendor TurboWarp sources as plain directories`
のコミットメッセージに記録しています。上流の更新を取り込むときは、そのコミットとの差分を
パッチとして適用してください。

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

## GPU blocks

「Make a GPU block」で作ったブロックの中身は、ピクセルごとに GPU（GLSL）で実行されます。
Scratch のブロックはできるだけ CPU と同じ意味で動きます。

- 数値・テキスト・真偽値は Scratch と同じように変換されます。ベクトルが必要な所に数値を入れると全成分がその値になります（`get ray` の origin に `0` → `(0, 0, 0)`）。
- 変数は、呼び出し時の CPU の値（数値・ベクトル・レイの結果）から始まります。テキストの変数は定数として埋め込まれ、値が変わると再コンパイルされます。GPU 内での変更は CPU に戻りません。
- リストは数値として読めます。GPU ブロックが変更するリストは 1 ピクセルごとのコピー（最大 1024 項目）で、変更は CPU に戻りません。
- 演算・制御（繰り返し / 条件 / 止める）・カスタムブロック（再帰以外）が使えます。入力された値の計算は Scratch の演算ブロックでそのまま求めます。
- 調べる・動き・見た目・音のレポーターは、呼び出しごとに CPU で 1 回読んだ値が全ピクセルに渡されます。
- スプライトやステージを変えるブロック（動き・見た目・音・ペン・イベントなど）はエラーになります。「待つ」は何もしません。

## License

このリポジトリ全体は GNU General Public License v3.0 で配布します（[LICENSE](LICENSE)）。

取り込んだ TurboWarp のディレクトリは、それぞれのライセンスも引き続き有効です。

- `scratch-gui`, `scratch-blocks`: GPL-3.0
- `scratch-vm`, `scratch-render`: MPL-2.0（GPL と組み合わせ可能。これらのファイルを変更した部分は MPL-2.0 のまま公開します）
