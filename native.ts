/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Caio Stoduto
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { DATA_DIR } from "@main/utils/constants";
import { spawn } from "child_process";
import { app, autoUpdater } from "electron";
import EventEmitter from "events";
import { appendFileSync, copyFileSync, existsSync, mkdirSync } from "original-fs";
import { join } from "path";

/**
 * macOS has a single Discord.app that is updated in place (or swapped out), possibly after Discord has quit,
 * so we cannot patch from inside the process like the Windows/Linux implementation does.
 * Instead a tiny detached /bin/sh watcher outlives Discord, waits for a stock app.asar to appear,
 * and puts the Vencord loader (the file we are running from) back.
 *
 * It never acts unless app.asar is no longer our loader, and never touches a file that is invalid
 * (truncated) or that already looks like a Vencord loader, so it cannot clobber a fresh install or loop.
 */
const MAC_WATCHER = String.raw`
RES="$1"; STUB="$2"; LOG="$3"; PARENT="$4"
APP="$RES/app.asar"; ORIG="$RES/_app.asar"; MACOS="$(dirname "$RES")/MacOS"
log() { [ -n "$LOG" ] || return 0; printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
sig() { stat -f '%z:%m:%i' "$1" 2>/dev/null || echo missing; }
size() { stat -f '%z' "$1" 2>/dev/null || echo 0; }
# asar starts with a 4-byte "4" followed by the header size, which must fit inside the file (rejects truncated copies)
valid_asar() { set -- $(od -An -tu4 -N8 "$APP" 2>/dev/null); [ "$1" = 4 ] && [ $(($2 + 8)) -le "$(size "$APP")" ]; }
is_loader() { [ -f "$APP" ] && cmp -s "$APP" "$STUB"; }
# something else that looks like a Vencord loader (e.g. a fresh install): never touch it
looks_like_vencord() { [ -f "$APP" ] && [ "$(size "$APP")" -lt 65536 ] && grep -aq 'patcher\.js' "$APP"; }

patch() {
    NEW="$RES/.app.asar.vencord-new"; OLD="$RES/_app.asar.vencord-old"
    cp -f "$STUB" "$NEW" || { log "could not write loader into $RES"; return 1; }
    [ -e "$ORIG" ] && mv -f "$ORIG" "$OLD"
    if mv -f "$APP" "$ORIG" && mv -f "$NEW" "$APP"; then
        rm -f "$OLD"; log "repatched $RES"
        if pgrep -f "$MACOS/" >/dev/null 2>&1; then
            osascript -e 'display notification "Vencord was restored after a Discord update. Restart Discord to load it." with title "Vencord"' >/dev/null 2>&1
        fi
        return 0
    fi
    log "patching failed, rolling back"
    [ -e "$ORIG" ] && [ ! -e "$APP" ] && mv -f "$ORIG" "$APP"
    [ -e "$OLD" ] && [ ! -e "$ORIG" ] && mv -f "$OLD" "$ORIG"
    rm -f "$NEW"; return 1
}

# 1. Updaters that install on quit do their work after Discord has exited
i=0; while kill -0 "$PARENT" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 1; i=$((i+1)); done

# 2. Wait for the host files to be replaced (extend the window while an installer helper is alive)
t=0; limit=180
while [ "$t" -lt "$limit" ]; do
    if [ -f "$APP" ] && ! is_loader; then
        if looks_like_vencord; then log "app.asar is another Vencord loader, leaving it alone"; exit 0; fi
        a="$(sig "$APP")"; sleep 1; b="$(sig "$APP")"; sleep 1; c="$(sig "$APP")"
        if [ "$a" = "$b" ] && [ "$b" = "$c" ] && [ "$(size "$APP")" -ge 65536 ] && valid_asar; then patch; exit $?; fi
    fi
    if [ "$limit" -lt 600 ] && pgrep -f 'ShipIt|Squirrel' >/dev/null 2>&1; then limit=600; fi
    sleep 1; t=$((t+1))
done
log "no host update detected"
`;

function setup() {
    const logFile = join(DATA_DIR, "persist-macos.log");
    // Defaults declared in definePluginSettings only exist in the renderer, so until the user touches the toggle
    // settings.json has no value: only an explicit `false` turns logging off.
    const loggingEnabled = () => RendererSettings.store.plugins?.MacOSPersist?.logging !== true;
    const log = (msg: string) => {
        if (!loggingEnabled()) return;
        try {
            mkdirSync(DATA_DIR, { recursive: true });
            appendFileSync(logFile, `${new Date().toISOString()} [host] ${msg}\n`);
        } catch { /* logging must never break startup */ }
    };

    // Native modules load for every plugin, enabled or not: only act if the user enabled this plugin.
    // Read live, because the updater can fire before the renderer (and thus any "start()") exists.
    const isEnabled = () => !!RendererSettings.store.plugins?.MacOSPersist?.enabled && !process.env.DISABLE_UPDATER_AUTO_PATCHING;

    let scheduled = false;
    const schedule = (reason: string) => {
        if (scheduled || !isEnabled()) return;

        try {
            const resources = process.resourcesPath;
            const appAsar = join(resources, "app.asar");

            // We must be running from a loader installed as app.asar, with Discord's original next to it
            if (!existsSync(appAsar) || !existsSync(join(resources, "_app.asar"))) {
                log(`not scheduling (${reason}): unexpected layout in ${resources}`);
                return;
            }

            mkdirSync(DATA_DIR, { recursive: true });
            const stub = join(DATA_DIR, "host-loader.asar"); // snapshot of the loader that currently works
            copyFileSync(appAsar, stub);

            scheduled = true;
            log(`scheduling repatch watcher (${reason}) for ${resources}`);

            spawn("/bin/sh", ["-c", MAC_WATCHER, "vencord-repatch", resources, stub, loggingEnabled() ? logFile : "", String(process.pid)], {
                detached: true,
                stdio: "ignore"
            }).unref();
        } catch (err) {
            console.error("[Vencord] MacOSPersist: failed to schedule repatch", err);
        }
    };

    // Written on every launch so it is obvious whether this code is loaded and whether the layout is what we expect
    log(`armed (plugin enabled: ${isEnabled()}): resources=${process.resourcesPath} app.asar=${existsSync(join(process.resourcesPath, "app.asar"))} _app.asar=${existsSync(join(process.resourcesPath, "_app.asar"))}`);

    // Same hook the Windows/Linux implementation uses
    EventEmitter.prototype.emit = new Proxy(EventEmitter.prototype.emit, {
        apply(target, thisArg, argArray) {
            if (argArray[0] === "host-updated") schedule("host-updated");
            return Reflect.apply(target, thisArg, argArray);
        },
    });

    // Any quit may be an update restart; the watcher is a no-op and exits after a few minutes if nothing changed
    app.on("before-quit", () => schedule("before-quit"));
}

if (process.platform === "darwin") setup();
