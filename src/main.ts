import {
    Editor,
    Plugin,
    TFile,
    TFolder,
    editorInfoField,
    getFrontMatterInfo,
    normalizePath,
} from "obsidian";
import { EditorState, Transaction } from "@codemirror/state";
import {
    DEFAULT_SETTINGS,
    FeatherlightSettings,
    FeatherlightSettingTab,
} from "./settings";

/**
 * Splits text into user-perceived characters (graphemes), so an emoji built
 * from several code points — 👨‍👩‍👧, 👍🏽, ❤️, a flag — or a letter with a
 * combining accent counts as one character.
 */
const graphemes = new Intl.Segmenter();

export default class FeatherlightPlugin extends Plugin {
    settings: FeatherlightSettings;
    statusBarItem: HTMLElement;

    async onload() {
        await this.loadSettings();

        // Create the character counter in the bottom status bar
        this.statusBarItem = this.addStatusBarItem();
        this.app.workspace.onLayoutReady(() => this.refreshCounter());

        // Register a CodeMirror extension that blocks new input at the limit.
        // It allows deletions and selections freely — only additive changes are blocked.
        this.registerEditorExtension(
            EditorState.transactionFilter.of((tr: Transaction) => {
                if (!tr.docChanged) return tr; // selection-only change, always allow
                // "set" is Obsidian reloading the note after it changed on disk
                // (sync, git, another plugin). Blocking it would leave the editor
                // out of date, and the next save would overwrite those changes.
                if (tr.isUserEvent("set")) return tr;

                // Use the file this editor belongs to, not the active file: the
                // transaction may come from a background pane or an embed.
                const file = tr.startState.field(editorInfoField, false)?.file ?? null;
                if (!this.isLimited(file)) return tr; // outside the limited folders, always allow

                const limit = this.getLimit(file);
                // A character is at least one UTF-16 code unit, and skipping
                // properties only lowers the count, so a note this short can't
                // be over the limit: skip counting it
                if (tr.newDoc.length <= limit) return tr;
                const newLength = this.count(tr.newDoc.toString());

                // If the new content would exceed the limit and it's longer than before, block it
                if (newLength > limit && newLength > this.count(tr.startState.doc.toString())) {
                    return []; // returning an empty array cancels the transaction
                }

                return tr;
            })
        );

        // Update the counter whenever the note content changes
        this.registerEvent(
            this.app.workspace.on("editor-change", (editor: Editor) => {
                this.refreshCounter(this.count(editor.getValue()));
            })
        );

        // Update the counter when you switch to a different note
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                this.refreshCounter();
            })
        );

        // Update the counter when the active note's char-limit property changes
        // (the metadata cache updates after editor-change has already fired)
        // or when it is moved into or out of a watched folder
        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                if (file === this.app.workspace.getActiveFile()) this.refreshCounter();
            })
        );
        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {
                // Keep limited and excluded folders pointing at the same folder
                // after it is renamed or moved, so the setting doesn't silently
                // stop applying to it
                if (file instanceof TFolder) {
                    await this.updateFolderPaths(oldPath, file.path);
                    this.refreshCounter();
                } else if (file === this.app.workspace.getActiveFile()) {
                    this.refreshCounter();
                }
            })
        );

        // Add the Settings tab so users can change the limit
        this.addSettingTab(new FeatherlightSettingTab(this.app, this));
    }

    /**
     * True when the file is inside any of the watched folders.
     * If no folders are configured, always returns true so the plugin
     * applies everywhere.
     */
    isInWatchedFolder(file: TFile | null): boolean {
        const folders = (this.settings.watchedFolders || []).filter((f) => f.trim());
        if (folders.length === 0) return true; // no folders set → apply everywhere

        if (!file) return false;

        // normalizePath ensures consistent slashes; the trailing slash prevents
        // "Tweets" from matching "Tweets Archive"
        return folders.some((folder) =>
            file.path.startsWith(normalizePath(folder.trim()) + "/")
        );
    }

    /** True when the file is inside any of the excluded folders. */
    isInExcludedFolder(file: TFile | null): boolean {
        if (!file) return false;
        return this.settings.excludedFolders
            .filter((f) => f.trim())
            .some((folder) => file.path.startsWith(normalizePath(folder.trim()) + "/"));
    }

    /**
     * True when the limit applies to the file: it is in a limited folder (or
     * none are set) and not in an excluded folder. Excluded folders win, so a
     * subfolder of a limited folder can be excluded.
     */
    isLimited(file: TFile | null): boolean {
        return this.isInWatchedFolder(file) && !this.isInExcludedFolder(file);
    }

    /**
     * Rewrites limited and excluded folders after a folder is renamed or moved
     * from oldPath to newPath. Covers the folder itself and folders inside it.
     */
    async updateFolderPaths(oldPath: string, newPath: string): Promise<void> {
        let changed = false;
        const update = (folders: string[]) => folders.map((folder) => {
            if (!folder.trim()) return folder; // blank row
            const path = normalizePath(folder.trim());
            if (path === oldPath) {
                changed = true;
                return newPath;
            }
            if (path.startsWith(oldPath + "/")) {
                changed = true;
                return newPath + path.slice(oldPath.length);
            }
            return folder;
        });
        this.settings.watchedFolders = update(this.settings.watchedFolders);
        this.settings.excludedFolders = update(this.settings.excludedFolders);
        if (changed) await this.saveSettings();
    }

    /**
     * The number of characters in text, as the limit counts them. With
     * countProperties off, the frontmatter block is skipped. It's found in
     * the text itself, so it's right even before the metadata cache updates.
     */
    count(text: string): number {
        const counted = this.settings.countProperties
            ? text
            : text.slice(getFrontMatterInfo(text).contentStart);
        return Array.from(graphemes.segment(counted)).length;
    }

    /**
     * The character limit in effect for a file. A per-note frontmatter property
     * (char-limit: 500) takes priority over the global setting, so each note
     * can have its own limit.
     */
    getLimit(file: TFile | null): number {
        if (file) {
            const cache = this.app.metadataCache.getFileCache(file);
            const perNote: unknown = cache?.frontmatter?.["char-limit"];
            if (typeof perNote === "number" && perNote > 0) return perNote;
        }
        // Fall back to the global setting
        if (this.settings.limitType === "140") return 140;
        if (this.settings.limitType === "280") return 280;
        return this.settings.customLimit;
    }

    /**
     * Shows or hides the counter for the current context and updates its value.
     * Pass charCount when the caller already knows it (editor-change);
     * otherwise it is read from the active editor.
     */
    refreshCounter(charCount?: number): void {
        const active = this.app.workspace.activeEditor;
        const file = active?.file ?? null;
        // Hide when no note is being edited (PDF, graph, empty tab…) or the
        // note is outside the limited folders
        if (!active?.editor || !this.isLimited(file)) {
            this.statusBarItem.hide();
            return;
        }
        this.statusBarItem.show();
        this.updateStatusBar(charCount ?? this.count(active.editor.getValue()), this.getLimit(file));
    }

    /** Updates the status bar text and color for the given character count. */
    updateStatusBar(charCount: number, limit: number): void {
        const remaining = limit - charCount;

        // Within 10% of the limit (or the last 10 characters) counts as "warning"
        const warning = remaining <= Math.max(10, Math.floor(limit * 0.1));

        if (remaining < 0) {
            // Over the limit (e.g. the limit was lowered) — trim to continue
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · ${-remaining} over`);
        } else if (remaining === 0) {
            // Exactly at the limit — hard stop message
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · limit reached`);
        } else {
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · ${remaining} left`);
        }
        this.statusBarItem.toggleClass("featherlight-ok", remaining > 0 && !warning);
        this.statusBarItem.toggleClass("featherlight-warning", remaining > 0 && warning);
        this.statusBarItem.toggleClass("featherlight-limit", remaining <= 0);
    }

    async loadSettings() {
        const data = (await this.loadData()) as Partial<FeatherlightSettings> | null;
        // Copy the default arrays so pushing a folder never mutates DEFAULT_SETTINGS
        this.settings = { ...DEFAULT_SETTINGS, watchedFolders: [], excludedFolders: [], ...data };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
