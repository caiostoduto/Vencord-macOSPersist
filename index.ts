/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Caio Stoduto
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    logging: {
        type: OptionType.BOOLEAN,
        description: "Write a log to <Vencord data folder>/persist-macos.log (startup state, update detection, repatch results)",
        default: false
    }
});

export default definePlugin({
    name: "MacOS Persist",
    description: "macOS only: re-applies Vencord after Discord updates itself.",
    authors: [{ name: "Caio Stoduto", id: 0n }],
    tags: ["Utility"],
    enabledByDefault: true,
    settings
});
