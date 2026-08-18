/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import net from "node:net";

import { RendererSettings } from "@main/settings";
import { app } from "electron";

import { parseUpstream, Upstream } from "./proxy";

/*
 * Two pieces, both of which used to live in a launcher script you had to start
 * Discord from:
 *  1. a local SOCKS5 listener that relays to the authenticated upstream proxy,
 *     because Chromium's --proxy-server can't do SOCKS5 user/pass auth
 *  2. --proxy-server pointed at that listener
 *
 * This file is loaded by Vencord's main process at require time, before
 * app.whenReady(), which is the only window in which appendSwitch still counts.
 * That's also why both settings here are restartNeeded.
 */

const LOCAL_PORT = 10800;

const pluginSettings = RendererSettings.store.plugins?.RegionSwapper;

// No proxy ships with the plugin: an empty server setting means stay direct.
if (pluginSettings?.enabled && pluginSettings.proxy !== false && pluginSettings.proxyServer) {
    const upstream = parseUpstream(pluginSettings.proxyServer, pluginSettings.proxyAuth ?? "");

    if (upstream) {
        startBridge(upstream);
        app.commandLine.appendSwitch("proxy-server", `socks5://127.0.0.1:${LOCAL_PORT}`);
        console.log(`[RegionSwapper] routing Discord through socks5://127.0.0.1:${LOCAL_PORT} -> ${upstream.host}:${upstream.port}`);
    }
}

function startBridge({ host, port, user, pass }: Upstream) {
    const needsAuth = user !== "";

    const server = net.createServer(clientSocket => {
        clientSocket.on("error", () => { });

        clientSocket.once("data", greeting => {
            if (greeting?.[0] !== 0x05) return clientSocket.destroy();

            // Discord talks to us unauthenticated; the credentials go upstream.
            clientSocket.write(Buffer.from([0x05, 0x00]));

            clientSocket.once("data", request => {
                if (request?.[0] !== 0x05) return clientSocket.destroy();

                const upstream = net.createConnection({ host, port }, () => {
                    upstream.write(needsAuth
                        ? Buffer.from([0x05, 0x02, 0x02, 0x00]) // user/pass preferred, no-auth accepted
                        : Buffer.from([0x05, 0x01, 0x00]));
                });

                const kill = () => {
                    clientSocket.destroy();
                    upstream.destroy();
                };

                upstream.on("error", kill);

                let state = "GREETING";

                upstream.on("data", data => {
                    try {
                        switch (state) {
                            case "GREETING":
                                if (data[0] !== 0x05) return kill();
                                if (data[1] === 0x02) {
                                    if (!needsAuth) return kill();
                                    state = "AUTH";
                                    const u = Buffer.from(user);
                                    const p = Buffer.from(pass);
                                    upstream.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
                                } else if (data[1] === 0x00) {
                                    state = "CONNECTED";
                                    upstream.write(request);
                                } else {
                                    return kill(); // 0xFF, or a method we didn't offer
                                }
                                break;
                            case "AUTH":
                                if (data[0] !== 0x01 || data[1] !== 0x00) return kill();
                                state = "CONNECTED";
                                upstream.write(request); // replay the client's CONNECT
                                break;
                            case "CONNECTED":
                                state = "STREAMING";
                                clientSocket.write(data);
                                clientSocket.pipe(upstream);
                                upstream.pipe(clientSocket);
                                break;
                        }
                    } catch {
                        kill();
                    }
                });
            });
        });
    });

    // EADDRINUSE just means a bridge is already up (a second client, say) and the
    // proxy switch still points somewhere valid, so it isn't fatal.
    server.on("error", err => console.error("[RegionSwapper] proxy bridge:", (err as Error).message));
    server.listen(LOCAL_PORT, "127.0.0.1");
}
