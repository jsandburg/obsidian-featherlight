import {
    App,
    PluginSettingTab,
    SettingDefinitionItem,
    SettingDefinitionList,
    normalizePath,
} from "obsidian";
import type FeatherlightPlugin from "./main";

export type LimitType = "140" | "280" | "custom";

export interface FeatherlightSettings {
    /** Which limit is in effect: a preset, or the custom number below. */
    limitType: LimitType;
    /** Used only when limitType is "custom". */
    customLimit: number;
    /** Empty array means "apply everywhere". */
    watchedFolders: string[];
    /** Never limited, even inside a limited folder. */
    excludedFolders: string[];
    /** Whether the frontmatter block counts toward the limit. */
    countProperties: boolean;
}

/** The settings keys that hold a list of folders. */
type FolderListKey = "watchedFolders" | "excludedFolders";

export const DEFAULT_SETTINGS: FeatherlightSettings = {
    limitType: "280",
    customLimit: 500,
    watchedFolders: [],
    excludedFolders: [],
    countProperties: true,
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
        const match = /^(watchedFolders|excludedFolders)\.(\d+)$/.exec(key);
        if (match) return this.plugin.settings[match[1] as FolderListKey][Number(match[2])];
        return this.plugin.settings[key as keyof FeatherlightSettings];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        const match = /^(watchedFolders|excludedFolders)\.(\d+)$/.exec(key);
        if (match) {
            // Store the raw trimmed value. Do NOT normalizePath() here:
            // normalizePath("") returns "/", which would survive the blank
            // filter and silently apply the limit everywhere. Paths are
            // normalized at comparison time instead (see isInWatchedFolder).
            this.plugin.settings[match[1] as FolderListKey][Number(match[2])] =
                typeof value === "string" ? value.trim() : "";
        } else {
            (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
        }
        await this.plugin.saveSettings();
        this.plugin.refreshCounter();
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: "",
                desc: "Keep your notes light. The character counter appears in the bottom status bar.",
                searchable: false,
            },
            this.folderList({
                key: "watchedFolders",
                heading: "Limited folders",
                emptyState:
                    "No folders listed — the character limit applies to every note in the " +
                    "vault. Add a folder (e.g. \"Tweets\") to limit only the notes inside it.",
                placeholder: "e.g. Tweets",
                rootError: "To limit every note, leave this list empty.",
            }),
            this.folderList({
                key: "excludedFolders",
                heading: "Excluded folders",
                emptyState:
                    "No folders excluded. Add a folder (e.g. \"Drafts\") to lift the limit " +
                    "from the notes inside it, even when it's inside a limited folder.",
                placeholder: "e.g. Drafts",
                rootError: "To turn the limit off everywhere, disable Featherlight instead.",
            }),
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
                        control: {
                            type: "dropdown",
                            key: "limitType",
                            options: {
                                "140": "140 — classic tweet (2006–2017)",
                                "280": "280 — modern tweet (2017–2022)",
                                custom: "Custom",
                            },
                        },
                    },
                    {
                        name: "Custom limit",
                        desc: "Enter any positive whole number.",
                        visible: () => this.plugin.settings.limitType === "custom",
                        control: {
                            type: "number",
                            key: "customLimit",
                            placeholder: "E.g. 500",
                            min: 1,
                            step: 1,
                            defaultValue: DEFAULT_SETTINGS.customLimit,
                            validate: (value) =>
                                Number.isInteger(value) ? undefined : "Enter a whole number.",
                        },
                    },
                    {
                        name: "Count properties",
                        desc:
                            "Include the note's properties (its YAML frontmatter) in the count. " +
                            "Turn this off so properties, including char-limit itself, don't " +
                            "use up the limit.",
                        control: { type: "toggle", key: "countProperties" },
                    },
                ],
            },
        ];
    }

    /** A list of vault folders stored under the given settings key. */
    folderList(options: {
        key: FolderListKey;
        heading: string;
        emptyState: string;
        placeholder: string;
        /** Shown when the vault root is picked. */
        rootError: string;
    }): SettingDefinitionList {
        // Closures read the array from settings each time: renaming a folder
        // replaces it (see updateFolderPaths), so a captured copy goes stale.
        const folders = () => this.plugin.settings[options.key];

        return {
            type: "list",
            heading: options.heading,
            emptyState: options.emptyState,
            addItem: {
                name: "Add folder",
                action: () => {
                    folders().push("");
                    void this.plugin.saveSettings();
                    this.update();
                },
            },
            onDelete: (index: number) => {
                folders().splice(index, 1);
                void this.plugin.saveSettings();
                this.update();
                this.plugin.refreshCounter();
            },
            items: folders().map((_folder, index) => ({
                name: `Folder ${index + 1}`,
                searchable: false,
                // Persisted through getControlValue/setControlValue above,
                // which map the indexed key onto the folder array.
                // The folder control provides a vault-folder suggester.
                control: {
                    type: "folder" as const,
                    key: `${options.key}.${index}`,
                    placeholder: options.placeholder,
                    // Runs on every change; only a value that passes is saved,
                    // so a folder that doesn't exist is never stored
                    validate: (value: string) => {
                        const path = value.trim();
                        if (!path) return; // blank row, ignored until filled in
                        const folder = this.app.vault.getFolderByPath(normalizePath(path));
                        if (!folder) return "No folder with this name exists in your vault.";
                        if (folder.isRoot()) return options.rootError;
                    },
                },
            })),
        };
    }
}
