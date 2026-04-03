---
description: "Create, read, search, and link notes in a local Obsidian vault on Windows. Uses direct file I/O — no external CLI required."
allowed_tools: [read_file, write_file, list_directory, shell]
allowed-paths: []
allowed-commands: ["start obsidian://"]
user_invocable: true
model_invocable: true
---

# Obsidian (Windows)

Work with Obsidian vaults using direct file operations. Obsidian vaults are
plain folders of Markdown files — no special tools needed.

## Vault discovery

Obsidian stores vault config at:

    %APPDATA%/obsidian/obsidian.json

Read this JSON file. It is a map of vault IDs to objects. Look for entries
where `"open": true`. The `path` field is the absolute vault root directory.

**Shortcut**: check agent memory (facts) for key `obsidian_vault_path` first.
If not set, discover it from the config file and store as a fact for next time.

## Creating notes

Write `.md` files directly into the vault. Always include YAML frontmatter:

    ---
    created: YYYY-MM-DD
    tags: [tag-a, tag-b]
    aliases: [short name]
    ---

    # Title

    Content with [[wikilinks]] to other notes.

Rules:
- Use `[[Note Name]]` for internal links (wikilinks), never `[text](path.md)`.
- Use `#tags` inline; mirror them in frontmatter `tags` array.
- Place new notes at the vault root unless the user specifies a subfolder.

## Reading notes

Read `.md` files directly using the vault path + relative note path.

## Searching the vault

List `*.md` files recursively in the vault directory. Skip the `.obsidian/`
config folder. Grep file contents for search terms.

## Daily notes

Convention: `Daily/YYYY-MM-DD.md`. Create the `Daily/` folder if needed.

## Opening notes in Obsidian

Use the URI protocol to open a note in the running Obsidian app:

    obsidian://open?vault=VAULT_NAME&file=PATH_INSIDE_VAULT

Execute via: `start "obsidian://open?vault=MyVault&file=Folder/Note"`

The vault name is typically the folder name (last segment of the vault path).
The file path is relative to the vault root, without the `.md` extension.

## Canvases

Canvas files are `*.canvas` (JSON format). Prefer not to create or modify
these programmatically unless the user explicitly asks.

## Safety

- Never modify files inside `.obsidian/` (plugin config, workspace state).
- Never delete notes without explicit user confirmation.
- Prefer appending to existing notes over overwriting them.
