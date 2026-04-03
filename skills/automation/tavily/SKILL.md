---
name: tavily
description: Web search, URL content extraction, site crawling, sitemap discovery, and AI-powered deep research using the Tavily CLI (`tvly`). Use this skill when you need to search the web for information, extract clean content from URLs, crawl websites, discover site structure, or produce comprehensive cited research reports.
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "requires": { "bins": ["tvly"], "env": ["TAVILY_API_KEY"] },
        "install":
          [
            {
              "id": "shell-unix",
              "kind": "shell",
              "command": "curl -fsSL https://cli.tavily.com/install.sh | bash",
              "bins": ["tvly"],
              "label": "Install tvly (Unix/macOS)",
            },
            {
              "id": "shell-windows",
              "kind": "shell",
              "command": "powershell -c \"irm https://cli.tavily.com/install.ps1 | iex\"",
              "bins": ["tvly"],
              "label": "Install tvly (Windows)",
            },
          ],
      },
  }
---

# Tavily — Agent Skill Reference

`tvly` is the official Tavily CLI for web search, content extraction, site crawling, and AI-powered research. All commands return JSON to stdout by default.

---

## Installation

```bash
# Unix / macOS
curl -fsSL https://cli.tavily.com/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://cli.tavily.com/install.ps1 | iex"
```

## Prerequisites

Requires a `TAVILY_API_KEY` environment variable. Get one at <https://tavily.com>.

```bash
export TAVILY_API_KEY="tvly-..."
```

---

## Quick Reference

| Action | Command |
| --- | --- |
| Web search | `tvly search "query" --json` |
| Advanced search | `tvly search "query" --depth advanced --json` |
| Extract URL content | `tvly extract "https://example.com" --json` |
| Extract multiple URLs | `tvly extract "url1" "url2" --json` |
| Crawl a site | `tvly crawl "https://example.com/blog" --json` |
| Discover site pages | `tvly map "https://example.com" --json` |
| Deep AI research | `tvly research "topic" -o report.md` |

---

## Commands

### `tvly search` — Web Search

Search the web and get structured results with optional content extraction.

```bash
# Basic search (returns titles, URLs, snippets)
tvly search "Cursor IDE updates" --json

# Advanced search with full content extraction
tvly search "AI coding assistants 2026" --depth advanced --json

# Limit results and filter by time
tvly search "competitor news" --max-results 10 --time-range week --json

# Filter by topic
tvly search "OpenAI release" --topic news --json
tvly search "transformers tutorial" --topic general --json

# Include specific domains
tvly search "product updates" --include-domains "cursor.com,windsurf.com" --json

# Exclude domains
tvly search "AI news" --exclude-domains "reddit.com" --json

# Include images in results
tvly search "product screenshots" --include-images --json

# Include the raw HTML content
tvly search "documentation" --include-raw-content --json
```

**Key flags:**

| Flag | Description |
| --- | --- |
| `--depth basic\|advanced` | Basic returns snippets; advanced extracts full page content |
| `--max-results N` | Number of results (default 5, max 20) |
| `--time-range day\|week\|month\|year` | Recency filter |
| `--topic general\|news` | Topic category |
| `--include-domains` | Comma-separated allowlist |
| `--exclude-domains` | Comma-separated blocklist |
| `--include-images` | Include image URLs in results |
| `--json` | Output as JSON (always use in agent context) |

### `tvly extract` — URL Content Extraction

Extract clean, readable content from one or more URLs. Handles JavaScript-rendered pages.

```bash
# Single URL
tvly extract "https://cursor.com/blog/background-agents" --json

# Multiple URLs
tvly extract "https://cursor.com/blog" "https://windsurf.com/blog" --json

# Extract with specific instructions
tvly extract "https://example.com/pricing" --json
```

Returns structured JSON with `url`, `raw_content` (cleaned text), and extraction metadata.

### `tvly crawl` — Site Crawling

Crawl a website starting from a URL, following links to discover and extract content from multiple pages.

