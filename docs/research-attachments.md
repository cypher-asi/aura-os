# Research attachments

The chat picker, drag/drop and file paste share the browser-side attachment processor. Web chat (including a linked local agent) no longer silently ignores PDF or ZIP selections.

- Images and supported text files use the existing image/text harness protocol.
- PDFs are parsed locally with PDF.js. Extracted UTF-8 text has page labels and is attached as `original.pdf.txt`; the original binary PDF is not uploaded or mislabelled as text. The composer explicitly warns that embedded images and layout are not included. Scanned/empty pages, password protection and parsing failures produce visible errors; there is no OCR or silent page omission.
- ZIPs are unpacked locally with fflate. Supported entries are JPEG, PNG, GIF, WebP, PDF, TXT, Markdown, JSON and SQL. Entries never execute or write to the filesystem. Unsafe paths, nested archives, executables and unsupported formats are skipped with visible feedback.
- The existing five-attachment limit remains. ZIP entries count individually; excess files are reported so the user can attach them in another message. Packing ten photos does not bypass this cap.
- Source files are limited to 10 MiB, text payloads to 1 MiB, PDFs to 100 pages, archives to 100 entries and accepted expanded archive data to 20 MiB. Actual decompressed bytes are bounded independently of archive metadata. An incomplete archive is rejected.
- Sending is blocked during parsing. Concurrent selections are serialized, results from another conversation are discarded, and upload progress is synchronized at commit to prevent stale “uploading” flags. The existing inline-base64 fallback remains available if object-storage upload fails.

Verification covers real compressed archives, real PDF parser/worker extraction, picker-hook conversion and upload payloads, size/path limits, errors, concurrency, conversation switches and composer send gating. A synthetic PDF plus ten-photo ZIP was also checked in Chrome; the native file-chooser automation itself requires the browser extension’s file-URL permission, so that path was covered by component/hook tests instead. This is frontend support and does not require a harness protocol change.

The production bundle keeps the parser/worker lazy. Vite's shared preload helper is assigned a higher-priority chunk to prevent recursive grouping from pulling the PDF parser into startup. After building, run `node interface/scripts/check-pdf-lazy-bundle.mjs` to verify this. The repository's existing aggregate bundle budgets fail on unchanged main as well; their thresholds have not been raised or disabled. The full frontend suite was not completed because a worker stopped making progress; the two observed failures (ProjectFilesView hosted workspace copy and SettingsView advanced placeholder copy) reproduce on unchanged main.

## Saving uploaded photo batches

Object-storage upload and chat persistence have different limits. Images may be compressed to about 1.1 MB each, but storage accepts only 2 MiB of JSON per event. Previously, a five-photo message copied every base64 image into the event even when a permanent upload URL existed, making its storage request about 7.3 MB. This can fail on any sufficiently large batch, not specifically the second message.

Uploaded images now persist their permanent HTTP(S) `source_url` with empty inline `data`. The live harness request still carries the original image bytes. Session rendering, galleries, persisted-command resume and the legacy Anthropic-shaped history renderer retain the URL reference. Legacy inline images remain supported. If upload fails, inline fallback is retained rather than silently losing an image; an oversized fallback still fails safely before agent execution with an actionable retry/fewer-files message. The storage limit is not raised or bypassed.

The original browser archive fixture used tiny 1×1 images, and the storage tests used small inline payloads. They covered parsing and upload state but did not exercise the full persistence path at realistic photo sizes; checking the deployed build stamp did not close that gap. The regression test now sends two five-photo batches through the real HTTP storage client against a mock storage endpoint enforcing a 2 MiB JSON limit, checks history/resume references, and proves the old encoded request returns 413 without saving a phantom event. This is local regression verification, not a claim of a production deployment or a full live S3/model round trip.

The AURA API container workflow runs the server library and chat-storage integration suites on PRs and main pushes that affect the API. This ensures the realistic photo-persistence regression executes in CI, rather than merely compiling alongside the analytics-only tests.
