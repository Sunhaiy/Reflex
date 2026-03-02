<div align="center">

# 🚀 Zangqing (藏青) - 차세대 스마트 SSH & Docker 매니저
*Electron 및 React로 구축된 모던하고 AI가 탑재된 경량 크로스 플랫폼 SSH 터미널입니다.*

[🇬🇧 English](./README.md) | [🇨🇳 简体中文](./README.zh-CN.md) | [🇯🇵 日本語](./README.ja.md) | [🇰🇷 한국어](./README.ko.md)

![React](https://img.shields.io/badge/React-18.2.0-blue?style=for-the-badge&logo=react)
![Electron](https://img.shields.io/badge/Electron-29.1.0-47848F?style=for-the-badge&logo=electron)
![Vite](https://img.shields.io/badge/Vite-5.1.0-646CFF?style=for-the-badge&logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6?style=for-the-badge&logo=typescript)

</div>

---

### 🌟 소개
**Zangqing (藏青)** 은 궁극의 개발 효율성을 위해 설계된 차세대 모던 초경량 SSH 클라이언트입니다. 단순한 터미널 에뮬레이터를 넘어서, AI 보조 디버깅, 네이티브 Docker 관리, 실시간 하드웨어 모니터링, 그리고 매끄러운 SFTP 파일 관리를 하나로 통합한 아름다운 크로스 플랫폼 데스크탑 애플리케이션입니다.

### 🛠️ 기술 스택 및 라이브러리
*   **핵심 프레임워크**: React 18, Electron 29
*   **빌드 도구**: Vite 5
*   **언어**: TypeScript 5.3
*   **스타일링 및 UI**: Tailwind CSS, `lucide-react` (아이콘)
*   **터미널 엔진**: `xterm.js` (`@xterm/xterm` + WebGL/Fit 애드온)
*   **SSH 프로토콜 핵심**: `ssh2`
*   **상태 관리**: `zustand`
*   **데이터 시각화**: `recharts` (시스템 모니터링 대시보드)
*   **코드 에디터**: `monaco-editor` (`@monaco-editor/react`)
*   **로컬 저장소**: `electron-store`

### ✨ 주요 기능
*   🤖 **AI 어시스턴트 및 디버거**: 코드 디버깅과 터미널 명령어 작성을 돕는 내장 AI 채팅 패널 및 명령어 생성기.
*   🐋 **직관적인 Docker 관리**: 터미널 명령어 없이 UI에서 직접 Docker 컨테이너를 시작, 중지, 재시작하고 모니터링할 수 있습니다.
*   💻 **강력한 터미널 에뮬레이터**: WebGL 렌더링, 사용자 정의 색상, 크기 조절 등을 지원하는 모든 기능을 갖춘 Xterm.js 기반 터미널.
*   📊 **실시간 시스템 모니터링**: 대상 서버의 CPU, 메모리, 디스크 및 네트워크 트래픽을 한눈에 확인할 수 있는 시각적 대시보드(Recharts 기반).
*   📁 **시각적 파일 및 프로세스 관리자**: 내장 SFTP 파일 브라우저, 인라인 파일 편집기, 시스템 프로세스 목록 시각화.
*   🎨 **세련되고 모던한 UI**: Tailwind CSS를 사용해 생산성에 맞춰 설계된 드래그 앤 드롭 크기 조절 가능한 반응형 레이아웃.
*   🌐 **크로스 플랫폼**: Windows, macOS, Linux를 모두 완벽하게 지원합니다.

### 📂 디렉토리 구조
```text
📦 sshtool
 ┣ 📂 electron           # Electron 메인 프로세스
 ┃ ┣ 📂 ssh              # SSH 연결 및 터미널 로직
 ┃ ┣ 📜 main.ts          # 애플리케이션 시작점
 ┃ ┣ 📜 preload.ts       # IPC 통신 브릿지
 ┃ ┗ 📜 ipcHandlers.ts   # 프로세스 간 통신 (IPC)
 ┣ 📂 src                # React 프론트엔드
 ┃ ┣ 📂 components       # UI 컴포넌트(AI, Docker, 터미널 등)
 ┃ ┣ 📂 store            # Zustand 상태 관리
 ┃ ┗ ...
 ┣ 📜 package.json       # 프로젝트 의존성 및 스크립트
 ┗ 📜 vite.config.ts     # Vite 빌드 설정
```

### 🚀 시작하기
```bash
# 1. 레포지토리 클론
git clone https://github.com/yourusername/sshtool.git
cd sshtool

# 2. 의존성 패키지 설치
npm install

# 3. 개발 서버 실행
npm run dev

# 4. 프로덕션 빌드
npm run dist
```

---

<div align="center">
  <p>Built with ❤️ by passionate developers.</p>
  <p>License: MIT</p>
</div>
