# MFS — Music From Sound

Cloudflare Workersで配信し、解析はブラウザ内のWeb Worker + Rust/WASMで完結する耳コピWebアプリです。音源ファイルはサーバーへ送信しません。

## 完成版MVPの機能

- MP3 / WAV / M4A / OGG / FLACのブラウザ内デコード
- Rust/WASMによるFFT、通常クロマ、ベースクロマ解析
- BPM、ビート位相、小節頭の推定
- 3/4、4/4、6/8の拍子候補比較
- 半拍単位のコードタイムライン
- major / minor / 7 / maj7 / m7 / sus4 / dim
- オンコード推定（例: `C/E`）
- Viterbiによるコード列の時系列補正
- スペクトル平坦度、調波性、音量を使った `N` 判定
- 候補上位3件と手動 `N` 指定
- 再生位置と連動するクリック可能な波形
- コード直接編集、候補選択、Undo / Redo
- 全コードとキーの半音・オクターブ移調
- 編集内容のLocalStorage自動保存・復元
- `.mfs.json` プロジェクト保存・再読込
- ChordProコピー・保存
- CSV書き出し
- 標準MIDIファイル書き出し
- インストール可能なPWAとオフラインキャッシュ
- Cloudflare Workers Static Assets + `/api/*`
- GitHub ActionsによるRust/WASM + TypeScript + Viteの自動ビルド検証

## 操作

- `Space`: 再生・一時停止
- `←` / `→`: 5秒移動
- `Ctrl/Cmd + Z`: 元に戻す
- `Ctrl/Cmd + Shift + Z`: やり直す
- 波形またはコードカードをクリック: その位置へ移動

## 開発

必要環境はNode.js 20以降、Rust、wasm-packです。

```bash
npm install
cargo install wasm-pack
npm run build
npm run dev
```

Cloudflareのビルド環境では、`scripts/build-wasm.sh` がRustとwasm-packを必要に応じて自動導入します。

## デプロイ

```bash
npx wrangler login
npm run deploy
```

Cloudflare Git連携では、ビルドコマンドを `npm run build`、デプロイコマンドを `npx wrangler deploy` に設定します。

## 構成

- `src/`: React UI、編集、各種エクスポート、解析Web Worker
- `wasm/mfs-core/`: Rust音響解析コア
- `public/`: PWAマニフェスト、アイコン、Service Worker
- `worker/`: Cloudflare Worker API
- `.github/workflows/build.yml`: 完全ビルド検証
- `wrangler.jsonc`: Workers Static Assets設定

## 現在の限界

これは実用可能な軽量MVPであり、商用採譜エンジン相当の完全自動採譜ではありません。密集したオーケストレーション、転調の多い曲、調律が大きく外れた録音、テンポが自由に揺れる演奏では手動修正が必要です。解析結果を候補と波形で素早く直せる設計にしています。
