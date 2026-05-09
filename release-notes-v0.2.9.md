# v0.2.9 - User / Global reinstall parity

## Highlights

- **User / Global Reinstall Parity**: User / Global Resource Home now exposes **Reinstall Resource** for remote-installed rows, so downloaded resources can be refreshed without switching back to Workspace Resources.
- **Group Reinstall in User / Global View**: Kind groups and plugin groups in User / Global Resource Home now expose **Reinstall Resource Group**, matching the batch reinstall workflow already available in Workspace Resources.
- **Plugin Detection Is More Resilient**: Installed plugin-managed resources now fall back across `remotePath`, `relativePath`, and `fullPath` when grouping, reducing cases where a plugin appears in one installed view but not another.

## Documentation

- README and README_ja now describe reinstall behavior in both Workspace Resources and User / Global Resource Home.
- Version info and CHANGELOG were updated for v0.2.9.

## Tests

- Added regression checks for User / Global reinstall commands and context visibility.
- Verified `npm run check-types`, `npm run lint`, `npm run test:resources`, `npm test`, and `npm audit --audit-level=moderate`.

## VSIX

| Item   | Value                                                              |
| ------ | ------------------------------------------------------------------ |
| File   | `agent-resources-ninja-0.2.9.vsix`                                 |
| Size   | 299.91 KB (307,105 bytes), 14 files                                |
| SHA256 | `8128686A3CC92703E85C8B837167A86D593AAF0A92916FECADA004496AE48669` |
