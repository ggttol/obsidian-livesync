import { EVENT_REQUEST_PERFORM_GC_V3, eventHub } from "@/common/events.ts";
import { $msg } from "@/common/translation";
import {
    createCoreSettingsAfterFullReset,
    createEditingSettingsAfterFullReset,
} from "@/serviceFeatures/setupObsidian/settingsReset.ts";
import { LOG_LEVEL_NOTICE, Logger } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { FlagFilesHumanReadable, FlagFilesOriginal } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { fireAndForget } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { visibleOnly, type PageFunctions } from "./SettingPane";
import { setButtonDestructiveState } from "./settingComponentStyles.ts";
export function paneMaintenance(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    const isRemoteLockedAndDeviceNotAccepted = () => !!this.core?.replicator?.remoteLockedAndDeviceNotAccepted;
    const isRemoteLocked = () => !!this.core?.replicator?.remoteLocked;
    // if (this.plugin?.replicator?.remoteLockedAndDeviceNotAccepted) {
    this.createEl(
        paneEl,
        "div",
        {
            text: "为了防止数据损坏，远端数据库已被锁定同步，因为此设备尚未标记为“已解决”。请备份您的仓库，重置本地数据库，然后选择“标记此设备为已解决”。此警告将持续显示，直到通过复制确认设备已解决。",
            cls: "op-warn",
        },
        (c) => {
            this.createEl(
                c,
                "button",
                {
                    text: "我已完成备份，标记此设备为已解决",
                    cls: "mod-warning",
                },
                (e) => {
                    e.addEventListener("click", () => {
                        fireAndForget(async () => {
                            await this.services.replication.markResolved();
                            this.requestPageRefresh();
                        });
                    });
                }
            );
        },
        visibleOnly(isRemoteLockedAndDeviceNotAccepted)
    );
    this.createEl(
        paneEl,
        "div",
        {
            text: "为了防止非预期的仓库损坏，远端数据库已被锁定同步。（此设备已标记为“已解决”）当您的所有设备都标记为已解决后，请解锁数据库。此警告将持续显示，直到通过复制确认设备已解决。",
            cls: "op-warn",
        },
        (c) =>
            this.createEl(
                c,
                "button",
                {
                    text: "我已准备好，解锁远程数据库",
                    cls: "mod-warning",
                },
                (e) => {
                    e.addEventListener("click", () => {
                        fireAndForget(async () => {
                            await this.services.replication.markUnlocked();
                            this.requestPageRefresh();
                        });
                    });
                }
            ),
        visibleOnly(isRemoteLocked)
    );

    void addPanel(paneEl, "紧急停机保护 (Scram)").then((paneEl) => {
        new Setting(paneEl)
            .setName("锁定远程服务器")
            .setDesc("锁定远程服务器以阻止与其他设备同步，防止数据异常扩散。")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("立即锁定")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.services.replication.markLocked();
                    })
            )
            .addOnUpdate(this.onlyOnCouchDBOrMinIO);

        new Setting(paneEl)
            .setName("紧急安全重启")
            .setDesc("禁用所有同步进程并安全重启插件。")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("标记并重启")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.core.storageAccess.writeFileAuto(FlagFilesOriginal.SUSPEND_ALL, "");
                        this.services.appLifecycle.performRestart();
                    })
            );
    });

    void addPanel(paneEl, "重置同步数据与缓存").then((paneEl) => {
        new Setting(paneEl)
            .setName("重置此设备的同步缓存")
            .setDesc("清空本机缓存数据库，并从远程服务器完整重新拉取数据（安全，推荐用于多端不同步时修复本机）。")
            .addButton((button) =>
                button
                    .setButtonText("安排并重启")
                    .setCta()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.core.storageAccess.writeFileAuto(FlagFilesHumanReadable.FETCH_ALL, "");
                        this.services.appLifecycle.performRestart();
                    })
            );
        new Setting(paneEl)
            .setName("⚠️ 用此设备的文件覆盖远程服务器数据")
            .setDesc("【极高危】以此设备本地文件为唯一基准，强行重建并覆盖远程数据库。若此设备缺少笔记，其他设备的对应笔记将被抹除！")
            .addButton((button) =>
                button
                    .setButtonText("安排并重启")
                    .setCta()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.core.storageAccess.writeFileAuto(FlagFilesHumanReadable.REBUILD_ALL, "");
                        this.services.appLifecycle.performRestart();
                    })
            );
    });

    void addPanel(paneEl, "同步数据调度", () => {}, this.onlyOnCouchDBOrMinIO).then((paneEl) => {
        new Setting(paneEl)
            .setName("重新推送数据块")
            .setDesc("将本地全部数据块重新推送至远程数据库。")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("发送数据块")
                    .setDisabled(false)
                    .onClick(async () => {
                        if (this.core.replicator instanceof LiveSyncCouchDBReplicator) {
                            await this.core.replicator.sendChunks(this.core.settings, undefined, true, 0);
                        }
                    })
            )
            .addOnUpdate(this.onlyOnCouchDB);

        new Setting(paneEl)
            .setName("Reset journal received history")
            .setDesc(
                "Initialise journal received history. On the next sync, every item except this device sent will be downloaded again."
            )
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("Reset received")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            receivedFiles: new Set(),
                            knownIDs: new Set(),
                        }));
                        Logger(`Journal received history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName("Reset journal sent history")
            .setDesc(
                "Initialise journal sent history. On the next sync, every item except this device received will be sent again."
            )
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("Reset sent history")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            lastLocalSeq: 0,
                            sentIDs: new Set(),
                            sentFiles: new Set(),
                        }));
                        Logger(`Journal sent history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);
    });
    void addPanel(paneEl, "数据库碎片整理与瘦身 V3 (测试版)", (e) => e, this.onlyOnCouchDB).then((paneEl) => {
        new Setting(paneEl)
            .setName("执行碎片整理与瘦身")
            .setDesc("清理数据库中无用的孤立数据块，减少数据库物理占用。")
            .addButton((button) =>
                button
                    .setButtonText("执行碎片整理")
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_PERFORM_GC_V3);
                    })
            );
    });
    // void addPanel(paneEl, "Garbage Collection (Beta2)", (e) => e, this.onlyOnP2POrCouchDB).then((paneEl) => {
    //     new Setting(paneEl)
    //         .setName("Scan garbage")
    //         .setDesc("Scan for garbage chunks in the database.")
    //         .addButton((button) =>
    //             button
    //                 .setButtonText("Scan")
    //                 // .setWarning()
    //                 .setDisabled(false)
    //                 .onClick(async () => {
    //                     await this.plugin
    //                         .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                         ?.trackChanges(false, true);
    //                 })
    //         )
    //         .addButton((button) =>
    //             button.setButtonText("Rescan").onClick(async () => {
    //                 await this.plugin
    //                     .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                     ?.trackChanges(true, true);
    //             })
    //         );
    //     new Setting(paneEl)
    //         .setName("Collect garbage")
    //         .setDesc("Remove all unused chunks from the local database.")
    //         .addButton((button) =>
    //             button
    //                 .setButtonText("Collect")
    //                 .setWarning()
    //                 .setDisabled(false)
    //                 .onClick(async () => {
    //                     await this.plugin
    //                         .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                         ?.performGC(true);
    //                 })
    //         );
    //     new Setting(paneEl)
    //         .setName("Commit File Deletion")
    //         .setDesc("Completely delete all deleted documents from the local database.")
    //         .addButton((button) =>
    //             button
    //                 .setButtonText("Delete")
    //                 .setWarning()
    //                 .setDisabled(false)
    //                 .onClick(async () => {
    //                     await this.plugin
    //                         .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                         ?.commitFileDeletion();
    //                 })
    //         );
    // });
    // void addPanel(paneEl, "Garbage Collection (Old and Experimental)", (e) => e, this.onlyOnP2POrCouchDB).then(
    //     (paneEl) => {
    //         new Setting(paneEl)
    //             .setName("Remove all orphaned chunks")
    //             .setDesc("Remove all orphaned chunks from the local database.")
    //             .addButton((button) =>
    //                 button
    //                     .setButtonText("Remove")
    //                     .setWarning()
    //                     .setDisabled(false)
    //                     .onClick(async () => {
    //                         await this.plugin
    //                             .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                             ?.removeUnusedChunks();
    //                     })
    //             );

    //         new Setting(paneEl)
    //             .setName("Resurrect deleted chunks")
    //             .setDesc(
    //                 "If you have deleted chunks before fully synchronised and missed some chunks, you possibly can resurrect them."
    //             )
    //             .addButton((button) =>
    //                 button
    //                     .setButtonText("Try resurrect")
    //                     .setWarning()
    //                     .setDisabled(false)
    //                     .onClick(async () => {
    //                         await this.plugin
    //                             .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                             ?.resurrectChunks();
    //                     })
    //             );
    //     }
    // );

    void addPanel(paneEl, "Rebuilding Operations (Remote Only)", () => {}, this.onlyOnCouchDBOrMinIO).then((paneEl) => {
        new Setting(paneEl)
            .setName("压缩与清理冗余版本")
            .setDesc("通过丢弃非最新版本历史来减少服务器存储空间。请确保服务器与本机有足够的剩余空间。")
            .addButton((button) =>
                button
                    .setButtonText("立即执行")
                    .setDisabled(false)
                    .onClick(async () => {
                        const replicator = this.core.replicator as LiveSyncCouchDBReplicator;
                        Logger(`Cleanup has been began`, LOG_LEVEL_NOTICE, "compaction");
                        if (await replicator.compactRemote(this.editingSettings)) {
                            Logger(`Cleanup has been completed!`, LOG_LEVEL_NOTICE, "compaction");
                        } else {
                            Logger(`Cleanup has been failed!`, LOG_LEVEL_NOTICE, "compaction");
                        }
                    })
            )
            .addOnUpdate(this.onlyOnCouchDB);

        new Setting(paneEl)
            .setName("强制覆盖远程数据库")
            .setDesc("使用本地数据库及其加密密码完全覆盖远程数据库（高危操作）。")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("覆盖发送")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.rebuildDB("remoteOnly");
                    })
            );

        new Setting(paneEl)
            .setName("Reset all journal counter")
            .setDesc("Initialise all journal history, On the next sync, every item will be received and sent.")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("Reset all")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().resetCheckpointInfo();
                        Logger(`Journal exchange history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName("Purge all journal counter")
            .setDesc("Purge all download/upload cache.")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("Reset all")
                    .setDisabled(false)
                    .onClick(() => {
                        this.getMinioJournalSyncClient().resetAllCaches();
                        Logger(`Journal download/upload cache has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName("Fresh Start Wipe")
            .setDesc("Delete all data on the remote server.")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("Delete")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            receivedFiles: new Set(),
                            knownIDs: new Set(),
                            lastLocalSeq: 0,
                            sentIDs: new Set(),
                            sentFiles: new Set(),
                        }));
                        const reset = await this.resetRemoteBucket();
                        Logger(
                            reset
                                ? `Deleted all data on remote server`
                                : `Fresh Start Wipe did not complete. Keep all synchronising devices stopped and run it again.`,
                            LOG_LEVEL_NOTICE
                        );
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);
    });

    void addPanel(paneEl, "Reset").then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameDiscardSettings"))
            .addButton((button) => {
                setButtonDestructiveState(button)
                    .setButtonText($msg("obsidianLiveSyncSettingTab.btnDiscard"))
                    .onClick(async () => {
                        if (
                            (await this.core.confirm.askYesNoDialog(
                                $msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"),
                                { defaultOption: "No" }
                            )) !== "yes"
                        ) {
                            return;
                        }
                        this.editingSettings = createEditingSettingsAfterFullReset(this.editingSettings);
                        await this.saveAllDirtySettings();
                        this.core.settings = createCoreSettingsAfterFullReset();
                        await this.services.setting.saveSettingData();
                        await this.services.database.resetDatabase();
                        this.services.appLifecycle.askRestart();
                    });
            })
            .addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", true)));

        new Setting(paneEl)
            .setName("删除本地数据库（用于彻底重置或卸载插件）")
            .addButton((button) =>
                setButtonDestructiveState(button)
                    .setButtonText("确认删除")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.services.database.resetDatabase();
                        if (!(await this.services.databaseEvents.initialiseDatabase())) {
                            Logger($msg("Ui.Common.LocalDatabaseInitialisationFailed"), LOG_LEVEL_NOTICE);
                        }
                    })
            );
    });
}
