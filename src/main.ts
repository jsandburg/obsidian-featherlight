import { Editor, Plugin, normalizePath } from "obsidian";
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
        this.updateStatusBar(0);

        // Register a CodeMirror extension that blocks new input at the limit.
        // It allows deletions and selections freely — only additive changes are blocked.
        this.registerEditorExtension(
            EditorState.transactionFilter.of((tr: Transaction) => {
                if (!tr.docChanged) return tr; // selection-only change, always allow
                if (!this.isInWatchedFolder()) return tr; // outside watched folder, always allow

                const limit = this.getLimit();
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

        // Add the Settings tab so users can change the limit
        this.addSettingTab(new FeatherlightSettingTab(this.app, this));
    }

    /**
     * True when the active file is inside any of the watched folders.
     * If no folders are configured, always returns true so the plugin
     * applies everywhere.
     */
    isInWatchedFolder(): boolean {
        const folders = (this.settings.watchedFolders || []).filter((f) => f.trim());
        if (folders.length === 0) return true; // no folders set → apply everywhere

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;

        // normalizePath ensures consistent slashes; the trailing slash prevents
        // "Tweets" from matching "Tweets Archive"
        return folders.some((folder) =>
            activeFile.path.startsWith(normalizePath(folder.trim()) + "/")
        );
    }

    /**
     * The character limit currently in effect. A per-note frontmatter property
     * (char-limit: 500) takes priority over the global setting, so each note
     * can have its own limit.
     */
    getLimit(): number {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const cache = this.app.metadataCache.getFileCache(activeFile);
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
        if (!this.isInWatchedFolder()) {
            this.statusBarItem.hide();
            return;
        }
        this.statusBarItem.show();
        if (charCount === undefined) {
            const editor = this.app.workspace.activeEditor?.editor;
            charCount = editor ? editor.getValue().length : 0;
        }
        this.updateStatusBar(charCount);
    }

    /** Updates the status bar text and color for the given character count. */
    updateStatusBar(charCount: number): void {
        const limit = this.getLimit();
        const remaining = limit - charCount;

        // Within 10% of the limit (or the last 10 characters) counts as "warning"
        const warning = remaining <= Math.max(10, Math.floor(limit * 0.1));

        if (remaining === 0) {
            // Exactly at the limit — hard stop message
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · limit reached`);
        } else {
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · ${remaining} left`);
        }
        this.statusBarItem.toggleClass("featherlight-ok", remaining !== 0 && !warning);
        this.statusBarItem.toggleClass("featherlight-warning", remaining !== 0 && warning);
        this.statusBarItem.toggleClass("featherlight-limit", remaining === 0);
    }

    async loadSettings() {
        const data = (await this.loadData()) as Partial<FeatherlightSettings> | null;
        this.settings = { ...DEFAULT_SETTINGS, ...data };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
