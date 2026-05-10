# Agent Resources Ninja v0.2.11

Release date: 2026-05-11

## Summary

This patch release improves GitHub Copilot CLI compatibility in User / Global Resource Home. Resource Ninja now recognizes Copilot CLI product-native resources under `~/.copilot`, including local instructions, skills, hook JSON configs, and `mcp-config.json`, while keeping runtime session data out of the resource view.

## Changes

- User / Global Resource Home now prioritizes product resource folders before Copilot CLI runtime logs and session state.
- `~/.copilot/copilot-instructions.md` is recognized as a product-native instruction resource.
- `~/.copilot/skills/*/SKILL.md` remains visible even when the CLI home contains many session files.
- Copilot hook config files such as `~/.copilot/hooks/*.json` and `.github/hooks/*.json` are recognized as Hook resources.
- Copilot CLI `mcp-config.json` is recognized as an MCP config resource.
- Hook README packages still use folder-backed install/delete behavior, while hook JSON configs are treated as file-backed resources.
- Global Resource Home scope rows now show the selected product root and compact path.
- Remote Search now includes hook JSON configs and `mcp-config.json` queries.
- README / README_ja and settings descriptions now clarify the selected Global Resource Home, built-in resource toggle, and Copilot CLI resource coverage.

## Verification

- `npx vsce show yamapan.agent-resources-ninja --json`: PASS, latest Marketplace version was 0.2.10 before v0.2.11 prep
- `git ls-remote --tags origin v0.2.11`: PASS, no matching tag output
- `gh release view v0.2.11 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, release not found
- GitHub Copilot CLI local version check: PASS, `1.0.44`
- `~/.copilot` preflight: PASS, detected `copilot-instructions.md`, 5 skills, 1 hook JSON config, and `mcp-config.json`
- `npm run check-types`: PASS
- `npm run lint`: PASS
- `node esbuild.js`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `git diff --check`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.11.vsix`
- Size: 309,551 bytes
- SHA256: `AB70CA13F3EE72D4080ECA1C4214C9A37D9E6C6B6D720122E8AB69C3E45ED585`
