<div align="center">

# Zangqing

**SSH ターミナル、AI ワークスペース、Docker 管理、SFTP、サーバー監視をひとつにまとめたモダンなデスクトップクライアントです。**

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=000)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=fff)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-111111?style=for-the-badge)

</div>

## プレビュー

![Main workspace](./b0e89111-1d1b-4072-adea-1dd2ec06831e.png)

![Agent deployment workspace](./58beebfc-909a-4a29-adc6-6eb42f36bb50.png)

![Agent conversation and execution flow](./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png)

## 概要

Zangqing は、実運用に必要な流れを 1 つの画面にまとめたデスクトップ SSH クライアントです。リモートターミナル、ファイル転送、Docker 操作、システム監視、AI ワークスペースを統合し、接続から調査、デプロイ、確認までを切り替えなしで進められます。

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
git clone https://github.com/Sunhaiy/sshtool.git
cd sshtool
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
sshtool
|- electron/            # Electron メインプロセス、IPC、SSH、デプロイエンジン
|- src/                 # React レンダラー
|  |- components/       # Terminal、Agent、Docker、files、monitor UI
|  |- pages/            # 設定画面と接続管理
|  |- services/         # フロントエンドサービス
|  |- shared/           # 共通型とロケール
|  `- store/            # Zustand ストア
|- docs/                # 設計メモとドキュメント
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
