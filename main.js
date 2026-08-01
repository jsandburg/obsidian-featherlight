const { Plugin, PluginSettingTab, Setting, normalizePath } = require('obsidian');
const { EditorState } = require('@codemirror/state');

const DEFAULT_SETTINGS = {
    limitType: '280',   // '140', '280', or 'custom'
    customLimit: 500,
    watchedFolders: [], // empty array means "apply everywhere"
};

class FeatherlightPlugin extends Plugin {

    async onload() {
        await this.loadSettings();

        // Create the character counter in the bottom status bar
        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar(0);

        // Register a CodeMirror extension that blocks new input at the limit.
        // It allows deletions and selections freely — only additive changes are blocked.
        this.registerEditorExtension(
            EditorState.transactionFilter.of((tr) => {
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
            this.app.workspace.on('editor-change', (editor) => {
                if (this.isInWatchedFolder()) {
                    this.statusBarItem.style.display = '';
                    this.updateStatusBar(editor.getValue().length);
                } else {
                    this.statusBarItem.style.display = 'none';
                }
            })
        );

        // Update the counter when you switch to a different note
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                if (!this.isInWatchedFolder()) {
                    this.statusBarItem.style.display = 'none';
                    return;
                }

                this.statusBarItem.style.display = '';
                const editor = this.app.workspace.activeEditor?.editor;
                if (editor) {
                    this.updateStatusBar(editor.getValue().length);
                } else {
                    this.updateStatusBar(0);
                }
            })
        );

        // Add the Settings tab so users can change the limit
        this.addSettingTab(new FeatherlightSettingTab(this.app, this));
    }

    // Returns true if the active file is inside any of the watched folders.
    // If no folders are configured, always returns true so the plugin applies everywhere.
    isInWatchedFolder() {
        const folders = (this.settings.watchedFolders || []).filter(f => f.trim());
        if (folders.length === 0) return true; // no folders set → apply everywhere

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;

        // normalizePath ensures consistent slashes; trailing slash prevents
        // "Tweets" from matching "Tweets Archive"
        return folders.some(folder => activeFile.path.startsWith(normalizePath(folder.trim()) + '/'));
    }

    // Returns the currently active character limit as a number.
    // A per-note frontmatter property (char-limit: 500) takes priority over
    // the global setting, allowing each note to have its own limit.
    getLimit() {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const cache = this.app.metadataCache.getFileCache(activeFile);
            const perNote = cache?.frontmatter?.['char-limit'];
            if (typeof perNote === 'number' && perNote > 0) return perNote;
        }
        // Fall back to the global setting
        if (this.settings.limitType === '140') return 140;
        if (this.settings.limitType === '280') return 280;
        return this.settings.customLimit;
    }

    // Updates the status bar text and color based on how many characters are used
    updateStatusBar(charCount) {
        const limit     = this.getLimit();
        const remaining = limit - charCount;

        if (remaining === 0) {
            // Exactly at the limit — red, hard stop message
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · limit reached`);
            this.statusBarItem.style.color = 'var(--color-red)';
        } else if (remaining <= Math.max(10, Math.floor(limit * 0.1))) {
            // Within 10% of the limit — orange warning
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · ${remaining} left`);
            this.statusBarItem.style.color = 'var(--color-orange)';
        } else {
            // Plenty of room — green
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · ${remaining} left`);
            this.statusBarItem.style.color = 'var(--color-green)';
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// The settings panel shown under Settings → Community Plugins → Featherlight
class FeatherlightSettingTab extends PluginSettingTab {

    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Featherlight').setHeading();
        containerEl.createEl('p', {
            text: 'Keep your notes light. The character counter appears in the bottom status bar.',
            cls: 'setting-item-description',
        });

        // --- Watched folders ---
        new Setting(containerEl).setName('Watched folders').setHeading();
        containerEl.createEl('p', {
            text: 'The character limit and status bar only activate in notes inside these folders. ' +
                  'Leave the list empty to apply the limit to every note in the vault.',
            cls: 'setting-item-description',
        });

        const folders = this.plugin.settings.watchedFolders || [];

        // Render one row per existing folder
        folders.forEach((folder, index) => {
            new Setting(containerEl)
                .setName(`Folder ${index + 1}`)
                .addText(text => text
                    .setPlaceholder('e.g. Tweets')
                    .setValue(folder)
                    .onChange(async (value) => {
                        this.plugin.settings.watchedFolders[index] = normalizePath(value.trim());
                        await this.plugin.saveSettings();
                        this.refreshCounter();
                    })
                )
                .addButton(btn => btn
                    .setButtonText('Remove')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.watchedFolders.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display(); // re-render the list
                        this.refreshCounter();
                    })
                );
        });

        // Add folder button
        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText('Add folder')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.watchedFolders.push('');
                    await this.plugin.saveSettings();
                    this.display(); // re-render to show the new empty row
                })
            );

        // --- Character limit ---
        new Setting(containerEl).setName('Character limit').setHeading();
        containerEl.createEl('p', {
            text: 'Set a global default below. To override the limit for a specific note, ' +
                  'add char-limit: 500 (or any number) to that note\'s YAML frontmatter. ' +
                  'The per-note value always takes priority over the global setting.',
            cls: 'setting-item-description',
        });

        new Setting(containerEl)
            .setName('Limit preset')
            .setDesc('Choose a Twitter-era preset or define your own.')
            .addDropdown(drop => drop
                .addOption('140', '140 — Classic Tweet (2006–2017)')
                .addOption('280', '280 — Modern Tweet (2017–2022)')
                .addOption('custom', 'Custom')
                .setValue(this.plugin.settings.limitType)
                .onChange(async (value) => {
                    this.plugin.settings.limitType = value;
                    await this.plugin.saveSettings();
                    this.display(); // re-draw to show/hide the custom field
                    this.refreshCounter();
                })
            );

        // Only show the custom number input when 'Custom' is selected
        if (this.plugin.settings.limitType === 'custom') {
            new Setting(containerEl)
                .setName('Custom limit')
                .setDesc('Enter any positive number.')
                .addText(text => text
                    .setPlaceholder('e.g. 500')
                    .setValue(String(this.plugin.settings.customLimit))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.customLimit = num;
                            await this.plugin.saveSettings();
                            this.refreshCounter();
                        }
                    })
                );
        }
    }

    // Immediately refresh the status bar counter after a setting change
    refreshCounter() {
        if (!this.plugin.isInWatchedFolder()) {
            this.plugin.statusBarItem.style.display = 'none';
            return;
        }
        this.plugin.statusBarItem.style.display = '';
        const editor = this.plugin.app.workspace.activeEditor?.editor;
        if (editor) {
            this.plugin.updateStatusBar(editor.getValue().length);
        }
    }
}

module.exports = FeatherlightPlugin;
