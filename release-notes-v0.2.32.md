# Agent Resources Ninja v0.2.32

Release date: 2026-06-16

## Summary

This patch release adds configurable additional workspace skill discovery roots and tightens workspace skill root boundary checks.

Workspace Resources can now discover skills from `resourceNinja.additionalSkillRoots`, such as `copilot-skills/skills` and `copilot-skills/m-skills`, while keeping new installs routed to the primary Workspace Skill Directory. For compatibility with the skill-only sibling extension, `skillNinja.additionalSkillRoots` is also honored as a fallback.

The release also replaces raw prefix checks with boundary-aware workspace path matching so sibling folders such as `.github/skills-old` are not treated as installed skill roots. Settings copy and README guidance now clarify that additional roots are root directories, not glob patterns, and affect discovery plus generated instruction output only.

Ref output catalog detail remains controlled by `refCatalogFormat`.

## Changes

- Added `resourceNinja.additionalSkillRoots` for extra workspace `SKILL.md` discovery roots.
- Honored `skillNinja.additionalSkillRoots` as a sibling-extension compatibility fallback.
- Added boundary-aware skill root matching through `isSameOrChildWorkspacePath`.
- Updated README, README_ja, package NLS, manifest consistency checks, and configured-root scan policy tests.
- Updated development dependencies so `npm audit --audit-level=moderate` reports zero vulnerabilities.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-configured-root-scan-policy.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npx --yes vsce package --no-dependencies --out artifacts/vsix/agent-resources-ninja-0.2.32.vsix`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.32.vsix`
- Path: `artifacts/vsix/agent-resources-ninja-0.2.32.vsix`
- Size: 343,663 bytes
- SHA256: `6CE34569C0678A19CCC1113A284A14453E0E02B8356257B3B748B6B7D25CA2A7`
- Payload: 12 files; runtime files only (`dist/extension.js`, package metadata/NLS, README, CHANGELOG, LICENSE, icon assets, bundled resource index).
