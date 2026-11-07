# Legacy backup fixtures

These ZIP files were produced by `BackupManager.createBackup` as it was at commit
`c0b1dc1` (before `schemaVersion` and the restore hardening), from the synthetic SD
card that `synthetic-sd.ts` writes. They are backward-compatibility fixtures:
`BackupManager.test.ts` checks that they still validate and restore. Do not
regenerate them with newer code.

| File                                 | Contents                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `legacy-v1-full-with-playlists.zip`  | `Patch01`, `Patch02`, `Patch05` and `playlists.json` (`version: "2.0"`, no `schemaVersion`) |
| `legacy-v1-partial-no-playlists.zip` | `Patch02` only, no playlists                                                                |

Both manifests have `version: "1.0"`, `appVersion: "0.1.0"` and no `schemaVersion`.
