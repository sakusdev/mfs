# MFS — Music From Sound

Cloudflare Workersで配信し、音声解析自体はブラウザ内のWeb Worker + Rust/WASMで行う耳コピWebアプリです。音源ファイルはサーバーへ送信しません。

## 現在の機能

- 音声ファイルのブラウザ内デコードとモノラル化
- Rust/WASMによるFFT・通常クロマ・ベースクロマ抽出
- BPM推定とビート位相推定
- 3/4・4/4・6/8の拍子候補比較
- 小節頭（ダウンビート）推定
- 半拍単位の解析グリッド
- major / minor / 7 / maj7 / m7 / sus4 / dim 推定
- 低音がコード構成音の場合のオンコード推定（例: `C/E`）
- Viterbiによるコード列の時系列補正
- 各区間のコード候補上位3件
- 音量とコード信頼度を使ったノーコード区間 `N` の暫定判定
- 推定拍子に基づく小節・拍番号表示
- 音声再生位置とコードタイムラインの同期
- クリックでシークできる波形表示
- 候補ボタンまたは直接入力によるコード修正
- 小節単位のChordPro出力
- `.mfs.json` 形式で解析結果の保存・再読み込み
- Cloudflare Workers Static Assets + `/api/*`

## 必要環境

- Node.js 20+
- Rust
- wasm-pack
- Cloudflareアカウント

Cloudflareのビルド環境では、`scripts/build-wasm.sh` がRustとwasm-packを必要に応じて自動導入します。

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

- `N`判定をスペクトル平坦度・調波性で強化
- ダウンビート推定の信頼度改善
- 6/8での複合拍テンポ表示
- スペクトログラム表示
- MusicXML / MIDI出力
- テスト用の合成音源と自動精度評価
