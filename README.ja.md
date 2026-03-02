<div align="center">

# 🚀 Zangqing (藏青) - 次世代スマートSSH & Dockerマネージャー
*ElectronとReactで構築された、モダンでAIを搭載した軽量クロスプラットフォームSSHターミナルです。*

[🇬🇧 English](./README.md) | [🇨🇳 简体中文](./README.zh-CN.md) | [🇯🇵 日本語](./README.ja.md) | [🇰🇷 한국어](./README.ko.md)

![React](https://img.shields.io/badge/React-18.2.0-blue?style=for-the-badge&logo=react)
![Electron](https://img.shields.io/badge/Electron-29.1.0-47848F?style=for-the-badge&logo=electron)
![Vite](https://img.shields.io/badge/Vite-5.1.0-646CFF?style=for-the-badge&logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6?style=for-the-badge&logo=typescript)

</div>

---

### 🌟 はじめに
**Zangqing (藏青)** は、究極の開発効率を追求して設計された、次世代のモダンで軽量なSSHクライアントです。単なるターミナルエミュレーターの枠を超え、AI支援デバッグ、ネイティブのDocker管理機能、リアルタイムのリソースモニタリング、およびシームレスなSFTPファイル管理を、一つの美しいクロスプラットフォームなデスクトップアプリに統合しています。

### 🛠️ 技術スタックとライブラリ
*   **コアフレームワーク**: React 18, Electron 29
*   **ビルドツール**: Vite 5
*   **言語**: TypeScript 5.3
*   **スタイリング＆UI**: Tailwind CSS, `lucide-react` (アイコン)
*   **ターミナルエンジン**: `xterm.js` (`@xterm/xterm` + WebGL/Fit アドオン)
*   **SSH プロトコルコア**: `ssh2`
*   **ステート管理**: `zustand`
*   **データ可視化**: `recharts` (システム監視ダッシュボード)
*   **コードエディタ**: `monaco-editor` (`@monaco-editor/react`)
*   **ローカルストレージ**: `electron-store`

### ✨ 主な機能
*   🤖 **AIアシスタント＆デバッグ機能**: AIチャットパネルとAIコマンド生成機能を内蔵しており、コードのデバッグやコマンド入力を強力にサポート。
*   🐋 **ネイティブDocker管理**: UI上から直接Dockerコンテナの起動、停止、再起動、監視がワンクリックで可能。
*   💻 **強力なターミナルエミュレーター**: WebGLレンダリングに対応した、カスタマイズ可能なフル機能のXterm.jsターミナル。
*   📊 **リアルタイム・システムモニタリング**: リモートサーバーのCPU、メモリ、ディスク、ネットワークのトラフィックを視覚的に表示（Recharts採用）。
*   📁 **ビジュアルファイル＆プロセス管理**: 内蔵SFTPブラウザ、インラインのファイルエディタ、および視覚的なプロセスリスト管理。
*   🎨 **モダンで洗練されたUI**: ドラッグ＆ドロップでサイズ変更可能なレスポンシブデザイン。Tailwind CSSを採用。
*   🌐 **クロスプラットフォーム対応**: Windows、macOS、Linuxでシームレスに動作。

### 📂 フォルダ構成
```text
📦 sshtool
 ┣ 📂 electron           # Electronメインプロセス
 ┃ ┣ 📂 ssh              # SSH通信およびターミナルのロジック
 ┃ ┣ 📜 main.ts          # アプリケーションのエントリーポイント
 ┃ ┣ 📜 preload.ts       # IPC通信のブリッジ
 ┃ ┗ 📜 ipcHandlers.ts   # プロセス間通信（IPC）
 ┣ 📂 src                # Reactフロントエンド
 ┃ ┣ 📂 components       # UIコンポーネント（AIチャット、Docker管理など）
 ┃ ┣ 📂 store            # Zustandステート管理
 ┃ ┗ ...                 
 ┣ 📜 package.json       # パッケージとスクリプト
 ┗ 📜 vite.config.ts     # Viteビルド構成
```

### 🚀 利用方法
```bash
# 1. リポジトリのクローン
git clone https://github.com/yourusername/sshtool.git
cd sshtool

# 2. 依存関係のインストール
npm install

# 3. 開発サーバーの起動
npm run dev

# 4. プロダクション用ビルド
npm run dist
```

---

<div align="center">
  <p>Built with ❤️ by passionate developers.</p>
  <p>License: MIT</p>
</div>
