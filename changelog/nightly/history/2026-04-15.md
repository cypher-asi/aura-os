# Mobile Workspace Shell and Chat Performance Overhaul

- Date: `2026-04-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.507df13`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/nightly

Today's release introduces a dedicated mobile workspace shell with streamlined navigation and rebuilds the chat system with bottom-anchored virtualization to eliminate scroll jank. We've also enhanced release infrastructure with automated changelog generation and improved CI reliability.

## Mobile Experience

- Added dedicated mobile workspace shell with organization switching, project navigation drawer, and streamlined agent workflows optimized for on-the-go work (`0f05d0f`, `7299fdd`)
- Refined mobile agent and project workflows with improved agent selection, project setup flows, and execution view layouts for mobile devices (`38e020c`, `032889c`)
- Enhanced mobile regression test coverage with visual validation and responsive layout checks (`032889c`)

## Chat System Performance

- Rebuilt chat layout with bottom-anchored virtualized architecture that eliminates visible scroll jank during history loads and streaming (`13d0259`, `252ee4a`)
- Implemented smooth streaming text reveal with word-by-word pacing and improved height estimation for rich content messages (`389d733`, `1decfae`, `85940f5`)
- Added context utilization display in chat input bar with session reset capability and real-time streaming of spec and task creation updates (`0ee6c3f`, `aab4e36`, `e1cc2fb`)
- Stabilized chat viewport during sidekick resizing and improved streaming handoff transitions to prevent layout jumps (`8ff07fe`, `d3d25fe`)

## Performance and Infrastructure

- Optimized startup performance with lazy shell imports, reduced auth validation overhead, and added bundle size budgets with performance guardrails (`ad0f2fc`, `507ded6`)
- Improved desktop route persistence and shell loading to restore the last valid route on startup instead of defaulting to the home app (`50b89fd`, `7b5f711`)
- Enhanced agent recovery flow with explicit delete-then-provision sequence and real-time WebSocket progress updates (`a4c565c`)

## Release Infrastructure

- Added automated daily changelog generation with AI-powered release notes for both nightly and stable channels (`9e40e99`, `805f16f`)
- Upgraded CI toolchain to Node 22, Java 21, and improved Cargo build caching with shared target directories for faster desktop rebuilds (`2828dc3`, `9557757`, `8012ff7`)
- Aligned CI and local runtime parity with pinned toolchain versions and improved iOS beta deployment automation (`390f870`, `80d9e39`)

## Highlights

- Mobile workspace shell with streamlined navigation and agent workflows
- Bottom-anchored chat virtualization eliminates scroll jank
- Automated AI-powered changelog generation for releases
- Significant startup performance improvements with lazy loading

