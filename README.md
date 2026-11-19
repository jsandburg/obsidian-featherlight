# Featherlight

An [Obsidian](https://obsidian.md) plugin that puts a hard character limit on your notes. A counter in the status bar shows how much room is left, and once a note is full, the editor won't accept more.

Inspired by tweets: a ceiling makes you think a little harder about what to write.

## How it works

- **The limit is enforced, not just displayed.** At the limit, typing stops and a notice says why. Deleting and selecting always work, so you can edit your way back under.
- **Pastes are cut to fit.** Pasting or dropping more text than there's room for inserts the part that fits, and a notice says how much made it in. With several cursors, the cursors are filled in order. Typing and autocomplete are never cut, so you won't end up with half a word or link.
- **The status bar shows where you stand.** `✦ 231/280 · 49 left` is green with plenty of room, orange within 10% of the limit, and red at the limit (or `· 12 over` if the note is already past it).
- **Characters count the way you see them.** An emoji (👍🏽, 👨‍👩‍👧, a flag) or an accented letter is one character, even when it's built from several code points. Spaces, punctuation, and line breaks count.

## Choosing the limit

Under **Settings → Featherlight**:

- **Limit preset** — 140 (classic tweet, 2006–2017), 280 (modern tweet, 2017–2022), or Custom, which reveals a field for any positive whole number.
- **Count properties** — on by default. Turn it off to leave a note's properties (its YAML frontmatter) out of the count, so only the body uses up the limit.

To give one note its own limit, add `char-limit` to its properties:

```yaml
---
char-limit: 500
---
```

Any positive whole number works, and it always beats the global setting.

## Choosing which notes are limited

By default the limit applies to every note in the vault. Two folder lists narrow that down:

- **Limited folders** — when this list has entries, only notes inside those folders (and their subfolders) are limited. Everywhere else, notes behave normally and the counter hides.
- **Excluded folders** — notes inside these are never limited, even when the folder sits inside a limited folder or the note has its own `char-limit`.

Together they let you limit everything except a few folders, or limit a folder except one of its subfolders.

To add a folder, select the list's **+** control and pick it from your vault. Renaming or moving a listed folder in Obsidian updates the setting automatically. A folder that's no longer in your vault (deleted, or renamed outside Obsidian) stays listed and is marked, so you can remove it.

## Good to know

- **Notes already over the limit aren't truncated.** A note that was written before the plugin, moved into a limited folder, or had its limit lowered keeps its text. You just can't add more until you trim it below the limit.
- **Undo and redo are never blocked**, since they only bring back text the note already had.
- **Changes from outside the editor are never blocked.** Obsidian Sync, git, another app, or a plugin that writes the file directly can all push a note over its limit, so the editor never falls out of step with the file on disk.
- **Other plugins are limited like typing is** when they edit through the editor. The exception is a plugin that replaces the whole note at once (`editor.setValue()`), which Obsidian treats the same as a reload from disk.
- **Only notes are limited.** Editors with no file behind them, such as canvas text cards, are left alone.
- **On phones the counter isn't visible**, because Obsidian hides the status bar there. The limit is still enforced and the notice still appears.

## Installation

Requires Obsidian 1.13.0 or later.

In Obsidian, open **Settings → Community plugins → Browse**, search for **Featherlight**, then select **Install** and **Enable**.

To install it manually instead:

1. Create the folder `<your vault>/.obsidian/plugins/featherlight/`
2. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jsandburg/obsidian-featherlight/releases/latest) and copy them into it
3. Reload Obsidian and enable **Featherlight** under Settings → Community plugins

## Changelog

### 1.1.3

- **`char-limit` must be a positive whole number** — a value like `0.5` is ignored and the global limit applies.
- **Less work while typing** — notes the limit doesn't apply to, such as those in excluded folders, are no longer counted on every keystroke.
- A damaged settings file no longer stops the plugin from loading.

### 1.1.2

- **Custom limit must be 1 or more** — a 0 or negative limit, which would block all typing, is rejected in the settings and never loaded.
- **Undo and redo** are never blocked, even in a note that's over a lowered limit.
- **Canvas cards** and other editors with no file are no longer limited.
- **Multi-cursor pastes** are cut to fit instead of being rejected.
- The settings tab redraws its folder lists when a folder is renamed while it's open.
- Faster counting on long notes made of plain text.

### 1.1.0

- **Excluded folders** — lift the limit from chosen folders, even inside a limited folder.
- **Characters count as you see them** — an emoji or an accented letter is one character, not two or more.
- **Count properties** — a new option to leave a note's properties out of the count.
- **Pastes are cut to fit** — a paste or drop that's too long inserts the part that fits instead of nothing, and a notice says when the limit stops typing.
- **Folder picker** — folder lists show each folder by its path, and **+** opens a searchable list of your vault's folders.

## Development

The plugin is two TypeScript files: `src/main.ts` (the plugin) and `src/settings.ts` (the settings tab).

```
npm install
npm run build
```

`npm run build` typechecks with `tsc` and bundles the sources into `main.js` with esbuild. `npm run dev` rebuilds on every change.

```
npm run lint
```

`npm run lint` checks the sources against Obsidian's plugin guidelines, the same rules the community review uses.

To publish a release, push a tag that matches the version in `manifest.json` (for example `1.1.2`, with no `v`). The release workflow lints, builds, and attaches the three plugin files.

## Acknowledgments

Thanks to [orl0pl](https://github.com/orl0pl), whose fork suggested excluded folders.

## License

MIT
