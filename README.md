# MFS — Music From Sound

Cloudflare Workersで配信し、音声解析自体はブラウザ内のWeb Worker + Rust/WASMで行う耳コピWebアプリです。音源ファイルはサーバーへ送信しません。

## 現在の機能

- 音声ファイルのブラウザ内デコード
- ステレオ音源のモノラル化
- Rust/WASMによるFFT・クロマ抽出
- BPM推定と半拍単位の解析グリッド
- 通常クロマと低域専用ベースクロマ
- major / minor / 7 / maj7 / m7 / sus4 / dimのコード候補
- コード維持・共通音・五度進行を考慮したViterbi時系列補正
- 同一コード区間の自動結合
- キー推定
- 音源プレイヤーと連動するコードタイムライン
- コード名の手動修正
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

## 解析パイプライン

1. Web Audio APIで音声をデコードしてモノラル化
2. オンセット包絡の自己相関からBPMを推定
3. 半拍ごとにFFTを実行
4. 45–5000 Hzから通常クロマ、45–260 Hzからベースクロマを生成
5. 各コード候補の観測スコアを計算
6. 前後のコード維持、共通音、五度・二度進行を考慮してViterbi復号
7. 連続する同一コードを一つの区間に結合
8. UI上で音源を聴きながら修正し、ChordProとして出力

## 今後の候補

- 拍の開始位置を推定するビート位相検出
- 小節線と拍番号の表示
- コード候補上位3件の選択UI
- MIDI / MusicXML出力
- オンセットに合わせた可変長セグメント
- WebGPU対応の音源分離を任意機能として追加
