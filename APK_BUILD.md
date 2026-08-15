# APK Build & Mobile Release Guide (canonical)

This is the single canonical reference for building, verifying, and distributing the Tango Cifrado APK (TWA). Replace the three scattered guides (PASOS_APK.md, REBUILD_APK.md, MOBILE_TESTING.md) with links to this file; keep those docs as historical notes only.

## Summary (quick)
- Install deps: Node 20, JDK 17, Bubblewrap CLI
- Ensure keystore and `assetlinks.json` are prepared and mirrored to Pages
- Build: `cd tango-cifrado-apk && KEYSTORE_FILE=~/tango-signing/android.keystore ../scripts/apk/build-apk.sh`
- Verify artifact with `pyaxmlparser` (package, versions, signing, no Web Share Target unless intentional)
- Transfer safely (Telegram self, Drive, adb push), verify SHA256 on device
- Install clean (uninstall previous app first)

## Prereqs
- `~/tango-signing/android.keystore` (outside workspace) and `keystore-password.txt` securely backed up
- `gh` CLI + `GH_TOKEN` for CI secret setup (optional)
- `pyaxmlparser` for artifact verification: `pip install pyaxmlparser`

## Install dependencies (one-time)
```bash
chmod +x scripts/apk/*.sh
./scripts/apk/install-deps.sh
```

## Build (recommended safe flow)
```bash
cd tango-cifrado-apk
KEYSTORE_FILE=~/tango-signing/android.keystore \
  ../scripts/apk/build-apk.sh
```
Notes:
- The script syncs `pwa/manifest.json` → `twa-manifest.json` via `sync-share-target.sh` unless `ALLOW_SHARE_TARGET` is unset (default safe: share target disabled).
- First build downloads Android SDK (~2–5 GB). Subsequent builds are fast.

## Artifact verification (required)
Use `pyaxmlparser` to validate the real APK content, not just `BUILD SUCCESSFUL` logs.
```bash
python3 - <<'PY'
from pyaxmlparser import APK
apk = APK('dist/apk/app-release-signed.apk')
print('Package:', apk.package)
print('versionCode/versionName:', apk.version_code, '/', apk.version_name)
print('minSdk/targetSdk:', apk.get_min_sdk_version(), '/', apk.get_target_sdk_version())
print('Signed v1/v2/v3:', apk.is_signed_v1(), apk.is_signed_v2(), apk.is_signed_v3())
print('Web Share Target (SEND intent):', 'android.intent.action.SEND' in str(apk.get_android_manifest_xml()))
PY
```
Expected:
- `Package: com.tangocifrado.app`
- versionCode > previous
- signing v1/v2/v3 True
- `Web Share Target: False` (unless you intentionally enabled it for experimentation)

## Transfer & install (safest methods)
- Prefer: Telegram (Saved Messages), Google Drive, adb push, or direct USB transfer. **Do not use email** (can corrupt APK).
- Verify SHA256 on device and PC before installing.

## CI notes
- Use `gh secret set` to add `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` to the repo used by the workflow.
- The CI workflow `build-twa-apk.yml` includes a smoke-test that validates string resources and prevents publishing if stubs are present.

## Enabling Web Share Target (advanced / experimental)
- Default builds disable Web Share Target (safe). To enable for investigation:
```bash
ALLOW_SHARE_TARGET=1 ../scripts/apk/build-apk.sh
```
- Do NOT enable for production until the installation issue is resolved — see `TO_FIX.md` M-5.

## Troubleshooting quick links
- Assetlinks verification: ensure `/.well-known/assetlinks.json` is served from the root domain used in `twa-manifest.json`.
- If `bubblewrap` prompts for version bump: run `bubblewrap update --skipVersionUpgrade` before `build` or confirm the `versionName` interactively.

## Where to look next
- For step-by-step checklist and historical notes see: `PASOS_APK.md` and `MOBILE_TESTING.md` (deprecated, now point to this file).
- For root-cause investigations (installation parse errors) see `TO_FIX.md` M-7.


