<div align="center">

# 🚀 Zangqing (藏青) - 모던 SSH 클라이언트에서 기대하는 모든 것

*SSH 연결을 단순하게 만드는 모든 것.*

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=000)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=fff)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-111111?style=for-the-badge)

</div>

## 미리보기

### 다크 테마

![Main workspace](./b0e89111-1d1b-4072-adea-1dd2ec06831e.png)

![Agent deployment workspace](./58beebfc-909a-4a29-adc6-6eb42f36bb50.png)

![Agent conversation and execution flow](./d2aca14d-b5f3-47c9-8428-fd41e3036f33.png)

### 라이트 테마

![Main workspace light theme](./1e403064-c046-4948-b229-202b99ed692a.png)

![Agent deployment workspace light theme](./1e44b065-2b41-4316-8d5f-157bf1323034.png)

![Agent conversation and execution flow light theme](./22174f5b-d599-4a23-a2ee-b738d1b821c7.png)

## 소개

**Zangqing (藏青)** 은 궁극의 개발 효율성을 위해 설계된 차세대 모던 초경량 SSH 클라이언트입니다. 단순한 터미널 에뮬레이터를 넘어서, AI 보조 디버깅, 네이티브 Docker 관리, 실시간 하드웨어 모니터링, 그리고 매끄러운 SFTP 파일 관리를 하나로 통합한 아름다운 크로스 플랫폼 데스크톱 애플리케이션입니다.

## 주요 기능

- `ssh2` 와 `xterm.js` 기반 멀티 세션 터미널
- 배포와 진단을 위한 Agent 작업 공간
- 내장 SFTP 파일 브라우저와 인라인 편집기
- Docker 컨테이너 관리
- CPU, 메모리, 네트워크, 디스크 원격 모니터링
- 대화와 세션 상태의 로컬 영속 저장
- Electron Builder 기반 크로스플랫폼 패키징

## 구성

### 터미널과 파일 작업

- 대화형 원격 터미널
- SFTP 트리 브라우징
- 파일 직접 편집
- 탭 기반 세션 관리

### Agent 작업 공간

- 자연어 작업 실행
- 배포 중심 워크플로
- 컨텍스트 유지와 대화 이어서 실행
- 채팅과 실행 결과 동시 표시

### 서버 관리

- Docker 매니저
- 프로세스 목록
- 시스템 모니터
- 연결 설정 저장과 재사용

## 시작하기

```bash
git clone https://github.com/Sunhaiy/sshtool.git
cd sshtool
npm install
npm run dev
```

## 빌드

```bash
npm run build
npm run dist
```

플랫폼별 빌드:

- `npm run dist:win`
- `npm run dist:mac`
- `npm run dist:linux`

## 디렉터리 구조

```text
sshtool
|- electron/            # Electron 메인 프로세스, IPC, SSH, 배포 엔진
|- src/                 # React 렌더러
|  |- components/       # Terminal, Agent, Docker, files, monitor UI
|  |- pages/            # 설정과 연결 관리
|  |- services/         # 프런트엔드 서비스
|  |- shared/           # 공통 타입과 로케일
|  `- store/            # Zustand 스토어
|- docs/                # 설계 및 문서
`- .github/workflows/   # 빌드와 릴리스
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

## 라이선스

[LICENSE](./LICENSE)를 참고하세요.
