# Mobile Workspace Shell and Release Infrastructure Improvements

- Date: `2026-04-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.fb677ae`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/nightly

Today's release introduces a dedicated mobile workspace shell with improved navigation and agent workflows, alongside significant release infrastructure enhancements including automated changelog generation.

## Mobile Experience

- Introduced dedicated mobile workspace shell with organization hub, project navigation drawer, and streamlined mobile-first layouts (`0f05d0f`)
- Refined mobile agent and project workflows with improved agent selection, conversation handling, and project setup flows (`7299fdd`)
- Polished mobile execution view with redesigned task controls, execution summaries, and action buttons optimized for touch interaction (`38e020c`)

## Interface Improvements

- Fixed chat panel reveal timing by waiting for virtualized message list to reach tail before showing chrome, eliminating visible scroll corrections on first open (`5509bcd`)
- Positioned desktop update banner to float above taskbar for better visibility (`f6335a7`)
- Cleaned up agent editor interface by removing unused system prompt properties (`78ab4d2`)

## Release Infrastructure

- Added automated daily changelog generation for both nightly and stable releases using AI-powered commit analysis (`9e40e99`, `805f16f`, `fb677ae`)
- Upgraded CI Node version to 25 across all workflows to align with local development environment (`2828dc3`, `9557757`)
- Optimized desktop validation workflow to run only on pull requests, reducing unnecessary CI overhead (`1d74cc6`)
- Configured iOS beta lane to run on main branch pushes for continuous mobile testing (`80d9e39`)

## Platform & Testing

- Enhanced mobile and desktop regression test coverage with improved assertions and visual validation (`032889c`, `9f34383`)
- Stabilized evaluation test expectations for shell interactions and workflow statistics (`fd625fd`, `fc15ffb`, `2e8ecb8`, `b9dc017`)
- Set up CI keychain configuration for iOS code signing in automated builds (`5dd83ae`)
- Preserved encoded updater public key in Desktop application for secure update verification (`75589e4`)

## Highlights

- New mobile workspace shell with dedicated organization and project navigation
- Automated changelog generation for release transparency
- Improved chat panel timing eliminates scroll corrections

