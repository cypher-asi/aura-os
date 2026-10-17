import { useEffect, useState } from "react";
import type { SourceControlArea, SourceControlDiff, SourceControlFile } from "../../shared/api/source-control";
import { diffFingerprint, readViewedFiles, revalidateViewedFiles, viewedFileKey, writeViewedFiles } from "../../shared/lib/source-control-viewed-files";

interface VerifiedReview {
  scope: string;
  diff: SourceControlDiff;
  files: SourceControlFile[];
  refresh: number;
  fingerprint: string | null;
  marks: Map<string, string>;
}

export function useViewedFiles(
  scope: string | null,
  files: SourceControlFile[],
  diff: SourceControlDiff | null,
  refresh: number,
  load: (path: string, area: SourceControlArea) => Promise<SourceControlDiff>,
) {
  const [review, setReview] = useState<VerifiedReview | null>(null);
  useEffect(() => {
    if (!scope || !diff) return;
    let cancelled = false;
    void (async () => {
      const fingerprint = await diffFingerprint(diff).catch(() => null);
      const marks = await revalidateViewedFiles(readViewedFiles(scope), files,
        (path, area) => diff.path === path && diff.area === area ? Promise.resolve(diff) : load(path, area));
      if (cancelled) return;
      setReview({ scope, diff, files, refresh, fingerprint, marks: writeViewedFiles(scope, marks) });
    })();
    return () => { cancelled = true; };
  }, [scope, diff, files, refresh, load]);

  const ready = review?.scope === scope && review?.diff === diff && review?.files === files && review?.refresh === refresh;
  const marks = ready ? review!.marks : new Map<string, string>();
  const key = diff ? viewedFileKey(diff.path, diff.area) : "";
  const viewed = marks.has(key);
  const canToggle = ready && Boolean(review?.fingerprint);
  const toggle = () => {
    if (!canToggle || !review || !scope || !diff) return;
    const next = new Map(marks);
    if (viewed) next.delete(key);
    else next.set(key, review.fingerprint!);
    setReview({ ...review, marks: writeViewedFiles(scope, next) });
  };
  return { marks, viewed, canToggle, toggle };
}
