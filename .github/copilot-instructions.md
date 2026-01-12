# GitHub Copilot / AI Agent Instructions for com.audioflow.homey 🚀

## Quick summary
- This repository is a Homey app (Node.js) that controls Audioflow speaker switches over the LAN using a small HTTP API. Key runtime files: `app.js` (entry), `drivers/audioflow/device.js`, `drivers/audioflow/driver.js`, and `lib/AudioflowClient.js`.
- CI: GitHub Actions runs Homey validation (`.github/workflows/homey-app-validate.yml`). Publishing and version updates use dedicated workflows requiring `HOMEY_PAT` and `GITHUB_TOKEN`.

## Architecture & important flows 🔧
- Device model: each Audioflow device exposes 4 zones. Homey represents zones with capabilities `onoff_zone1` .. `onoff_zone4`.
- Network/HTTP layer: `lib/AudioflowClient.js` wraps HTTP endpoints used across `driver` + `device` code. Endpoints of interest:
  - GET `/switch` => meta (`getSwitchInfo()`)
  - GET `/zones` => zone array (`getZones()` returns `response.zones || []`)
  - PUT `/zones/:n` => set zone on/off (client expects 1-based zone numbers)
  - PUT `/zonename/:n` => set zone name + enabled flag (payload is `enabledFlag + truncatedName`)
- Polling: `drivers/audioflow/device.js` starts periodic polling (`_startPolling`) for zone state (default 5s). Polling updates capabilities, fires flow triggers (`zone_turned_on` / `zone_turned_off`), and syncs names/settings.

## Project-specific conventions & gotchas ⚠️
- Zone numbering: Device uses 1-based zone numbers in client & device code, but some hardware docs may be 0-based; always follow `AudioflowClient` conversion comments and usage in `device.js`.
- IDs: device IDs are hardened in `driver.js` (use serial if available, otherwise IP, with `.` replaced by `-`). Keep IDs as strings.
- Pairing: pairing handlers in `drivers/audioflow/driver.js` expect `set_ip` (validates `/switch`) and `list_devices` (returns array of device descriptors `{name,data:{id},settings,store}`). The pairing UI in `drivers/audioflow/pair/` must call these handlers. Note: `list_devices.html` currently emits `add_device` — check consistency before modifying pairing logic.
- Duplicate method: `AudioflowClient.js` declares `setZoneName` twice (same implementation). Avoid adding conflicting duplicates; consolidate edits to the single client method.
- UI/Locale keys: locales in `locales/en.json` include flow keys (`turn_all_zones_on`, etc.)—ensure code registers corresponding action cards (some keys in locale may be unused in `device.js`).
- Error & logging style: prefer `this.log(...)` / `this.error(...)` in drivers/devices; `AudioflowClient` uses console logs for HTTP debug output. Maintain these patterns when adding instrumentation.

## Tests, CI, and release notes ✅
- There is no test suite or `npm test` script. Current CI validates the Homey app with `athombv/github-action-homey-app-validate` (`.github/workflows/homey-app-validate.yml`).
- Publishing and tagging are handled by `.github/workflows/homey-app-publish.yml` and `homey-app-version.yml` (requires secrets `HOMEY_PAT`, `GITHUB_TOKEN`).
- If you add tests, add them to `package.json` scripts and update CI to run them.

## When you modify code — actionable checklist ✍️
- If you change the HTTP contract or payload formats, update `lib/AudioflowClient.js` and validate callers in `drivers/audioflow/device.js` and `driver.js`.
- If adding/removing Flow cards: update `drivers/audioflow/device.js` registration methods and the `locales` keys in `locales/en.json`.
- If changing pairing flow: update `drivers/audioflow/pair/*.html`, `drivers/audioflow/driver.js`, and `driver.compose.json` pair templates in lockstep. The UI must call the expected session handlers (`set_ip`, `list_devices`).
- Keep logs consistent: use `this.log` / `this.error` for Homey classes; only use `console.log/error` inside library-level code if clearly marked as DEBUG.

## Good-first tasks for agent PRs 🐣
- Fix the duplicated `setZoneName` method in `lib/AudioflowClient.js` (remove duplication).
- Align `drivers/audioflow/pair/list_devices.html` with driver handlers (replace `add_device` emission with calls to the pairing session handlers the driver expects).
- Add a basic test harness and an `npm test` script (optional: update workflow to run tests).

## Files to read first (priority) 📚
1. `drivers/audioflow/device.js` — main runtime logic for zones, flows, and polling
2. `drivers/audioflow/driver.js` — pairing flow and device discovery
3. `lib/AudioflowClient.js` — HTTP client and payload formats
4. `driver.compose.json` — device manifest (capabilities, settings, pair flow)
5. `drivers/audioflow/pair/*.html` — pairing UI templates
6. `.github/workflows/*.yml` — CI/publish process

---
If any of these sections are unclear or you want the file to be expanded with quick-code snippets and PR examples, I can update it — what should I add or emphasize next? ✅