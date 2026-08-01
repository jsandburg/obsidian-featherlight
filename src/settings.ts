import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type FeatherlightPlugin from "./main";

export type LimitType = "140" | "280" | "custom";

export interface FeatherlightSettings {
    /** Which limit is in effect: a preset, or the custom number below. */
    limitType: LimitType;
    /** Used only when limitType is "custom". */
    customLimit: number;
    /** Empty array means "apply everywhere". */
    watchedFolders: string[];
}

export const DEFAULT_SETTINGS: FeatherlightSettings = {
    limitType: "280",
    customLimit: 500,
    watchedFolders: [],
};

export class FeatherlightSettingTab extends PluginSettingTab {
    plugin: FeatherlightPlugin;

    constructor(app: App, plugin: FeatherlightPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // The folder-list controls use indexed keys ("watchedFolders.0"); resolve
    // them onto the array. Other keys fall through to the settings object.
    getControlValue(key: string): unknown {
        const match = /^watchedFolders\.(\d+)$/.exec(key);
        if (match) return this.plugin.settings.watchedFolders[Number(match[1])];
        return this.plugin.settings[key as keyof FeatherlightSettings];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        const match = /^watchedFolders\.(\d+)$/.exec(key);
        if (match) {
            // Store the raw trimmed value. Do NOT normalizePath() here:
            // normalizePath("") returns "/", which would survive the blank
            // filter and silently apply the limit everywhere. Paths are
            // normalized at comparison time instead (see isInWatchedFolder).
            this.plugin.settings.watchedFolders[Number(match[1])] =
                typeof value === "string" ? value.trim() : "";
        } else {
            (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
        }
        await this.plugin.saveSettings();
        this.plugin.refreshCounter();
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const folders = this.plugin.settings.watchedFolders || [];

        return [
            {
                name: "",
                desc: "Keep your notes light. The character counter appears in the bottom status bar.",
                searchable: false,
            },
            {
                type: "list",
                heading: "Watched folders",
                emptyState:
                    "No folders listed — the character limit applies to every note in the " +
                    "vault. Add a folder (exactly as it appears in your vault, e.g. " +
                    "\"Tweets\") to limit only the notes inside it.",
                addItem: {
                    name: "Add folder",
                    action: () => {
                        this.plugin.settings.watchedFolders.push("");
                        void this.plugin.saveSettings();
                        this.update();
                    },
                },
                onDelete: (index: number) => {
                    this.plugin.settings.watchedFolders.splice(index, 1);
                    void this.plugin.saveSettings();
                    this.update();
                    this.plugin.refreshCounter();
                },
                items: folders.map((_folder, index) => ({
                    name: `Folder ${index + 1}`,
                    searchable: false,
                    // Persisted through getControlValue/setControlValue above,
                    // which map the indexed key onto the watchedFolders array.
                    // The folder control provides a vault-folder suggester.
                    control: {
                        type: "folder" as const,
                        key: `watchedFolders.${index}`,
                        placeholder: "e.g. Tweets",
                    },
                })),
            },
            {
                type: "group",
                heading: "Character limit",
                items: [
                    {
                        name: "",
                        desc:
                            "Set a global default below. To override the limit for a specific " +
                            "note, add char-limit: 500 (or any number) to that note's YAML " +
                            "frontmatter. The per-note value always takes priority over the " +
                            "global setting.",
                        searchable: false,
                    },
                    {
                        name: "Limit preset",
                        desc: "Choose a Twitter-era preset or define your own.",
                        render: (setting: Setting) => {
                            setting.addDropdown((drop) =>
                                drop
                                    .addOption("140", "140 — classic tweet (2006–2017)")
                                    .addOption("280", "280 — modern tweet (2017–2022)")
                                    .addOption("custom", "Custom")
                                    .setValue(this.plugin.settings.limitType)
                                    .onChange(async (value) => {
                                        this.plugin.settings.limitType = value as LimitType;
                                        await this.plugin.saveSettings();
                                        this.update(); // show/hide the custom field
                                        this.plugin.refreshCounter();
                                    })
                            );
                        },
                    },
                    {
                        name: "Custom limit",
                        desc: "Enter any positive number.",
                        visible: () => this.plugin.settings.limitType === "custom",
                        render: (setting: Setting) => {
                            setting.addText((text) =>
                                text
                                    .setPlaceholder("E.g. 500")
                                    .setValue(String(this.plugin.settings.customLimit))
                                    .onChange(async (value) => {
                                        const num = parseInt(value, 10);
                                        if (!isNaN(num) && num > 0) {
                                            this.plugin.settings.customLimit = num;
                                            await this.plugin.saveSettings();
                                            this.plugin.refreshCounter();
                                        }
                                    })
                            );
                        },
                    },
                ],
            },
        ];
    }
}
