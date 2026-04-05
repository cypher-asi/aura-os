---
name: obsidian
description: "Manage notes in Obsidian vaults using the official Obsidian CLI. Create, read, search, append, and organize notes. Requires Obsidian desktop app running with CLI enabled."
allowed_tools: [read_file, write_file, list_directory, shell]
allowed-paths: []
allowed-commands: ["obsidian"]
user_invocable: true
model_invocable: true
---

# Obsidian CLI

Manage Obsidian vaults using the **official Obsidian CLI** (`obsidian`).
The CLI is built into Obsidian desktop (v1.12.4+) and must be enabled in
Settings > General > Command line interface. The Obsidian app must be running.

Use `run_command` with the `obsidian` command for all operations.

Parameters use `key=value` syntax. Wrap values with spaces in quotes.
Use `file=<name>` to resolve by name (like wikilinks) or `path=<path>`
for exact paths. Most commands default to the active file when omitted.
Use `\n` for newlines and `\t` for tabs in content values.

## Vault discovery

    obsidian vaults
    obsidian vaults verbose

To target a specific vault, add `vault=NAME` to any command.

    obsidian vault vault=n3o

**Shortcut**: check agent memory (facts) for key `obsidian_vault_path` first.

## Creating notes

    obsidian create name="Note Name" vault=n3o
    obsidian create name="Note Name" content="Body text" vault=n3o
    obsidian create name="Note Name" template=Travel vault=n3o
    obsidian create name="Note Name" content="Body" open vault=n3o

For longer content, use `write_file` directly to the vault path with
YAML frontmatter.

Rules:
- Use `[[Note Name]]` for internal links (wikilinks), never `[text](path.md)`.
- Use `#tags` inline; mirror them in frontmatter `tags` array.
- Place new notes at the vault root unless the user specifies a subfolder.

## Reading notes

    obsidian read file="Note Name" vault=n3o
    obsidian read path="Folder/note.md" vault=n3o

## Appending and prepending

    obsidian append file="Note Name" content="New content" vault=n3o
    obsidian prepend file="Note Name" content="New content" vault=n3o
    obsidian append file="Note Name" content="Inline addition" inline vault=n3o

## Searching the vault

    obsidian search query="meeting notes" vault=n3o
    obsidian search query="project" path="Work" limit=10 vault=n3o
    obsidian search:context query="meeting notes" vault=n3o

## Listing files and folders

    obsidian files vault=n3o
    obsidian files folder="Subfolder" vault=n3o
    obsidian files ext=md total vault=n3o
    obsidian folders vault=n3o

## Daily notes

    obsidian daily vault=n3o
    obsidian daily:read vault=n3o
    obsidian daily:path vault=n3o
    obsidian daily:append content="- [ ] Buy groceries" vault=n3o
    obsidian daily:prepend content="# Morning" vault=n3o

## Tasks

    obsidian tasks vault=n3o
    obsidian tasks todo vault=n3o
    obsidian tasks done vault=n3o
    obsidian tasks daily vault=n3o
    obsidian task file="Note" line=5 toggle vault=n3o

## Links and backlinks

    obsidian backlinks file="Note Name" vault=n3o
    obsidian links file="Note Name" vault=n3o
    obsidian orphans vault=n3o
    obsidian unresolved vault=n3o
    obsidian deadends vault=n3o

## Tags

    obsidian tags vault=n3o
    obsidian tags counts sort=count vault=n3o
    obsidian tag name="specific-tag" vault=n3o

## Properties

    obsidian properties file="Note Name" vault=n3o
    obsidian property:set name=status value=active file="Note Name" vault=n3o
    obsidian property:set name=tags value="tag-a, tag-b" type=list file="Note" vault=n3o
    obsidian property:read name=status file="Note Name" vault=n3o
    obsidian property:remove name=status file="Note Name" vault=n3o

## Templates

    obsidian templates vault=n3o
    obsidian template:read name="Template Name" vault=n3o
    obsidian template:read name="Template Name" resolve title="My Note" vault=n3o

## Opening notes in the app

    obsidian open file="Note Name" vault=n3o
    obsidian open file="Note Name" newtab vault=n3o

## Moving, renaming, deleting

    obsidian move file="Note" to="Folder/Note" vault=n3o
    obsidian rename file="Old Name" name="New Name" vault=n3o
    obsidian delete file="Note Name" vault=n3o

## File info

    obsidian file file="Note Name" vault=n3o
    obsidian wordcount file="Note Name" vault=n3o
    obsidian outline file="Note Name" vault=n3o

## Bookmarks

    obsidian bookmarks vault=n3o
    obsidian bookmark file="Note Name" vault=n3o

## Output options

Add `--copy` to any command to copy output to clipboard.
Add `format=json` (or `tsv`, `csv`) for structured output.

## Safety

- Never delete notes without explicit user confirmation.
- Prefer appending to existing notes over overwriting them.
- Never modify files inside `.obsidian/` directly.
