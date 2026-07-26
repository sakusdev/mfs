# MFS — Music From Sound

Cloudflare Workersで配信し、音声解析自体はブラウザ内のWeb Worker + Rust/WASMで行う耳コピWebアプリです。音源ファイルはサーバーへ送信しません。

## 現在の機能

- 音声ファイルのブラウザ内デコードとモノラル化
- Rust/WASMによるFFT・通常クロマ・ベースクロマ抽出
- BPM推定とビート開始位置（beat offset）推定
- 半拍単位の解析グリッド
- major / minor / 7 / maj7 / m7 / sus4 / dim 推定
- Viterbiによるコード列の時系列補正
- 各区間のコード候補上位3件
- 4/4拍子の小節・拍番号表示
- 音声再生位置とコードタイムラインの同期
- 候補ボタンまたは直接入力によるコード修正
- 小節単位のChordPro出力
- Cloudflare Workers Static Assets + `/api/*`

## 必要環境

- Node.js 20+
- Rust
- wasm-pack
- Cloudflareアカウント

## 開発

```bash
npm install
cargo install wasm-pack
npm run build:wasm
npm run dev
```

## デプロイ

```bash
npx wrangler login
npm run deploy
```

## 構成

- `src/`: React UIと解析Web Worker
- `wasm/mfs-core/`: Rust音響解析コア
- `worker/`: Cloudflare Worker API
- `wrangler.jsonc`: Workers Static Assets設定

## 次の改善候補

- 拍子推定（3/4、6/8など）
- ダウンビート専用推定による小節頭精度向上
- コード反転形とオンコード
- ノーコード区間 `N`
- 波形・スペクトログラム表示
- MusicXML / MIDI出力