```bash
# Crawl a blog
tvly crawl "https://cursor.com/blog" --json

# Limit crawl depth and pages
tvly crawl "https://example.com/docs" --max-depth 2 --limit 20 --json

# Crawl with filtering instructions
tvly crawl "https://example.com" --instructions "Only follow links to blog posts" --json
```

**Key flags:**

| Flag | Description |
| --- | --- |
| `--max-depth N` | Maximum link-following depth |
| `--limit N` | Maximum number of pages to crawl |
| `--instructions` | Natural language guidance for the crawler |
| `--json` | Output as JSON |

### `tvly map` — Site Map Discovery

Discover the page structure of a website without extracting full content. Useful for finding new blog posts, changelogs, or documentation pages.

```bash
# Discover all pages on a site
tvly map "https://cursor.com" --json

# With filtering instructions
tvly map "https://cursor.com/blog" --instructions "Find recent blog posts" --json

# Limit results
tvly map "https://example.com" --limit 50 --json
```

### `tvly research` — AI-Powered Deep Research

Produce a comprehensive, cited research report on a topic. This command takes 30-120 seconds and uses multiple search iterations internally.

```bash
# Basic research report
tvly research "competitive landscape of AI coding assistants" -o report.md

# Use the pro model for deeper research
tvly research "state of AI agents in 2026" --model pro -o report.md

# Output to stdout as JSON
tvly research "market analysis of developer tools" --json
```

**Key flags:**

| Flag | Description |
| --- | --- |
| `-o FILE` | Write report to a file |
| `--model basic\|pro` | Research depth (pro takes longer, produces better results) |
| `--json` | Output structured JSON instead of markdown |

---

## Output Format

All commands with `--json` return structured JSON. Example search result:

```json
{
  "results": [
    {
      "title": "Cursor Ships Background Agents",
      "url": "https://cursor.com/blog/background-agents",
      "content": "Cursor released background agents that...",
      "score": 0.95,
      "published_date": "2026-04-01"
    }
  ]
}
```

---

## Common Workflows

### Competitive Intelligence Scan

```bash
# 1. Search for recent news about competitors
tvly search "Cursor IDE updates" --depth advanced --max-results 10 --time-range week --topic news --json

# 2. Discover new pages on competitor blogs
tvly map "https://cursor.com/blog" --instructions "Find posts from the last month" --json

# 3. Extract full content from discovered URLs
tvly extract "https://cursor.com/blog/new-feature" --json

# 4. Deep research for broader landscape analysis
tvly research "AI coding assistant market Q2 2026" --model pro -o landscape.md
```

### URL Content Extraction (replacing curl/wget)

```bash
# Extract clean text from any URL (handles JS-rendered pages)
tvly extract "https://docs.example.com/api-reference" --json

# Batch extract from multiple sources
tvly extract "https://blog1.com/post" "https://blog2.com/article" "https://news.ycombinator.com/item?id=12345" --json
```

### Research Report Generation

```bash
# One-shot comprehensive report with citations
tvly research "impact of AI agents on software development workflows" --model pro -o research-report.md
```

---

## Error Handling

- Non-zero exit code on errors.
- API errors returned as JSON with `error` field.
- Rate limits: Tavily enforces per-minute request limits based on plan tier. If you receive a 429 error, wait and retry.
- Invalid API key returns a 401 error.

---

## Notes

- **Always use `--json`** in agent context for parseable output.
- **`tvly search --depth advanced`** is the best option for getting full page content during searches. Use it when snippets are insufficient.
- **`tvly extract`** handles JavaScript-rendered pages that regular HTTP fetches miss.
- **`tvly research`** is autonomous — it performs multiple search iterations, synthesizes findings, and produces a cited report. Use it for complex queries where a single search isn't enough.
- **`tvly map`** is lightweight — it discovers URLs without extracting content. Pair it with `tvly extract` for a targeted crawl.
- The `summarize` skill remains better for YouTube transcripts and PDF extraction, which Tavily does not cover.
