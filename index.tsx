/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { CallStore, ChannelStore, Menu, PermissionsBits, PermissionStore, RestAPI, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import {
    autoApplyVerdict, regionOptions, regionRequest, RegionTarget, setRegionOptions, VoiceRegion
} from "./regions";

/** Flux sends these snake_case, unlike the camelCase channel records. */
interface CallEvent {
    channel_id: string;
    region?: string;
}

interface VoiceStateChangeEvent {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
}

let regions: VoiceRegion[] = [];

const settings = definePluginSettings({
    region: {
        type: OptionType.SELECT,
        description: "Region to put every voice channel and call on. Automatic leaves Discord in charge.",
        options: regionOptions
    },
    applyToCalls: {
        type: OptionType.BOOLEAN,
        description: "Apply it to DM and group calls",
        default: true
    },
    applyToGuildChannels: {
        type: OptionType.BOOLEAN,
        description: "Apply it to server voice channels too. Needs Manage Channel, and changes the region for everyone in that channel, which is logged in the audit log.",
        default: false
    },
    proxy: {
        type: OptionType.BOOLEAN,
        description: "Route Discord's API traffic through the SOCKS5 proxy below, so regional blocks (like the screenshare guard) don't apply. Voice audio still goes direct. Does nothing until you fill in a server.",
        default: true,
        restartNeeded: true
    },
    proxyServer: {
        type: OptionType.STRING,
        description: "The SOCKS5 proxy to relay through, as host:port. Empty means no proxy: Discord connects directly.",
        default: "",
        restartNeeded: true
    },
    proxyAuth: {
        type: OptionType.STRING,
        description: "Login for that proxy, as user:password. Leave empty if it doesn't need one.",
        default: "",
        restartNeeded: true
    }
});

async function loadRegions() {
    try {
        const { body } = await RestAPI.get({ url: "/voice/regions" });
        regions = (body as VoiceRegion[]).filter(r => !r.deprecated);
        setRegionOptions(regions);
    } catch (err) {
        console.error("[RegionSwapper] could not load the voice region list, keeping the built-in one", err);
    }
}

function nameOf(id: string) {
    return regions.find(r => r.id === id)?.name ?? id;
}

async function swap(target: RegionTarget, region: string | null, label: string) {
    try {
        await RestAPI.patch(regionRequest(target, region));
        showToast(`Voice region: ${label}`, Toasts.Type.SUCCESS);
    } catch (err: any) {
        showToast(err?.body?.message ?? "Couldn't switch region", Toasts.Type.FAILURE);
    }
}

function canManage(channel: any) {
    const bit = PermissionsBits?.MANAGE_CHANNELS;
    if (bit == null) {
        console.error("[RegionSwapper] PermissionsBits.MANAGE_CHANNELS is missing, Discord may have renamed it");
        return false;
    }
    return PermissionStore.can(bit, channel);
}

/** Read the region a channel is currently on, or undefined if it has none yet. */
function currentRegionOf(channel: any, isPrivateCall: boolean) {
    return isPrivateCall
        ? CallStore?.getCall?.(channel.id)?.region
        : channel.rtcRegion;
}

function autoApply(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;

    const isPrivateCall = channel.isPrivate();
    // A DM has no region until the call object exists. The CALL_* events below fire
    // once it does, so bailing here just means we apply a moment later.
    if (isPrivateCall && !CallStore?.getCall?.(channelId)) return;
    if (!isPrivateCall && !channel.isGuildVoice() && !channel.isGuildStageVoice()) return;

    const { region: preferred, applyToCalls, applyToGuildChannels } = settings.store;

    const verdict = autoApplyVerdict({
        preferred,
        isPrivateCall,
        currentRegion: currentRegionOf(channel, isPrivateCall),
        canManageChannel: !isPrivateCall && canManage(channel),
        applyToCalls,
        applyToGuildChannels
    });

    if (!verdict.apply) {
        // Everyday skips stay silent; the rest explain themselves, because otherwise
        // "nothing happened" is indistinguishable from "the plugin is broken".
        if (!verdict.quiet) console.log(`[RegionSwapper] left #${channel.name ?? channelId} alone: ${verdict.reason}`);
        return;
    }

    swap({ id: channelId, isPrivateCall }, preferred, nameOf(preferred));
}

const patchContextMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: any; }) => {
    if (!channel) return;

    // A DM only has a region while a call is up; a guild voice channel always does,
    // but only staff can move it.
    const isPrivateCall = channel.isPrivate();
    if (isPrivateCall) {
        if (!CallStore?.getCall?.(channel.id)) return;
    } else {
        if (!channel.isGuildVoice() && !channel.isGuildStageVoice()) return;
        if (!canManage(channel)) return;
    }

    const current = currentRegionOf(channel, isPrivateCall);
    const target: RegionTarget = { id: channel.id, isPrivateCall };

    children.push(
        <Menu.MenuItem id="vc-region-swapper" label="Voice Region">
            {!isPrivateCall && (
                <Menu.MenuRadioItem
                    group="vc-region-swapper"
                    id="vc-region-auto"
                    label="Automatic"
                    checked={current == null}
                    action={() => swap(target, null, "Automatic")}
                />
            )}
            {regions.map(r => (
                <Menu.MenuRadioItem
                    key={r.id}
                    group="vc-region-swapper"
                    id={`vc-region-${r.id}`}
                    label={r.optimal ? `${r.name} (Discord's pick)` : r.name}
                    checked={current === r.id}
                    action={() => swap(target, r.id, r.name)}
                />
            ))}
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "RegionSwapper",
    description: "Pick one voice region in settings and have every call and voice channel you join move to it, so you get a low-ping voice server without routing your whole connection through a VPN.",
    authors: [{ name: "ipedrax", id: 0n }],
    tags: ["Voice"],
    settings,

    async start() {
        await loadRegions();

        // Catch whatever we're already sitting in, so enabling the plugin
        // mid-call works without having to rejoin.
        const current = SelectedChannelStore.getVoiceChannelId();
        if (current) autoApply(current);
    },

    flux: {
        // Guild voice joins and moves.
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceStateChangeEvent[]; }) {
            const myId = UserStore.getCurrentUser()?.id;
            if (!myId) return;

            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (userId !== myId) continue;
                if (!channelId || channelId === oldChannelId) continue;
                autoApply(channelId);
            }
        },

        // DM and group calls. CALL_UPDATE is chatty, but shouldAutoApply turns every
        // repeat into a no-op once the region already matches.
        CALL_CREATE({ call }: { call: CallEvent; }) {
            autoApply(call.channel_id);
        },
        CALL_UPDATE({ call }: { call: CallEvent; }) {
            autoApply(call.channel_id);
        }
    },

    contextMenus: {
        "channel-context": patchContextMenu,
        "user-context": patchContextMenu,
        "gdm-context": patchContextMenu
    }
});
