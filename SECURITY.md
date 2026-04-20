# Security Policy

## Supported Versions

Currently, only the latest `main` branch and the most recent release are supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| v1.0.x  | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Reflex very seriously.

If you discover a security vulnerability within this project, please **DO NOT** create a public issue on GitHub. 

Instead, please send an email directly to the project maintainer (or reach out via direct message on the relevant community platform).

Please include the following information in your report:
*   Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
*   Full paths of source file(s) related to the manifestation of the issue
*   The location of the affected source code (tag/branch/commit or direct URL)
*   Any special configuration required to reproduce the issue
*   Step-by-step instructions to reproduce the issue
*   Proof-of-concept or exploit code (if possible)
*   Impact of the issue, including how an attacker might exploit the issue

We will endeavor to respond to your report within 48 hours and will keep you informed of our progress towards a fix and full announcement.

## Scope

This security policy applies to:
*   The Electron Main process code (`electron/`)
*   The React Renderer process code (`src/`)
*   The SSH/Docker management logic

It does **not** apply to:
*   Vulnerabilities in upstream dependencies (e.g., Node.js, Electron, React, ssh2). These should be reported to the respective upstream projects.
*   Vulnerabilities that require physical access to the user's machine.
