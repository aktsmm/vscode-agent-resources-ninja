# Agent Resources Ninja v0.2.31

Release date: 2026-06-14

## Summary

This patch release adds the official `google/skills` repository as a bundled preset source and hardens skill installation against GitHub directory-listing failures.

The bundled preset now includes 31 official Google Agent Skills covering Google Cloud and Google products (for example `gemini-api`, `gcloud`, `bigquery-basics`, `cloud-run-basics`, and `firebase-basics`), bringing the preset index to `v1.23.0`. README source tables, Related Projects, and the skill-index instruction Official basis are synced accordingly.

This release also closes an install-recovery gap. When the GitHub Contents API directory listing fails with a non-404 error (for example a SAML or classic PAT `403`) and no `SKILL.md` was written, the installer now tries to recover the real `SKILL.md` directly from its raw URL before falling back to the generated template. Public raw fetches against `raw.githubusercontent.com` never receive a token, so organization token policies cannot block them.

Settings are unchanged in this release. The ref output catalog continues to be controlled by `refCatalogFormat`.

## Changes

- Added the official `google/skills` repository as a bundled preset source (31 skills) and bumped the preset index to `v1.23.0`.
- Synced README source tables, Related Projects, and the skill-index instruction Official basis for `google/skills`.
- Recovered the real `SKILL.md` from its raw URL when directory listing fails, before falling back to the generated template.
- Kept tokens off `raw.githubusercontent.com` so public raw fetches are not blocked by organization token policies.
- Added `test-skill-installer-remote-fallback.js` and wired it into `test:resources`.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.31.vsix`
- Pending package step.
