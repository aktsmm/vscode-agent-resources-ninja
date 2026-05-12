# Agent Resources Ninja v0.2.14

Release date: 2026-05-13

## Summary

This patch release makes generated instruction blocks even thinner by default, changing workspace agent listing to opt-in while clarifying in Settings UI what gets added to files such as `AGENTS.md`.

## Changes

- Changed `resourceNinja.instructionBlock.includeAgents` to default to off, so generated instruction blocks list only mandatory `skill` entries unless agents are explicitly enabled.
- Clarified Settings UI copy so instruction-block settings explain that they add `agent` or `instruction` resources to generated instruction blocks such as `AGENTS.md`.
- Kept `skill` mandatory and left prompts, hooks, MCP configs, plugins, and Cursor rules in their native views.
- Updated README / README_ja, coexistence fixtures, and manifest consistency guards to match the thinner default policy.

## Verification

- `npx --yes vsce show yamapan.agent-resources-ninja --json`: PASS, latest Marketplace version is 0.2.13 before v0.2.14 prep
- `git ls-remote --tags origin`: PASS, remote tag `v0.2.14` does not exist before release prep
- `gh release list --limit 10`: PASS, latest GitHub Release is v0.2.13 before v0.2.14 prep
- `npm run check-types`: PASS
- `npm run lint`: PASS
- `node esbuild.js`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: FAIL, local `.vscode-test` host aborted with `Code is currently being updated` on VS Code `1.119.1` and cached `1.119.0`
- `node scripts/test-activation-ux.js`: PASS
- `node scripts/test-view-welcome-ux.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `node scripts/test-instruction-block-policy.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `npm run package`: PASS
- `npx --yes vsce package --no-dependencies`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.14.vsix --force`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `git diff --check`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.14.vsix`
- Size: `306,341 bytes`
- SHA256: `EC0FB0A83A625A1531A5287E3416F559DE5A924F9437DF834B96269A6C2365D4`
