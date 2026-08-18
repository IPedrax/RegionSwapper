# RegionSwapper

A plugin for [Vencord](https://vencord.dev) and [Equicord](https://github.com/Equicord/Equicord).

Pick one voice region in the plugin settings and every call and voice channel you
join moves to it. Or right-click a single channel and pick a region just for that one.

This is what the VPN was for, minus the VPN: only the *voice server* changes, your
actual connection stays direct, so there's no bandwidth or latency cost from
tunnelling everything.

---

## Built-in proxy (regional guard bypass)

Some blocks aren't about the voice server at all: Discord decides whether you can
screenshare or use your camera from where your *API* traffic comes from. The plugin
handles that itself, so there's no launcher script and nothing to double-click.

`native.ts` runs in Discord's main process before the app boots. It opens a local
SOCKS5 listener on `127.0.0.1:10800` that relays to the authenticated upstream proxy
(Chromium's `--proxy-server` can't do SOCKS5 user/password auth on its own), then
points Discord at it. Start Discord however you normally do; it connects through the
proxy every time.

Only Discord's HTTP/WebSocket traffic goes through it. Voice audio still goes direct,
so the region you pick above is still what decides your ping.

**No proxy ships with the plugin.** Put your own SOCKS5 server in **proxyServer** as
`host:port`, and its login in **proxyAuth** as `user:password` (leave that empty if it
doesn't need one). Empty server means Discord connects directly, exactly as if the
plugin's proxy half didn't exist.

Whichever country that proxy sits in is the one Discord thinks you're in, so pick one
where the feature you're after isn't blocked. Both fields need a restart, since a
command line switch can only be set at startup.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| **Region** | Automatic | The region everything gets moved to. `Automatic` turns auto-switching off and leaves Discord in charge. |
| **Apply it to DM and group calls** | on | Moves DM and group calls as they start. |
| **Apply it to server voice channels too** | **off** | Moves server voice channels you join. |
| **proxy** | on | Master switch for the proxy half. Does nothing until **proxyServer** is filled in. Restart to apply. |
| **proxyServer** | *empty* | Your SOCKS5 proxy, as `host:port`. Empty means direct. Restart to apply. |
| **proxyAuth** | *empty* | That proxy's login, as `user:password`. Empty means no auth. Restart to apply. |

The server-channel toggle is off on purpose. Unlike a call, a guild channel's region
is a **channel setting**: changing it moves everyone in that channel, it sticks after
you leave, and it shows up in the server's audit log under your name. It also needs
**Manage Channel**, so it silently does nothing in servers where you aren't staff.
Turn it on if you run your own servers; leave it off if you'd rather not quietly
re-region other people's.

## The limitation that will bite you

In a server where you are **not staff**, this plugin can do nothing, and neither can
any other client mod. A guild voice channel's region is a property of the channel,
shared by everyone in it, and Discord enforces Manage Channel server-side.

When such a channel is set to `Automatic`, Discord picks the region from the
participants' apparent locations. That is why a VPN appears to "work" there and this
plugin does not: the VPN shifts Discord's automatic pick, while the plugin's lever is
the explicit override you lack permission to set. Different mechanisms.

Where it does work: servers you have Manage Channel in, and every DM or group call,
which has no permission requirement at all.

If it seems to do nothing, open DevTools (Ctrl+Shift+I) and look for
`[RegionSwapper] left #<channel> alone: <reason>` in the console. It says exactly why.

## Right-click menu

The **Voice Region** submenu is still there for one-offs, on any voice channel you
can manage and any call you're in. **Automatic** (server channels only) clears the
override. A call always has a concrete region, so it has no Automatic entry.

## How it picks a moment to act

| Trigger | Covers |
|---|---|
| `VOICE_STATE_UPDATES` | joining or moving between server voice channels |
| `CALL_CREATE` / `CALL_UPDATE` | DM and group calls, including ones that start after you join |
| plugin start | a call you're already in when you enable it |

`CALL_UPDATE` fires a lot. Every repeat is a no-op once the channel already sits on
your preferred region, so this doesn't hammer the API.

## Endpoints

| Target | Request | Who can |
|---|---|---|
| Guild voice / stage channel | `PATCH /channels/:id` → `rtc_region` | needs **Manage Channel** |
| DM or group call | `PATCH /channels/:id/call` → `region` | anyone in the call |

The region list comes from `GET /voice/regions` at start, so it can't go stale. The
list in `regions.ts` is only a fallback for if that request fails. Whichever region
Discord considers best for you is labelled *(Discord's pick)* — that's Discord's
guess, not a live ping measurement, so try neighbours if the pick feels bad.

## Install

Works on **Vencord** and on **Equicord**, which builds `src/userplugins` the same way.
Either one needs a **source install**: the installer's prebuilt `dist` can't load
custom plugins.

Close Discord fully first, then paste one line.

Equicord:

```bash
git clone https://github.com/Equicord/Equicord && cd Equicord && pnpm i && git clone https://github.com/IPedrax/RegionSwapper src/userplugins/RegionSwapper && pnpm build && pnpm inject
```

Vencord:

```bash
git clone https://github.com/Vendicated/Vencord && cd Vencord && pnpm i && git clone https://github.com/IPedrax/RegionSwapper src/userplugins/RegionSwapper && pnpm build && pnpm inject
```

On PowerShell, `&&` doesn't chain, so run it as one `;`-separated line instead:

```powershell
git clone https://github.com/Equicord/Equicord; cd Equicord; pnpm i; git clone https://github.com/IPedrax/RegionSwapper src/userplugins/RegionSwapper; pnpm build; pnpm inject
```

`pnpm inject` asks which Discord build to patch and refuses while Discord is open.
Start Discord afterwards and enable **RegionSwapper** in the mod's settings.

Vencord and Equicord patch the same files, so only one can be installed at a time,
and they keep separate settings folders. Switching mods means setting the plugin up
again.

To update: `git pull` inside `src/userplugins/RegionSwapper`, then `pnpm build`.
While iterating, `pnpm watch` rebuilds on save (Ctrl+R in Discord to reload).

## Files

- `index.tsx` — settings, context menu, flux handlers
- `regions.ts` — pure request routing and the auto-apply rule
- `native.ts` — main process: the SOCKS5 bridge and the `--proxy-server` switch
- `proxy.ts` — parsing for the two proxy settings, kept electron-free so it's testable
- `check.mjs` — `node check.mjs` asserts the routing, the auto-apply rule and the parsing

## License

GPL-3.0-or-later, same as Vencord.
