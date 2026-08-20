<div align="center">
  <a href="https://github.com/Sunhaiy/Reflex">
    <img src="./logo.png" alt="Reflex" height="72" />
  </a>

  <h1>Reflex</h1>

  <p>
    멀티 세션 터미널, SFTP, Docker, 모니터링, 배포 자동화, AI 지원 서버 작업을 하나의 데스크톱 앱에서 다룹니다.
  </p>

  <p>
    <a href="./README.md">English</a>
    |
    <a href="./README.zh-CN.md">简体中文</a>
    |
    <a href="./README.ja.md">日本語</a>
    |
    <a href="./README.ko.md">한국어</a>
  </p>

  <p>
    <a href="https://github.com/Sunhaiy/Reflex/actions/workflows/build-release.yml">
      <img alt="Build" src="https://github.com/Sunhaiy/Reflex/actions/workflows/build-release.yml/badge.svg" />
    </a>
    <a href="./LICENSE">
      <img alt="License" src="https://img.shields.io/badge/license-custom-111111?logo=opensourceinitiative" />
    </a>
    <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111111" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
    <img alt="Platforms" src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-0f766e" />
  </p>

  <p>
    <sub>
      원격 서버를 더 로컬처럼, 더 관찰 가능하게, 더 쉽게 복구하고 싶은 개발자를 위해 만들었습니다.
    </sub>
  </p>
</div>

---

<div align="center">
  <a href="https://github.com/Sunhaiy/Reflex">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshots/ko/workspace-real.png" />
      <source media="(prefers-color-scheme: light)" srcset="./docs/screenshots/ko/workspace-real.png" />
      <img alt="Reflex SSH 워크스페이스" src="./docs/screenshots/ko/workspace-real.png" width="100%" />
    </picture>
  </a>
</div>

## 개요

**Reflex**는 실제 서버 작업 흐름을 중심으로 설계된 크로스 플랫폼 SSH 데스크톱 클라이언트입니다. 연결, 점검, 편집, 배포, 복구, 그리고 컨텍스트를 잃지 않는 작업 재개를 한곳에서 처리합니다.

정돈된 터미널 워크스페이스, 실용적인 인프라 도구, Agent 모드를 결합했습니다. Agent는 서버 작업을 계획하고, 명령을 실행하고, 출력을 확인하고, 일시적인 실패에는 재시도하며, 실행 과정을 눈에 보이게 남깁니다.

## 제품 둘러보기

<p align="center">
  <img alt="Reflex Agent 워크스페이스" src="./docs/screenshots/ko/agent.png" width="100%" />
</p>
<p align="center">
  <b>Agent</b><br />도구 단계, 명령, 결과, 스트리밍 응답을 모두 표시합니다.
</p>

<p align="center">
  <img alt="Reflex Docker 워크스페이스" src="./docs/screenshots/ko/docker.png" width="100%" />
</p>
<p align="center">
  <b>Docker</b><br />컨테이너, 이미지, 포트, 로그, 수명 주기 작업을 관리합니다.
</p>

<p align="center">
  <img alt="Reflex 연결 로딩 애니메이션" src="./docs/media/ko/connection.gif" width="100%" />
</p>
<p align="center">
  <b>연결 흐름</b><br />SSH 연결, 터미널, 파일 트리, 모니터링이 준비된 워크스페이스로 로드됩니다.
</p>

<p align="center">
  <img alt="Reflex Agent 상호작용 애니메이션" src="./docs/media/ko/agent.gif" width="100%" />
</p>
<p align="center">
  <b>Agent 흐름</b><br />프롬프트, 도구 타임라인, 터미널 출력, 스트리밍 답변을 연속으로 보여줍니다.
</p>

<p align="center">
  <img alt="Reflex 외관 설정" src="./docs/screenshots/ko/appearance-settings.png" width="100%" />
</p>
<p align="center">
  <b>외관</b>: 테마, 강조 색상, 모서리, 글꼴.
</p>

