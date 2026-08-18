/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Split out of native.ts so check.mjs can run it without pulling in electron. */

export interface Upstream {
    host: string;
    port: number;
    user: string;
    pass: string;
}

/*
 * A typo in either field would otherwise take Discord's whole network stack down
 * with it, since the switch is set whether or not the bridge can reach anything.
 * A password may contain ":", the host may not, so both split on the first one only.
 */
export function parseUpstream(server: string, auth: string): Upstream | null {
    const at = server.lastIndexOf(":");
    const host = at === -1 ? server.trim() : server.slice(0, at).trim();
    const port = at === -1 ? 1080 : Number(server.slice(at + 1));

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
        console.error("[RegionSwapper] proxy server is not a usable host:port, staying direct:", server);
        return null;
    }

    const colon = auth.indexOf(":");
    return {
        host,
        port,
        user: colon === -1 ? auth.trim() : auth.slice(0, colon).trim(),
        pass: colon === -1 ? "" : auth.slice(colon + 1)
    };
}
