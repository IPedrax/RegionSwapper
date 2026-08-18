/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** One entry of `GET /voice/regions`. */
export interface VoiceRegion {
    id: string;
    name: string;
    /** Discord's own guess at the lowest-latency region for you. */
    optimal: boolean;
    deprecated: boolean;
    custom: boolean;
}

export interface RegionTarget {
    id: string;
    /** DM or group DM call. Guild voice/stage channels use a different endpoint. */
    isPrivateCall: boolean;
}

export interface SelectOption {
    label: string;
    value: string;
    default?: boolean;
}

/** Empty string is the "leave Discord in charge" value, so it must sort first. */
export const AUTOMATIC = "";

/**
 * Seed for the settings dropdown, replaced in place by the live `/voice/regions`
 * list on start. Only here so the dropdown is usable if that request ever fails.
 */
export const regionOptions: SelectOption[] = [
    { label: "Automatic (don't auto-switch)", value: AUTOMATIC, default: true },
    { label: "Brazil", value: "brazil" },
    { label: "US East", value: "us-east" },
    { label: "US Central", value: "us-central" },
    { label: "US South", value: "us-south" },
    { label: "US West", value: "us-west" },
    { label: "Rotterdam", value: "rotterdam" },
    { label: "Singapore", value: "singapore" },
    { label: "Japan", value: "japan" },
    { label: "Sydney", value: "sydney" }
];

/** Swap the dropdown contents for the live list without breaking the array identity. */
export function setRegionOptions(live: VoiceRegion[]) {
    regionOptions.splice(1, regionOptions.length - 1,
        ...live.map(r => ({ label: r.optimal ? `${r.name} (Discord's pick)` : r.name, value: r.id })));
}

/**
 * Pure: which REST call moves `target` onto `region`.
 * `region === null` means "Automatic", which only guild channels support.
 */
export function regionRequest(target: RegionTarget, region: string | null) {
    if (target.isPrivateCall) {
        if (region === null) throw new Error("a call always has a concrete region, there is no Automatic");
        return { url: `/channels/${target.id}/call`, body: { region } };
    }

    return { url: `/channels/${target.id}`, body: { rtc_region: region } };
}

export interface AutoApplyInput {
    /** The globally preferred region. `AUTOMATIC` means auto-switching is off. */
    preferred: string;
    isPrivateCall: boolean;
    currentRegion: string | null | undefined;
    canManageChannel: boolean;
    applyToCalls: boolean;
    applyToGuildChannels: boolean;
}

export type AutoApplyVerdict =
    | { apply: true; }
    /** `quiet` marks the boring everyday skips, so the console only sees the surprising ones. */
    | { apply: false; reason: string; quiet?: boolean; };

/**
 * Pure: should joining this channel trigger a swap, and if not, why not?
 *
 * The `currentRegion` check is what makes this safe to call from chatty flux events:
 * once the channel already sits on the preferred region every repeat is a no-op.
 */
export function autoApplyVerdict(i: AutoApplyInput): AutoApplyVerdict {
    if (i.preferred === AUTOMATIC) return { apply: false, reason: "region is set to Automatic", quiet: true };
    if (i.currentRegion === i.preferred) return { apply: false, reason: "already on the preferred region", quiet: true };

    if (i.isPrivateCall) {
        return i.applyToCalls
            ? { apply: true }
            : { apply: false, reason: "the 'apply to DM and group calls' setting is off" };
    }

    if (!i.applyToGuildChannels) return { apply: false, reason: "the 'apply to server voice channels' setting is off" };
    if (!i.canManageChannel) {
        return {
            apply: false,
            reason: "you don't have Manage Channel in this server. A server voice channel's region is a channel setting, so only staff can change it - no client mod can work around that"
        };
    }

    return { apply: true };
}
