<div align="center">
  <a href="https://github.com/Sunhaiy/Reflex">
    <img src="./public/logo.png" alt="Reflex" width="88" />
  </a>

  # Reflex

  **A lightweight desktop SSH workspace.**

  Terminal, SFTP files, process monitoring, and Docker management in one focused app.
</div>

![Reflex workspace](./9cb6011b-c5a7-47ff-8544-9d40f0baf3b5.png)

## Features

- Multiple SSH connections and terminal sessions
- Password, private-key, and jump-host authentication
- SFTP browsing, upload, download, rename, edit, and delete
- Process list and system resource monitoring
- Docker containers, images, logs, shell access, and cleanup
- Custom themes, fonts, terminal rendering, and reconnect behavior
- Local connection and preference storage
- Windows, macOS, and Linux desktop builds

Reflex intentionally keeps remote work direct, predictable, and focused.

## Development

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/Sunhaiy/Reflex.git
cd Reflex
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```

Package the desktop application:

```bash
npm run dist
```

## Project structure

```text
electron/       Electron main process, IPC, SSH, SFTP, monitoring, and Docker
src/            React renderer and desktop UI
public/         Application icons and static assets
.github/        Build and release workflows
```

## Tech stack

- Electron
- React and TypeScript
- Vite
- Tailwind CSS
- xterm.js
- ssh2

## License

[MIT](./LICENSE)
