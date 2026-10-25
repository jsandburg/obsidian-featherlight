import {
    App,
    FuzzySuggestModal,
    PluginSettingTab,
    SettingDefinitionItem,
    SettingDefinitionList,
    TFolder,
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

/** Lets you pick a vault folder from a searchable list. */
class FolderPickerModal extends FuzzySuggestModal<TFolder> {
    /** Paths not to offer, because they're already in the list. */
    taken: string[];
    onPick: (folder: TFolder) => void;

    constructor(app: App, placeholder: string, taken: string[], onPick: (folder: TFolder) => void) {
        super(app);
        this.taken = taken;
        this.onPick = onPick;
        this.setPlaceholder(placeholder);
    }

    getItems(): TFolder[] {
        // The vault root isn't offered: limiting it is what an empty limited
        // list already does, and excluding it would turn the plugin off
        return this.app.vault.getAllFolders(false).filter((folder) => !this.taken.includes(folder.path));
    }

    getItemText(folder: TFolder): string {
        return folder.path;
    }

    onChooseItem(folder: TFolder): void {
        this.onPick(folder);
    }
}

export class FeatherlightSettingTab extends PluginSettingTab {
    plugin: FeatherlightPlugin;

    constructor(app: App, plugin: FeatherlightPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getControlValue(key: string): unknown {
        return this.plugin.settings[key as keyof FeatherlightSettings];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
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
                placeholder: "Choose a folder to limit",
            }),
            this.folderList({
                key: "excludedFolders",
                heading: "Excluded folders",
                emptyState:
                    "No folders excluded. Add a folder (e.g. \"Drafts\") to lift the limit " +
                    "from the notes inside it, even when it's inside a limited folder.",
                placeholder: "Choose a folder to exclude",
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
                                Number.isInteger(value) && value >= 1
                                    ? undefined
                                    : "Enter a whole number of 1 or more.",
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

    /**
     * A list of vault folders stored under the given settings key. Each row is
     * the folder's path; the add button opens a picker of the vault's folders.
     */
    folderList(options: {
        key: FolderListKey;
        heading: string;
        emptyState: string;
        /** Shown in the folder picker's search box. */
        placeholder: string;
    }): SettingDefinitionList {
        // Closures read the array from settings each time: renaming a folder
        // replaces it (see updateFolderPaths), so a captured copy goes stale.
        const folders = () => this.plugin.settings[options.key];
        const changed = () => {
            void this.plugin.saveSettings();
            this.update();
            this.plugin.refreshCounter();
        };

        return {
            type: "list",
            heading: options.heading,
            emptyState: options.emptyState,
            addItem: {
                name: "Add folder",
                action: () => {
                    const taken = folders().map((path) => normalizePath(path));
                    new FolderPickerModal(this.app, options.placeholder, taken, (folder) => {
                        folders().push(folder.path);
                        changed();
                    }).open();
                },
            },
            onDelete: (index: number) => {
                folders().splice(index, 1);
                changed();
            },
            items: folders().map((path) => ({
                name: path,
                // A folder that was deleted, or renamed outside Obsidian, stays
                // listed so you can see it and remove it
                desc: this.app.vault.getFolderByPath(normalizePath(path))
                    ? undefined
                    : "This folder isn't in your vault.",
                searchable: false,
            })),
        };
    }
}
