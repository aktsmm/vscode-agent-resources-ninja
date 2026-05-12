# Agent Resources Ninja v0.2.13

Release date: 2026-05-13

## Summary

This patch release tightens generated instruction blocks into a smaller routing layer, adds workspace and Global Resource Home policy controls for shared-block kinds, and keeps legacy standalone exclusions as compatibility behavior instead of primary configuration.

## Changes

- Changed shared instruction block defaults to always list `skill`, include `agent` by default, and keep `instruction` opt-in.
- Added Global Resource Home overrides (`inherit` / `on` / `off`) for `agent` and `instruction` listing so global targets can reuse workspace choices without duplicate input.
- Reframed `resourceNinja.kindsExcluded` as a legacy standalone compatibility layer that never removes `skill` and is ignored while the skill-only sibling extension is active.
- Updated coexistence status output, README / README_ja, repo instructions, and generated coexistence fixtures to match the new policy semantics.
- Added instruction-block policy regression coverage and refreshed manifest / UX consistency tests.

## Verification

- `npx --yes vsce show yamapan.agent-resources-ninja --json`: PASS, latest Marketplace version is 0.2.12 before v0.2.13 prep
- `git ls-remote --tags origin`: PASS, remote tag `v0.2.13` does not exist before release prep
- `gh release list --limit 10`: PASS, latest GitHub Release is v0.2.12 before v0.2.13 prep
- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npm run package`: PASS
- `npx --yes vsce package --no-dependencies`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.13.vsix --force`: PASS
- `git diff --check`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.13.vsix`
- Size: `305,847 bytes`
- SHA256: `E8AB4261859363F6B57745AA61B4AC41B0DE296D434059E8B4972F8B989104AB`