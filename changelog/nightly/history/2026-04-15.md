# Mobile Workspace Shell and Release Infrastructure Improvements

- Date: `2026-04-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.9e40e99`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/nightly

Major mobile experience overhaul with dedicated workspace shell, refined agent workflows, and enhanced release automation. This release focuses on making mobile navigation coherent while preserving desktop behavior.

## Mobile Experience

- Added dedicated mobile workspace shell with organization hub, project navigation drawer, and mobile-optimized topbar (`0f05d0f`)
- Refined mobile agent and project workflows with improved agent conversation rows and project navigation (`7299fdd`)
- Polished mobile execution view with redesigned layout, execution cards, and floating action controls (`38e020c`)
- Enhanced mobile and desktop regression test coverage with updated visual specs and layout capability tests (`032889c`)

## Interface Improvements

- Fixed chat panel reveal timing by waiting for virtualized tail before showing chrome, eliminating visible scroll corrections (`5509bcd`)
- Improved desktop update banner positioning to float above taskbar (`f6335a7`)
- Cleaned up agent editor by removing dead system prompt props (`78ab4d2`)

## Release Infrastructure

- Added automated daily changelog generation for both nightly and stable releases (`9e40e99`)
- Upgraded CI Node version from 22 to 25 across all workflows to align with local development (`2828dc3`, `9557757`)
- Configured desktop validation to run only for pull requests, optimizing CI resource usage (`1d74cc6`)
- Set up iOS beta lane to run on main branch pushes for continuous mobile testing (`80d9e39`)

## Platform Updates

- Enhanced Desktop updater security by preserving encoded public key for signature validation (`75589e4`)
- Configured iOS CI keychain setup for proper code signing in automated builds (`5dd83ae`)
- Applied rustfmt formatting across server handlers, billing, orgs, sessions, and related crates (`6d76e47`)

## Highlights

- Mobile workspace shell provides coherent navigation without breaking desktop flows
- Chat panel timing improvements eliminate visible scroll corrections on first open
- Automated changelog generation now included in release pipeline

