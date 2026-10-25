<h1 align="center">MacOSPersist</h1>

<p align="center">
    <a href="https://discord.com"><img src="https://img.shields.io/badge/Discord-242629?logo=discord" alt="Discord"/></a>
    <a href="https://vencord.dev"><img src="https://img.shields.io/badge/Vencord-242629?logo=vencord" alt="Vencord"/></a>
    <a href="https://www.apple.com/macos/"><img src="https://img.shields.io/badge/macOS-242629?logo=apple" alt="macOS"/></a>
</p>

This plugin keeps [Vencord](https://vencord.dev/) installed on **Discord Desktop for macOS** after Discord updates itself. Vencord already does this on Windows and Linux; on macOS the feature is switched off, so every Discord update silently removes Vencord until the installer is ran again.

<p align="center"><a href="#how-it-works-technical">How it works (technical)</a> · <a href="#installation-vencord">Installation</a> · <a href="#settings">Settings</a> · <a href="#troubleshooting">Troubleshooting</a></p>

## How it works (technical)

### Background: how Vencord patches Discord

The Vencord installer does not modify Discord's code. It renames Discord's real `app.asar` to `_app.asar` and puts a tiny loader in its place:

```
Discord.app/Contents/Resources/
├── app.asar     ← Vencord loader (requires Vencord's dist/patcher.js)
└── _app.asar    ← Discord's real application
```

When Discord updates, the new host ships a stock `app.asar`, the loader is gone, and so is Vencord.

### Why Vencord's own persistence skips macOS

[`Vencord/src/main/persistAfterDiscordUpdates.ts`](https://github.com/Vendicated/Vencord/blob/c3b8254c2b1c1ae2e33b6039b3c2fe7905b02e06/src/main/persistAfterDiscordUpdates.ts) handles this on Windows and Linux, where Discord installs every host version into its own sibling folder (`app-1.0.x/resources/app.asar`). The still-running, patched process finds the newest sibling folder, renames its stock `app.asar` to `_app.asar`, and copies its own loader in. It is triggered by Discord's `host-updated` event and by `before-quit`.

macOS has a single `Discord.app` that is updated in place or replaced as a whole, possibly **after** Discord has already quit. There are no `app-*` siblings to find, and a process that has exited cannot patch anything. `patcher.ts` therefore only loads that module on `win32` and `linux`.

### This plugin

1. **It is armed before Discord's updater runs.** Vencord's main-process entry (`src/main/index.ts`) imports every plugin's `native.ts` at startup, and only afterwards starts Discord's own app. The plugin's hooks are therefore in place before the updater has a chance to emit anything.
2. **It listens for update signals.** It wraps `EventEmitter.prototype.emit` to catch `host-updated` and `before-quit`. Any quit may be an update restart, so a quit alone is enough to start the watcher, which exits harmlessly if nothing changed.
3. **It hands the work to a detached watcher.** On the first signal it snapshots the working loader into Vencord's data folder (`host-loader.asar`) and spawns a small detached `/bin/sh` process that survives Discord quitting.
4. **The watcher waits for the swap.** It waits for Discord to exit (up to 2 minutes), then for up to 3 minutes (extended to 10 while a ShipIt/Squirrel process is running) for `app.asar` to stop being the loader. Once the file has been unchanged for 2 seconds and has a valid asar header, it moves the new stock `app.asar` to `_app.asar` (discarding any stale one), puts the loader back, and sends a macOS notification.

### Safety guards

The watcher runs unattended, so it is deliberately conservative:

- It never patches a file with an invalid asar header (a truncated or half-written copy).
- It never touches a file that already looks like a Vencord loader, such as a fresh install, so it cannot clobber one or loop.
- It does nothing unless `app.asar` is no longer exactly the loader it started with.
- Every rename is rolled back if a later step fails.
- It exits by itself if no update shows up, and a single watcher is started per Discord process.

### Known limitations

- **Relaunch race.** If Discord relaunches itself before the watcher has finished, that one session starts without Vencord. The notification asks you to restart Discord.

## Installation

This is a [Vencord](https://vencord.dev) _userplugin_ and must be built as part of a checkout of its source code. Follow the [Installing custom plugins](https://docs.vencord.dev/installing/custom-plugins/) guide.

## Settings

| Setting | Default value | Description |
| --- | --- | --- |
| **Logging** | False | Writes `persist-macos.log` to the Vencord data folder (`~/Library/Application Support/Vencord/`). It records startup state, which signal started the watcher, and the result of each repatch. Turning it off silences both the plugin and the watcher; the repair itself is unaffected. |

Additional notes:

- Setting the environment variable `DISABLE_UPDATER_AUTO_PATCHING` disables the repair entirely, matching Vencord's existing behavior on other platforms.
- The log file is never deleted automatically; remove it yourself if you want a clean slate.

## Troubleshooting (logging)

| What the log shows | What it means |
| --- | --- |
| No log file | Discord is not running the Vencord build that contains this plugin, or logging is off. Check which `patcher.js` the loader points to (`strings "$R/app.asar" \| grep -i patcher`) and that it was built with the plugin. |
| `armed (plugin enabled: false)` | The plugin is loaded but disabled in the Vencord settings. |
| `armed … _app.asar=false` or `not scheduling … unexpected layout` | Discord is not installed the way the plugin expects (loader as `app.asar`, original as `_app.asar`). |
| `scheduling repatch watcher (…)` but never `repatched` | The update did not land where the watcher is looking. Compare `ls -l` of `Contents/Resources` before and after an update. |
| `could not write loader into …` | macOS blocked the write; check the "App Management" permission. |
| `app.asar is another Vencord loader, leaving it alone` | A fresh Vencord install replaced the file; nothing to repair. |
| `no host update detected` | The watcher waited and saw no change. Normal for an ordinary quit. |
| No `scheduling…` line after an update | None of the hooks fired, so Discord's updater bypassed them (see [Known limitations](#known-limitations)). |
