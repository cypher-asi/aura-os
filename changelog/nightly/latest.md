# Interface Polish & Chat Streaming Improvements

- Date: `2026-04-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.280.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/nightly

Major improvements to chat streaming, tool preview cards, and interface polish. Enhanced spec and file tool streaming with live preview, simplified settings navigation, and strengthened chat session persistence.

## 8:36 PM — Chat Session Management & Settings Redesign

Overhauled chat session handling and simplified app settings navigation

- Fixed agent chat context reset to create fresh sessions and clear client caches, preventing conversation leakage between sessions (`4c469d2`)
- Moved logout action into team settings panel and removed the top-bar settings modal entirely (`54d6ca8`)
- Added specs-to-disk mirroring so generated specs appear in project filesystem at <workspace_root>/spec/<slug>.md (`cca9aae`)

## 4:13 PM — Live Tool Streaming & Preview Cards

Enabled real-time streaming of tool inputs with live preview cards for specs and files

- Implemented live streaming of spec markdown content into preview cards as the model generates it, replacing static spinners (`267e80e`)
- Extended streaming to file operations (write_file, edit_file) with live diff and code previews (`b0bd9d7`)
- Added right-click delete functionality for specs and tasks in the Sidekick panels (`2357d97`)
- Enabled Anthropic fine-grained tool streaming for character-by-character preview updates (`a336804`)

## 4:31 PM — Chat History & Task Status Reliability

Fixed chat history persistence and task status synchronization issues

- Restored missing assistant and tool turns in chat history that were being dropped on app reopen (`0b340fa`, `d74a855`)
- Fixed task status preservation across all views to prevent completed tasks from reverting to in-progress (`efd59b9`, `4c3b40f`, `5bcaff3`)
- Improved Stop automation resilience with better error handling and UI state management (`f33ff9e`)
- Enhanced chat scroll anchoring to stay stable during sidekick pane resizing (`5bcaff3`, `8be01e8`)

## 6:43 PM — Release Infrastructure Improvements

Stabilized desktop build workflows and enhanced changelog generation

- Fixed Linux desktop build dependencies and runner configuration issues (`ecd52f1`, `134278e`, `a14a564`)
- Enhanced changelog generation with improved filtering and timeline grouping (`1e4b343`)

## Highlights

- Live streaming tool previews for specs and files
- Simplified settings navigation with logout in team panel
- Fixed chat history persistence across app restarts
- Improved task status reliability across all views

