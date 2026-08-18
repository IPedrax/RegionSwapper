/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Two things here fail silently if they drift, so both get asserted:
//  - guild channels and calls use different endpoints AND different body keys
//  - the auto-apply rule, which is what stops chatty CALL_UPDATE events from
//    hammering the API and what keeps server channels opt-in
// Run: node check.mjs
import assert from "node:assert/strict";

import { parseUpstream } from "./proxy.ts";
import { autoApplyVerdict, AUTOMATIC, regionRequest } from "./regions.ts";

// -- routing --------------------------------------------------------------
assert.deepEqual(
    regionRequest({ id: "123", isPrivateCall: false }, "us-east"),
    { url: "/channels/123", body: { rtc_region: "us-east" } }
);

assert.deepEqual(
    regionRequest({ id: "123", isPrivateCall: false }, null),
    { url: "/channels/123", body: { rtc_region: null } }
);

assert.deepEqual(
    regionRequest({ id: "456", isPrivateCall: true }, "brazil"),
    { url: "/channels/456/call", body: { region: "brazil" } }
);

assert.throws(() => regionRequest({ id: "456", isPrivateCall: true }, null));

// -- auto-apply rule ------------------------------------------------------
const base = {
    preferred: "brazil",
    isPrivateCall: true,
    currentRegion: "us-east",
    canManageChannel: false,
    applyToCalls: true,
    applyToGuildChannels: false
};

const verdict = i => autoApplyVerdict({ ...base, ...i });

assert.equal(verdict({}).apply, true, "call on the wrong region should move");
assert.equal(verdict({ preferred: AUTOMATIC }).apply, false, "Automatic means hands off");
assert.equal(verdict({ currentRegion: "brazil" }).apply, false, "already there, don't re-patch");
assert.equal(verdict({ applyToCalls: false }).apply, false, "calls opted out");

// The two everyday skips must stay quiet or chatty CALL_UPDATE events spam the console.
assert.equal(verdict({ preferred: AUTOMATIC }).quiet, true);
assert.equal(verdict({ currentRegion: "brazil" }).quiet, true);
// A skip the user would otherwise experience as "it silently did nothing" must not be quiet.
assert.ok(!verdict({ applyToCalls: false }).quiet);

const guild = { isPrivateCall: false, currentRegion: null };

assert.equal(verdict(guild).apply, false, "server channels are off by default");
assert.ok(/setting is off/.test(verdict(guild).reason));

assert.equal(verdict({ ...guild, applyToGuildChannels: true }).apply, false, "opted in but no permission");
assert.ok(/Manage Channel/.test(verdict({ ...guild, applyToGuildChannels: true }).reason));

assert.equal(verdict({ ...guild, applyToGuildChannels: true, canManageChannel: true }).apply, true);

// -- proxy settings parsing ----------------------------------------------
// A typo here sets --proxy-server at a dead bridge and Discord loses the network
// entirely, so anything unusable has to come back null instead.
assert.deepEqual(
    parseUpstream("203.0.113.10:11080", "someone:hunter2"),
    { host: "203.0.113.10", port: 11080, user: "someone", pass: "hunter2" }
);

// Passwords with colons in them are normal; hosts with colons are not.
assert.equal(parseUpstream("host:1080", "u:a:b").pass, "a:b");

assert.deepEqual(parseUpstream("host:1080", ""), { host: "host", port: 1080, user: "", pass: "" });
assert.equal(parseUpstream(" host : 1080 ", " user : pw").host, "host", "stray spaces are the likeliest typo");
assert.equal(parseUpstream("host", "").port, 1080, "no port means the SOCKS default");

assert.equal(parseUpstream("", "u:p"), null);
assert.equal(parseUpstream("host:not-a-port", "u:p"), null);
assert.equal(parseUpstream("host:70000", "u:p"), null);

console.log("ok");
