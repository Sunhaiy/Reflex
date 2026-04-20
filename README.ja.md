<div align="center">

# 🚀 Reflex - 現代の SSH クライアントに期待するすべて

*SSH 接続をシンプルにするすべて。*

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=000)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=fff)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-111111?style=for-the-badge)

</div>

## プレビュー

### ダークテーマ

![Main workspace](https://raw.githubusercontent.com/Sunhaiy/Reflex/main/b0e89111-1d1b-4072-adea-1dd2ec06831e.png)

![Agent deployment workspace](https://raw.githubusercontent.com/Sunhaiy/Reflex/main/58beebfc-909a-4a29-adc6-6eb42f36bb50.png)

![Agent conversation and execution flow](https://raw.githubusercontent.com/Sunhaiy/Reflex/main/d2aca14d-b5f3-47c9-8428-fd41e3036f33.png)

### ライトテーマ

![Main workspace light theme](https://raw.githubusercontent.com/Sunhaiy/Reflex/main/1e403064-c046-4948-b229-202b99ed692a.png)

![Agent deployment workspace light theme](https://raw.githubusercontent.com/Sunhaiy/Reflex/main/1e44b065-2b41-4316-8d5f-157bf1323034.png)

![Agent conversation and execution flow light theme](https://raw.githubusercontent.com/Sunhaiy/Reflex/main/22174f5b-d599-4a23-a2ee-b738d1b821c7.png)

## はじめに

**Reflex** は、究極の開発効率を追求して設計された、次世代のモダンで軽量な SSH クライアントです。単なるターミナルエミュレーターの枠を超え、AI 支援デバッグ、ネイティブの Docker 管理機能、リアルタイムのリソースモニタリング、およびシームレスな SFTP ファイル管理を、一つの美しいクロスプラットフォームなデスクトップアプリに統合しています。

## 主な機能

- `ssh2` と `xterm.js` を使ったマルチセッション端末
- デプロイと診断に特化した Agent ワークスペース
- SFTP ファイルブラウザとインラインエディタ
- Docker コンテナ管理
- CPU、メモリ、ネットワーク、ディスクのリモート監視
- 会話履歴とセッション状態のローカル保存
- Electron Builder によるクロスプラットフォーム配布

## 機能構成

### ターミナルとファイル操作

- 対話式リモートターミナル
- SFTP ツリー表示
- ファイルの直接編集
- タブ型セッション管理

### Agent ワークスペース

- 自然言語によるタスク実行
- デプロイ向けワークフロー
- コンテキスト保持と会話再開
- チャットと実行結果の並列表示

### サーバー管理

- Docker マネージャー
- プロセス一覧
- システムモニター
- 接続設定の保存と再利用

## はじめに

```bash
git clone https://github.com/Sunhaiy/Reflex.git
cd reflex
npm install
npm run dev
```

## ビルド

```bash
npm run build
npm run dist
```

プラットフォーム別ビルド:

- `npm run dist:win`
- `npm run dist:mac`
- `npm run dist:linux`

## ディレクトリ構成

```text
reflex
|- electron/            # Electron メインプロセス、IPC、SSH、デプロイエンジン
|- src/                 # React レンダラー
|  |- components/       # Terminal、Agent、Docker、files、monitor UI
|  |- pages/            # 設定画面と接続管理
|  |- services/         # フロントエンドサービス
|  |- shared/           # 共通型とロケール
|  `- store/            # Zustand ストア
`- .github/workflows/   # ビルドとリリース
```

## 技術スタック

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- xterm.js
- ssh2
- Monaco Editor
- Recharts

## ライセンス

[LICENSE](./LICENSE) を参照してください。
