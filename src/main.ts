import {
    Editor,
    Notice,
    Plugin,
    TFile,
    TFolder,
    editorInfoField,
    getFrontMatterInfo,
    normalizePath,
} from "obsidian";
import { EditorSelection, EditorState, Transaction, TransactionSpec } from "@codemirror/state";
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

/** How long the "limited to" notice waits before it can show again, in ms. */
const LIMIT_NOTICE_GAP = 5000;

export default class FeatherlightPlugin extends Plugin {
    settings: FeatherlightSettings;
    settingTab: FeatherlightSettingTab;
    statusBarItem: HTMLElement;
    /** When the "limited to" notice last showed (Date.now()). */
    lastLimitNotice = 0;

    async onload() {
        await this.loadSettings();

        // Create the character counter in the bottom status bar
        this.statusBarItem = this.addStatusBarItem();
        this.app.workspace.onLayoutReady(() => this.refreshCounter());

        // Register a CodeMirror extension that blocks new input at the limit.
        // It allows deletions and selections freely — only additive changes are
        // blocked. A paste or drop that would go over is cut to the part that fits.
        this.registerEditorExtension(
            EditorState.transactionFilter.of((tr: Transaction) => {
                if (!tr.docChanged) return tr; // selection-only change, always allow
                // "set" is Obsidian reloading the note after it changed on disk
                // (sync, git, another plugin). Blocking it would leave the editor
                // out of date, and the next save would overwrite those changes.
                if (tr.isUserEvent("set")) return tr;
                // Undo and redo only go back to text the note already had, so
                // they're allowed even when the note is over a lowered limit.
                if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;

                // Use the file this editor belongs to, not the active file: the
                // transaction may come from a background pane or an embed.
                const file = tr.startState.field(editorInfoField, false)?.file ?? null;
                if (!this.isLimited(file)) return tr; // no file or outside the limited folders, always allow

                const limit = this.getLimit(file);
                // A character is at least one UTF-16 code unit, and skipping
                // properties only lowers the count, so a note this short can't
                // be over the limit: skip counting it
                if (tr.newDoc.length <= limit) return tr;
                const newLength = this.count(tr.newDoc.toString());
                if (newLength <= limit) return tr;

                // Over the limit: allow it only if the note isn't getting longer
                // (e.g. trimming a note that was already over a lowered limit)
                const max = Math.max(limit, this.count(tr.startState.doc.toString()));
                if (newLength <= max) return tr;

                // Cutting typing or an autocomplete would leave half a word or
                // link, so only pastes and drops are cut to fit
                const fitted =
                    tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop")
                        ? this.fitInsertion(tr, max)
                        : null;
                if (fitted) {
                    new Notice(
                        `Only ${fitted.kept} of ${fitted.total} characters fit. ` +
                        `This note is limited to ${limit} characters.`
                    );
                    return fitted.spec;
                }
                this.showLimitNotice(limit);
                return []; // returning an empty array cancels the transaction
            })
        );

        // Update the counter whenever the note content changes
        this.registerEvent(
            this.app.workspace.on("editor-change", (editor: Editor, info) => {
                // Only the active editor's count belongs in the status bar
                if (info !== this.app.workspace.activeEditor) return;
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
                    this.settingTab.update(); // redraw the lists if the tab is open
                    this.refreshCounter();
                } else if (file === this.app.workspace.getActiveFile()) {
                    this.refreshCounter();
                }
            })
        );

        // Add the Settings tab so users can change the limit
        this.settingTab = new FeatherlightSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);
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
     * subfolder of a limited folder can be excluded. Editors with no file
     * (canvas cards, for example) are never limited.
     */
    isLimited(file: TFile | null): boolean {
        if (!file) return false;
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
     * For a transaction that inserts text (in one place, or one per cursor), a
     * replacement that inserts only as much of the start of that text as keeps
     * the note within max characters, cut at a whole character. Insertions are
     * filled in document order, so the last cursors may get nothing. Null when
     * none of the text fits.
     */
    fitInsertion(
        tr: Transaction,
        max: number
    ): { spec: TransactionSpec; kept: number; total: number } | null {
        const changes: { from: number; to: number; chars: string[] }[] = [];
        tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
            const chars = Array.from(graphemes.segment(inserted.toString()), ({ segment }) => segment);
            changes.push({ from, to, chars });
        });
        const total = changes.reduce((sum, c) => sum + c.chars.length, 0);

        // The first n characters, spread over the insertions in document order
        const doc = tr.startState.doc;
        const take = (n: number) =>
            changes.map(({ from, to, chars }) => {
                const insert = chars.slice(0, n).join("");
                n = Math.max(0, n - chars.length);
                return { from, to, insert };
            });
        const fits = (n: number) => {
            let text = "";
            let pos = 0;
            for (const { from, to, insert } of take(n)) {
                text += doc.sliceString(pos, from) + insert;
                pos = to;
            }
            return this.count(text + doc.sliceString(pos)) <= max;
        };

        // Binary search for the most characters that fit; all of them don't
        let low = 0;
        let high = total - 1;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (fits(mid)) low = mid;
            else high = mid - 1;
        }
        if (low === 0) return null;

        // A cursor after each insertion, at its position in the new document
        const kept = take(low);
        let shift = 0;
        const cursors = kept.map(({ from, to, insert }) => {
            const cursor = EditorSelection.cursor(from + shift + insert.length);
            shift += insert.length - (to - from);
            return cursor;
        });
        return {
            spec: {
                changes: kept,
                selection: EditorSelection.create(cursors),
                userEvent: tr.annotation(Transaction.userEvent),
                scrollIntoView: true,
            },
            kept: low,
            total,
        };
    }

    /**
     * Says why typing stopped. Shown at most once per LIMIT_NOTICE_GAP, so
     * holding a key at the limit doesn't stack notices.
     */
    showLimitNotice(limit: number): void {
        const now = Date.now();
        if (now - this.lastLimitNotice < LIMIT_NOTICE_GAP) return;
        this.lastLimitNotice = now;
        new Notice(`This note is limited to ${limit} characters.`);
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
        // Fast path: text with nothing above U+02FF has no combining marks,
        // emoji, or surrogate pairs (and no CR to join a CRLF), so every code
        // unit is one character. Keeps big notes cheap on every keystroke.
        if (!/[\u0300-\uffff\r]/.test(counted)) return counted.length;
        let n = 0;
        for (const segment of graphemes.segment(counted)) {
            void segment;
            n++;
        }
        return n;
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
        // Older versions could save a blank row, which the lists can't show
        this.settings.watchedFolders = this.settings.watchedFolders.filter((f) => f.trim());
        this.settings.excludedFolders = this.settings.excludedFolders.filter((f) => f.trim());
        // A limit below 1 would block all typing, so never load one
        const { customLimit } = this.settings;
        if (!Number.isInteger(customLimit) || customLimit < 1) {
            this.settings.customLimit = DEFAULT_SETTINGS.customLimit;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
