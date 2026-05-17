# Agent Resources Ninja v0.2.16

Release date: 2026-05-17

## Summary

This patch release makes installed extension discovery more complete by showing read-only resources shipped inside marketplace extensions, including manifest-declared chat agents and prompt files, while keeping those resources safely non-destructive in the User / Global Resource Home view.

## Changes

- Added read-only discovery for marketplace extension resources under `resources/agents`, `resources/skills`, `resources/prompts`, `resources/instructions`, `resources/hooks`, and `resources/mcp`.
- Added manifest-aware exact-file discovery for extension-declared `chatAgents` and `chatPromptFiles`.
- Kept installed extension resources separate from built-in resources, grouped by extension and kind, with open/reveal/copy actions only.
- Localized the Installed Extensions scope label and synced README / README_ja plus welcome text with the current discovery model.

## Verification

- `npx --yes vsce show yamapan.agent-resources-ninja --json`: PASS, Marketplace already has v0.2.15 so the next free version is v0.2.16
- `git ls-remote --tags origin v0.2.15`: PASS, remote tag exists
- `git ls-remote --tags origin v0.2.16`: PASS, remote tag does not exist before release
- `gh release view v0.2.15 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, GitHub Release v0.2.15 already exists
- `gh release view v0.2.16 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, GitHub Release v0.2.16 does not exist before release
- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npm test`: PASS
- `npm run package`: PASS
- `npx --yes vsce package --no-dependencies -o .\agent-resources-ninja-0.2.16.vsix`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.16.vsix --force`: PASS
- `git diff --check`: PASS before release metadata finalization

## VSIX

- File: `agent-resources-ninja-0.2.16.vsix`
- Size: `308,681 bytes`
- SHA256: `37428D25B638A7B23E5F798310A9E2E1BA4084F676D91B8E479EEE46FB2CC458`
