<h1 align="center">MacOS Persist</h1>

<p align="center">
    <a href="https://discord.com"><img src="https://img.shields.io/badge/Discord-242629?logo=discord" alt="Discord"/></a>
    <a href="https://vencord.dev"><img src="https://img.shields.io/badge/Vencord-242629?logo=vencord" alt="Vencord"/></a>
</p>

MacOSPersist is a macOS-only [Vencord](https://vencord.dev/) plugin that restores Vencord after Discord updates its app files. Discord updates can replace the Vencord loader at `Discord.app/Contents/Resources/app.asar` with Discord's stock file, removing Vencord until it is installed again.

When enabled, the plugin starts a small detached shell watcher as Discord exits or reports an update. The watcher waits for the app files to settle, checks that the replacement is a valid stock ASAR, and restores a copy of the currently running Vencord loader. It leaves other Vencord loaders alone. If it restores the loader while Discord is still running, it displays a notification; restart Discord to load Vencord again.

## Installation

Follow the instructions at https://docs.vencord.dev/installing/custom-plugins/.

## Settings and logs

| Setting | Default | Description |
| --- | --- | --- |
| **Logging** | false | Controls diagnostic logging to `persist-macos.log` in the Vencord data folder (~/Library/Application Support/Vencord). The log records startup state, update detection, and repatch results. |

## Limitations

- It expects Discord's app resources to contain both `app.asar` and `_app.asar`, as they do after Vencord is installed.
- The watcher waits for up to three minutes for an update to settle (longer while common installer helpers are running), then exits if no replacement is detected.
- The restored loader is the one that was active when the watcher was scheduled. Rebuild or reinstall Vencord to update that copy.
