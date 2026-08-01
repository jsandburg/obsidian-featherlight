# Featherlight

An [Obsidian](https://obsidian.md) plugin that enforces character limits on notes — a live counter in the status bar shows characters used and remaining, and once you hit the limit, the editor simply won't accept more.

Inspired by the succinct nature of tweets: a hard ceiling forces you to think a little harder about what to write.

## Features

- **Hard limit, not just a counter** — a CodeMirror transaction filter blocks additive edits once the note is at its limit. Deletions and selections always work, so you can edit your way back under.
- **Live status bar counter** — `✦ 231/280 · 49 left`, colored green with plenty of room, orange within 10% of the limit, red at the hard stop.
- **Twitter-era presets** — 140 (Classic Tweet, 2006–2017), 280 (Modern Tweet, 2017–2022), or a custom limit of your choosing.
- **Per-note override** — add `char-limit: 500` (any positive number) to a note's YAML frontmatter to give that note its own limit. The per-note value always beats the global setting.
- **Watched folders** — optionally scope the limit and counter to specific folders (e.g. `Tweets`). Outside them, notes behave normally and the counter hides. Leave the list empty to apply the limit everywhere.

## Settings

- **Watched folders** — add folder names exactly as they appear in your vault with the list's **+** control. The limit and status bar only activate inside them; an empty list applies the limit to every note.
- **Limit preset** — 140, 280, or Custom; choosing Custom reveals a field for any positive number.

Settings are built on Obsidian's declarative settings API, so every option shows up in the global settings search.

## Notes

- Characters include spaces and punctuation — the count is the raw length of the note, frontmatter included.
- The limit only blocks *typing and pasting past it*. Notes that already exceed the limit (created before the plugin, or moved into a watched folder) aren't truncated — you just can't add more until you trim them below the limit.

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

## License

MIT
