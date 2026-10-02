# Partial desktop releases

The nightly and stable workflows publish the platforms that successfully finish
packaging, signing, and artifact validation. A failed platform remains a failed
job, but no longer prevents its healthy siblings from being published.

- Release preflight must pass; cancellation never starts a publication.
- Installer artifacts are uploaded only after platform validation. Mac signing
  and notarization remain mandatory, including notarization of the DMG.
- Publication revalidates each uploaded platform in isolation and checks its
  summary's version, channel, file sizes, SHA-256 hashes, and required signatures.
- No successful platform means no release. Invalid uploaded artifacts also fail
  closed rather than publishing corrupt or unvalidated files.
- Release bodies list the platforms actually available in that release.
- Update and download manifests change only for successful platforms. Failed
  platforms retain their last published immutable URLs, if any; they are not
  pointed to missing assets or mislabeled as updated.
- Manual `publish_live=false` runs exercise the same artifact selection and
  manifest generation without uploading a release or changing GitHub Pages.

The overall workflow can therefore be red while its release and manifest jobs
successfully publish Windows/Linux. Inspect the publication summary and release
assets rather than treating overall workflow status as publication status.

Run the contract tests with:

```sh
node --test infra/scripts/release/desktop-partial-publication.test.mjs
```
