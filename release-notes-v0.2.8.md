# v0.2.8 - Workspace resource group reinstall

## Highlights

- **Workspace Resource Group Reinstall**: Right-click a Workspace Resources kind group, such as Skill or Agent, and choose **Reinstall Resource Group** to reinstall all installed resources in that group that were downloaded from remote sources.
- **Per-resource reinstall remains available**: Individual remote-installed rows still expose **Reinstall Resource** for one-at-a-time updates.
- **Local resources stay protected**: Group reinstall filters to `installedRemoteSkill` and `installedRemoteResource`, so local/manual resources in the same group are not modified.
- **Clear empty state**: If a group has no remote-installed resources, the action explains that there is nothing to reinstall.

## Documentation

- README and README_ja now describe both individual and group reinstall flows from Workspace Resources.
- CHANGELOG compare links were updated to use the latest release baseline.

## Tests

- Added regression checks for context-menu exposure, command-palette hiding, localization keys, per-resource delegation, and the empty-group message.
- Verified `npm run check-types`, `npm run lint`, `npm run test:resources`, `npm test`, `npm audit --audit-level=moderate`, and `node scripts/test-representative-flows.js`.

## VSIX

| Item | Value |
| ---- | ----- |
| File | `agent-resources-ninja-0.2.8.vsix` |
| Size | 298.62 KB (305,788 bytes), 14 files |
| SHA256 | `1F2B7AA684B2A703FFDAF2DED3B677C2C205FACF1C83A099B9C8F86132A3D89E` |
