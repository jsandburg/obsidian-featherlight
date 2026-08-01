const { Plugin, PluginSettingTab, normalizePath } = require('obsidian');
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
                this.refreshCounter(editor.getValue().length);
            })
        );

        // Update the counter when you switch to a different note
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.refreshCounter();
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

    // Shows/hides the counter for the current context and updates its value.
    // Pass charCount when the caller already knows it (editor-change); otherwise
    // it is read from the active editor.
    refreshCounter(charCount) {
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

    // Updates the status bar text and color based on how many characters are used
    updateStatusBar(charCount) {
        const limit     = this.getLimit();
        const remaining = limit - charCount;

        // Within 10% of the limit (or the last 10 characters) counts as "warning"
        const warning = remaining <= Math.max(10, Math.floor(limit * 0.1));

        if (remaining === 0) {
            // Exactly at the limit — hard stop message
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · limit reached`);
        } else {
            this.statusBarItem.setText(`✦ ${charCount}/${limit} · ${remaining} left`);
        }
        this.statusBarItem.toggleClass('featherlight-ok', remaining !== 0 && !warning);
        this.statusBarItem.toggleClass('featherlight-warning', remaining !== 0 && warning);
        this.statusBarItem.toggleClass('featherlight-limit', remaining === 0);
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

    getSettingDefinitions() {
        const folders = this.plugin.settings.watchedFolders || [];

        return [
            {
                name: '',
                desc: 'Keep your notes light. The character counter appears in the bottom status bar.',
                searchable: false,
            },
            {
                type: 'list',
                heading: 'Watched folders',
                emptyState:
                    'No folders listed — the character limit applies to every note in the ' +
                    'vault. Add a folder (exactly as it appears in your vault, e.g. ' +
                    '"Tweets") to limit only the notes inside it.',
                addItem: {
                    name: 'Add folder',
                    action: () => {
                        this.plugin.settings.watchedFolders.push('');
                        void this.plugin.saveSettings();
                        this.update();
                    },
                },
                onDelete: (index) => {
                    this.plugin.settings.watchedFolders.splice(index, 1);
                    void this.plugin.saveSettings();
                    this.update();
                    this.plugin.refreshCounter();
                },
                items: folders.map((folder, index) => ({
                    name: `Folder ${index + 1}`,
                    searchable: false,
                    render: (setting) => {
                        setting.addText(text => text
                            .setPlaceholder('e.g. Tweets')
                            .setValue(folder)
                            .onChange(async (value) => {
                                // Store the raw trimmed value. Do NOT normalizePath() here:
                                // normalizePath('') returns '/', which would survive the
                                // blank filter and silently apply the limit everywhere.
                                // Paths are normalized at comparison time instead (see
                                // isInWatchedFolder).
                                this.plugin.settings.watchedFolders[index] = value.trim();
                                await this.plugin.saveSettings();
                                this.plugin.refreshCounter();
                            })
                        );
                    },
                })),
            },
            {
                type: 'group',
                heading: 'Character limit',
                items: [
                    {
                        name: '',
                        desc: 'Set a global default below. To override the limit for a specific ' +
                              'note, add char-limit: 500 (or any number) to that note\'s YAML ' +
                              'frontmatter. The per-note value always takes priority over the ' +
                              'global setting.',
                        searchable: false,
                    },
                    {
                        name: 'Limit preset',
                        desc: 'Choose a Twitter-era preset or define your own.',
                        render: (setting) => {
                            setting.addDropdown(drop => drop
                                .addOption('140', '140 — Classic Tweet (2006–2017)')
                                .addOption('280', '280 — Modern Tweet (2017–2022)')
                                .addOption('custom', 'Custom')
                                .setValue(this.plugin.settings.limitType)
                                .onChange(async (value) => {
                                    this.plugin.settings.limitType = value;
                                    await this.plugin.saveSettings();
                                    this.update(); // show/hide the custom field
                                    this.plugin.refreshCounter();
                                })
                            );
                        },
                    },
                    {
                        name: 'Custom limit',
                        desc: 'Enter any positive number.',
                        visible: () => this.plugin.settings.limitType === 'custom',
                        render: (setting) => {
                            setting.addText(text => text
                                .setPlaceholder('e.g. 500')
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

module.exports = FeatherlightPlugin;
