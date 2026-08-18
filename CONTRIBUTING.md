# Contributing

This repository contains the Agent Resources Ninja VS Code extension.

## Setup

```powershell
npm ci
npm run compile
```

The extension targets the VS Code Extension API and TypeScript strict mode. Use the existing npm toolchain and keep `package-lock.json` in sync with dependency changes.

## Change Rules

- Follow existing module boundaries and prefer VS Code APIs in Extension Host code.
- Send runtime diagnostics through `src/logger.ts`; do not add direct `console` calls under `src/`.
- Keep English and Japanese package localization keys synchronized.
- Add an English/Japanese entry under `CHANGELOG.md` `Unreleased` for user-visible behavior.
- Do not change shared-store lock payloads, stale windows, or reclaim naming without coordinating the sibling extension contract.
- Load production modules in tests instead of reimplementing their behavior.
- Preserve unrelated working-tree changes and generated local resources.

## Required Checks

Run these before opening a pull request:

```powershell
npm run compile
npm run test:resources
npm test
npm audit --audit-level=moderate
```

`npm run test:resources` discovers every offline `scripts/test-*.js` file. Do not maintain a separate handwritten test list. Network-backed catalog checks are available through `npm run test:upstream` and are required for a release.

## Pull Requests

Keep changes focused and explain behavior, verification, and any remaining risk. Do not commit secrets, local paths, generated VSIX files outside `artifacts/vsix/`, or local agent/session materials.

Release maintainers must follow [docs/release-runbook.md](docs/release-runbook.md). It is the tracked source of truth for versioning, packaging, publication, and verification.
