# Agent Resources Ninja v0.2.15

Release date: 2026-05-13

## Summary

This patch release removes false index-missing warnings for local-only installed skills, consolidates bug-report URL handling, clarifies one-shot build logs, and makes the managed-block reset wording match the command's real behavior.

## Changes

- Fixed startup and bulk reinstall checks so local-only skills without remote install metadata are no longer treated as missing from the bundled index.
- Consolidated GitHub Issue URL generation and browser launch into a shared bug-report helper used by command and installer recovery flows.
- Changed one-shot esbuild logging to use `[build]` instead of `[watch]`.
- Renamed cleanup wording to describe managed-block removal accurately and documented the safe reset flow in README / README_ja and coexistence fixture docs.

## Verification

- `npx --yes vsce show yamapan.agent-resources-ninja --json`: PASS, latest Marketplace version is 0.2.14 before v0.2.15 prep
- `git ls-remote --tags origin v0.2.15`: PASS, remote tag `v0.2.15` does not exist before release prep
- `gh release view v0.2.15 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, GitHub Release `v0.2.15` does not exist before release prep
- `npm run check-types`: PASS
- `npm run lint`: PASS
- `node esbuild.js --production`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-coexistence.js`: PASS
- `node scripts/test-installed-skill-index-check.js`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npm test`: FAIL, local `.vscode-test` host aborted with `Code is currently being updated. Please wait for the update to complete before launching.` on VS Code `1.119.1`; static regression guards above were used as the mechanical fallback
- `npm run package`: PASS
- `npx --yes vsce package --no-dependencies`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.15.vsix --force`: PASS
- `git diff --check`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.15.vsix`
- Size: `307,239 bytes`
- SHA256: `36E023AA17433706012B44C99FCD41788675B0628FBEA0A3E0A32BEBC0C08763`