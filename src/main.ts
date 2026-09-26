import { Editor, Plugin, TFile, editorInfoField, normalizePath } from "obsidian";
import { EditorState, Transaction } from "@codemirror/state";
import {
    DEFAULT_SETTINGS,
    FeatherlightSettings,
    FeatherlightSettingTab,
} from "./settings";

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
                if (!this.isInWatchedFolder(file)) return tr; // outside watched folder, always allow

                const limit = this.getLimit(file);
                const newLength = tr.newDoc.length;

                // If the new content would exceed the limit and it's longer than before, block it
                if (newLength > limit && newLength > tr.startState.doc.length) {
                    return []; // returning an empty array cancels the transaction
                }

                return tr;
            })
        );

        // Update the counter whenever the note content changes
        this.registerEvent(
            this.app.workspace.on("editor-change", (editor: Editor) => {
                this.refreshCounter(editor.getValue().length);
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
            this.app.vault.on("rename", (file) => {
                if (file === this.app.workspace.getActiveFile()) this.refreshCounter();
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
        // note is outside the watched folders
        if (!active?.editor || !this.isInWatchedFolder(file)) {
            this.statusBarItem.hide();
            return;
        }
        this.statusBarItem.show();
        this.updateStatusBar(charCount ?? active.editor.getValue().length, this.getLimit(file));
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
        // Copy the default array so pushing a folder never mutates DEFAULT_SETTINGS
        this.settings = { ...DEFAULT_SETTINGS, watchedFolders: [], ...data };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
