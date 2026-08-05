# Contributing to Reflex

First off, thank you for considering contributing to Reflex! It's people like you that make Reflex such a great tool.

Below are the guidelines for contributing to this project. 

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Project Setup

To get started with development:

1.  **Fork** and clone the repository.
2.  Install dependencies: `npm install`
3.  Start the development server: `npm run dev`

This will concurrently run the Vite renderer process and the Electron main process via TypeScript compiler.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report for Reflex. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

*   **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/Sunhaiy/Reflex/issues).
*   If you're unable to find an open issue addressing the problem, open a new one. Be sure to include a **title and clear description**, as much relevant information as possible, and a **code sample** or an **executable test case** demonstrating the expected behavior that is not occurring.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for Reflex, including completely new features and minor improvements to existing functionality.

*   **Ensure the enhancement was not already suggested** by searching on GitHub under [Issues](https://github.com/Sunhaiy/Reflex/issues).
*   When creating an enhancement issue, please provide a clear and detailed explanation of the feature. Describe the current behavior and the behavior you expect to see. Consider including screenshots or mockups if applicable.

### Pull Requests

*   Fill in the required template
*   Do not include issue numbers in the PR title
*   Include screenshots and animated GIFs in your pull request whenever possible.
*   Follow the TypeScript styleguide currently configured in the project.
*   Document new code based on the Documentation Styleguide (if applicable).
*   End all files with a newline.

## Pull Request Process

1.  Create a new branch for your feature or bug fix (`git checkout -b feature/my-new-feature`).
2.  Make your changes and ensure the application still builds (`npm run build`).
3.  Commit your changes using descriptive commit messages.
4.  Push to the branch (`git push origin feature/my-new-feature`).
5.  Open a Pull Request against the `main` branch.

## Publishing a release

1. Update the version in `package.json` and `package-lock.json`.
2. Merge the release commit into `main`.
3. Create and push the matching tag, for example `git tag v1.0.16 && git push origin v1.0.16`.

The release workflow builds every operating system and publishes the installers together
with `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, blockmaps, and the macOS ZIP files
used by the in-app updater. Do not rename or remove those generated metadata files.

Windows NSIS and Linux AppImage builds update automatically. A macOS build must be signed
with an Apple Developer ID certificate before macOS permits it to replace itself. Configure
these GitHub Actions secrets to enable signed macOS updates:

- `MAC_CERTIFICATE` — the Developer ID Application certificate accepted by electron-builder's `CSC_LINK`.
- `MAC_CERTIFICATE_PASSWORD` — the certificate password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` — optional notarization credentials.

Without the certificate, the workflow still publishes a usable DMG. Reflex detects the
unsigned build and directs Intel users to the `mac-x64.dmg` asset and Apple silicon users
to the `mac-arm64.dmg` asset instead of attempting an update macOS will reject.

Thank you again for your interest in contributing!
