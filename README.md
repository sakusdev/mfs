# MFS — Music From Sound

Cloudflare Workersで配信し、音声解析自体はブラウザ内のWeb Worker + Rust/WASMで行う耳コピWebアプリです。音源ファイルはサーバーへ送信しません。

## 現在の機能

- 音声ファイルのブラウザ内デコード
- モノラル化
- Rust/WASMによるFFT・クロマ抽出
- 暫定BPM推定
- 暫定キー推定
- 2秒単位のコード候補
- ChordPro出力
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

## 注意

現在のコード推定は最初の実用プロトタイプです。今後、拍同期、オンセット検出、Viterbi補正、ベースクロマ、コード編集タイムラインを追加する想定です。
