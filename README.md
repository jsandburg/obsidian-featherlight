# Featherlight

An [Obsidian](https://obsidian.md) plugin that enforces character limits on notes — a live counter in the status bar shows characters used and remaining, and once you hit the limit, the editor simply won't accept more.

Inspired by the succinct nature of tweets: a hard ceiling forces you to think a little harder about what to write.

## Features

- **Hard limit, not just a counter** — a CodeMirror transaction filter blocks additive edits once the note is at its limit. Deletions and selections always work, so you can edit your way back under.
- **Live status bar counter** — `✦ 231/280 · 49 left`, colored green with plenty of room, orange within 10% of the limit, red at the hard stop (or `· 12 over` if the note is already past it).
- **Twitter-era presets** — 140 (Classic Tweet, 2006–2017), 280 (Modern Tweet, 2017–2022), or a custom limit of your choosing.
- **Per-note override** — add `char-limit: 500` (any positive number) to a note's YAML frontmatter to give that note its own limit. The per-note value always beats the global setting.
- **Limited folders** — optionally scope the limit and counter to specific folders (e.g. `Tweets`). Outside them, notes behave normally and the counter hides. Leave the list empty to apply the limit everywhere.
- **Excluded folders** — lift the limit from specific folders (e.g. `Drafts`), even inside a limited folder, so you can limit everywhere except a few folders, or limit a folder except one of its subfolders.

## Settings

- **Limited folders** — add a folder with the list's **+** control, then pick it from the suggestions as you type. Only folders that exist in your vault can be saved: a misspelled name (folder names are case-sensitive) shows an error and isn't stored. Subfolders are included, and renaming or moving a limited folder updates the setting automatically. The limit and status bar only activate inside these folders; an empty list applies the limit to every note.
- **Excluded folders** — added and checked the same way as limited folders, and also kept up to date through renames and moves. Notes inside them are never limited and the counter hides, even when the folder sits inside a limited folder or a note has its own `char-limit`.
- **Limit preset** — 140, 280, or Custom; choosing Custom reveals a field for any positive whole number.
- **Count properties** — on by default. Turn it off to leave a note's properties (its YAML frontmatter, `char-limit` included) out of the count, so only the note's body uses up the limit. You can still add and edit properties in a note that's at its limit.

Settings are built on Obsidian's declarative settings API, so every option shows up in the global settings search.

## Notes

- Characters are counted the way you see them: an emoji (👍🏽, 👨‍👩‍👧, a flag) or an accented letter is one character, even when it's made of several code points. Spaces, punctuation, and line breaks count, and so do properties (frontmatter) unless you turn off **Count properties**.
- The limit only blocks *typing and pasting past it*. Notes that already exceed the limit (created before the plugin, or moved into a limited folder) aren't truncated — you just can't add more until you trim them below the limit.
- On phones, Obsidian hides the status bar, so the counter isn't visible there — the limit is still enforced.
- Changes that arrive from outside the editor (Obsidian Sync, git, other plugins) are never blocked, so the limit can't cause the editor to fall out of step with the file on disk.

## Installation

Requires Obsidian 1.13.0 or later.

Until the plugin is available in the community directory, install it manually:

1. Create the folder `<your vault>/.obsidian/plugins/featherlight/`
2. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jsandburg/obsidian-featherlight/releases/latest) and copy them into it
3. Reload Obsidian and enable **Featherlight** under Settings → Community plugins

## Development

This is a TypeScript project — `src/main.ts` (plugin) and `src/settings.ts` (settings tab). To build:

```
npm install
npm run build
```

This typechecks with `tsc` and bundles the sources into `main.js` via esbuild.

To check the sources against Obsidian's plugin guidelines (the same rules the community review uses):

```
npm run lint
```

## License

MIT
