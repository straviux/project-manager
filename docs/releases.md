# Releasing & auto-updates

The app uses the Tauri updater plugin. Installed copies check
`https://github.com/straviux/project-manager/releases/latest/download/latest.json`
a few seconds after launch (and via the header's "Check for updates"
button), download the signed update package in the background, and
install it on restart. Update packages are verified against the public
key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) — an
update signed with any other key is rejected.

## One-time: create the signing keypair

```powershell
npm run tauri signer generate -w "$env:USERPROFILE\.tauri\project-manager.key"
```

This prints a **public key** and writes the **private key** to that path
(plus a password you choose). Then:

1. Put the public key into `src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey` (replacing the placeholder) and commit it.
   The public key is safe to share and to keep in the repo.
2. Keep the private key file and its password safe and **out of git**.
   If you lose them, existing installs can never verify your updates
   again — back them up somewhere durable.
3. Make the private key available to builds. Either set it per session:

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\project-manager.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<the password you chose>"
   ```

   or set both permanently with `setx` (same values) so every future
   terminal has them. Tauri accepts the key contents or a path to the
   key file in `TAURI_SIGNING_PRIVATE_KEY`.

## Each release

1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json` to
   match).
2. With the signing env vars set, build:

   ```powershell
   npm run tauri build
   ```

   Alongside the installers in `src-tauri\target\release\bundle\`, the
   bundler emits signed updater artifacts (`.nsis.zip` / the setup exe
   and `.msi`, each with a `.sig` file) because
   `bundle.createUpdaterArtifacts` is on.
3. Create a GitHub Release tagged `v<version>` and upload:
   - `Project Manager_<version>_x64-setup.exe` (the NSIS installer —
     this is what the updater downloads on Windows)
   - its `.sig` file is not uploaded separately; the signature text goes
     into `latest.json` (below)
   - optionally the `.msi` for manual installs
   - a `latest.json` you author from this template:

   ```json
   {
     "version": "0.2.0",
     "notes": "What changed in this release.",
     "pub_date": "2026-10-22T00:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<paste the full contents of the .sig file for the setup exe>",
         "url": "https://github.com/straviux/project-manager/releases/download/v0.2.0/Project%20Manager_0.2.0_x64-setup.exe"
       }
     }
   }
   ```

   Notes:
   - `version` must be greater than the version users are running, or
     no update is offered.
   - The `url` must point at the exact asset in this release (URL-encode
     spaces as `%20`). The app's endpoint uses
     `releases/latest/download/latest.json`, which always resolves to
     the newest published release — so `latest.json` must be attached to
     every release.
   - `pub_date` is RFC 3339 / ISO 8601 UTC.

4. Publish the release (not as a draft — drafts aren't visible to the
   `latest` endpoint). Installed apps pick it up on their next launch
   or manual check.

## Troubleshooting

- **"Update check failed"** — expected before the first release exists,
  if the pubkey is still the placeholder, or while offline. The manual
  check button surfaces the error; the automatic launch check stays
  silent.
- **Build complains about signing** — the `TAURI_SIGNING_PRIVATE_KEY`
  env vars aren't set in that terminal, or the password is wrong.
- **Update downloads but won't install** — the `.sig` contents in
  `latest.json` don't match the uploaded installer or the pubkey in the
  installed build. Rebuild/re-upload as a matched set.
