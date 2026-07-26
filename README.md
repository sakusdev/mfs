# MFS — Music From Sound

Cloudflare Workersで配信し、解析はブラウザ内のWeb Worker + Rust/WASMで完結する耳コピWebアプリです。音源ファイルはサーバーへ送信しません。

## 完成版MVPの機能

- MP3 / WAV / M4A / OGG / FLACのブラウザ内デコード
- コード解析用とメロディ解析用の2つのRust/WASMコア
- FFT、通常クロマ、ベースクロマ解析
- BPM、ビート位相、小節頭の推定
- 3/4、4/4、6/8の拍子候補比較
- 半拍単位のコードタイムライン
- major / minor / 7 / maj7 / m7 / sus4 / dim
- オンコード推定（例: `C/E`）
- Viterbiによるコード列の時系列補正
- スペクトル平坦度、調波性、音量を使った `N` 判定
- 主旋律のピッチ追跡、ノート分割、音名・MIDI番号・信頼度の出力
- 再生位置と同期する編集可能なピアノロール
- コードとメロディの直接編集、Undo / Redo
- 全コード・キー・メロディの半音／オクターブ移調
- 編集内容のLocalStorage自動保存・復元
- `.mfs.json` プロジェクト保存・再読込
- ChordProコピー・保存
- コードとメロディを含むCSV書き出し
- コードトラック＋メロディトラックの標準MIDI書き出し
- インストール可能なPWAとオフラインキャッシュ
- Cloudflare Workers Static Assets + `/api/*`
- GitHub ActionsによるRust/WASM + TypeScript + Viteの自動ビルド検証

## 操作

- `Space`: 再生・一時停止
- `←` / `→`: 5秒移動
- `Ctrl/Cmd + Z`: 元に戻す
- `Ctrl/Cmd + Shift + Z`: やり直す
- 波形、ピアノロール、コードカードをクリック: その位置へ移動
- メロディのMIDI番号を編集: 音高を修正

## 開発

必要環境はNode.js 20以降、Rust、wasm-packです。

```bash
npm install
cargo install wasm-pack
npm run build
npm run dev
```

Cloudflareのビルド環境では、`scripts/build-wasm.sh` がRustとwasm-packを必要に応じて自動導入し、2つのWASMコアをビルドします。

## デプロイ

```bash
npx wrangler login
npm run deploy
```

Cloudflare Git連携では、ビルドコマンドを `npm run build`、デプロイコマンドを `npx wrangler deploy` に設定します。

## 構成

- `src/`: React UI、ピアノロール、編集、各種エクスポート、解析Web Worker
- `wasm/mfs-core/`: コード・拍・調性解析コア
- `wasm/melody-core/`: 主旋律ピッチ追跡・ノート分割コア
- `public/`: PWAマニフェスト、アイコン、Service Worker
- `worker/`: Cloudflare Worker API
- `.github/workflows/build.yml`: 完全ビルド検証
- `wrangler.jsonc`: Workers Static Assets設定

## 現在の限界

メロディ解析は、歌声や単音楽器など音源内で比較的目立つ主旋律を抽出する軽量方式です。ボーカル・ギター・シンセなどが同時に鳴る密集したミックスでは、最も強い倍音を拾うことがあります。完全な多声部採譜ではなく、ピアノロール上で素早く直してMIDIへ持ち出すための実用MVPです。