<p align="center">
  <img alt="Reflex 터미널 설정" src="./docs/screenshots/ko/terminal-settings.png" width="100%" />
</p>
<p align="center">
  <b>터미널</b>: 렌더링, 커서, 타이포그래피, 스크롤백.
</p>

<p align="center">
  <img alt="Reflex 앱 설정" src="./docs/screenshots/ko/application-settings.png" width="100%" />
</p>

## Reflex를 선택하는 이유

- **원격 작업을 위한 하나의 공간:** 터미널, 파일, Docker, 모니터링, AI 액션을 나란히 사용할 수 있습니다.
- **Agent 네이티브 실행:** 목표를 말하면 계획, 명령, 진행 상황, 검증 단계가 이어집니다.
- **로컬 우선 설정:** 연결 프로필, AI 설정, 테마, 세션 기록은 로컬에 저장됩니다.
- **재개 가능한 세션:** 서버를 전환하거나 앱을 다시 열어도 Agent 대화와 작업 상태를 복원할 수 있습니다.
- **데스크톱 패키징:** Electron Builder와 GitHub Actions로 Windows, macOS, Linux 빌드를 제공합니다.

## 기능

### Terminal And SSH

- 터미널 상태를 유지하는 멀티 세션 SSH 탭
- 비밀번호와 개인 키 인증
- 재연결을 고려한 명령 실행
- 인라인 AI 명령 생성과 선택한 출력에 대한 액션
- 여러 프리셋을 가진 테마형 터미널 렌더링

### Agent Workspace

- 자연어로 서버 운영 작업 실행
- 장기 작업 계획, 진행률, 재시도 상태 표시
- 로컬 명령, 원격 명령, 업로드, 파일 쓰기, 도구 결과 실행 카드
- 로컬 폴더와 GitHub 프로젝트를 위한 배포 워크플로
- 이전 작업을 계속할 수 있는 세션 기록

### Files And Deployment

- SFTP 파일 브라우저와 원격 파일 편집
- 업로드, 다운로드, 이름 변경, 삭제, 디렉터리 생성
- 배포 흐름을 위한 프로젝트 패키징
- 원격 Nginx / 정적 사이트 배포 지원
- GitHub 프로젝트 소스 해석과 서버 측 준비

### Server Management

- CPU, 메모리, 디스크, 네트워크 실시간 모니터링
- 프로세스 목록과 종료 액션
- Docker 컨테이너, 이미지, 로그, 정리 제어
- 서버 프로필 검색, 복사, 편집, 삭제, 빠른 연결

### Customization

- 라이트, 다크, 블랙, 사이버펑크, 사용자 지정 강조 색상 테마
- UI 및 터미널 폰트 설정
- 여러 AI 제공자 프로필
- 하나의 제공자 엔드포인트에서 여러 모델 선택
- 현지화된 인터페이스 옵션

## 빠른 시작

Node.js `>=22.12.0`이 필요하며 Node.js 24를 권장합니다.

```bash
git clone https://github.com/Sunhaiy/Reflex.git
cd Reflex
npm ci
npm run dev
```

## 빌드

```bash
npm run build
npm run dist
```

플랫폼별 패키징:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## 프로젝트 구조

```text
reflex
|- electron/            # Electron main process, IPC, SSH, deploy engine, agent runtime
|- src/                 # React renderer source
|  |- components/       # Terminal, Agent, Docker, files, monitor UI
|  |- pages/            # Settings and connection management
|  |- services/         # Frontend AI and app services
|  |- shared/           # Shared types, themes, locales, prompts
|  `- store/            # Zustand stores
`- .github/workflows/   # Build and release automation
```

## 기술 스택

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

## 기여

기여를 환영합니다. issue나 pull request를 열기 전에 [CONTRIBUTING](./CONTRIBUTING.md)과 [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md)를 확인해 주세요.

## 보안

보안 문제를 발견했다면 [SECURITY](./SECURITY.md)의 절차를 따라 주세요.

## 라이선스

[LICENSE](./LICENSE)를 확인해 주세요.
