import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Spinner, Text } from "@cypher-asi/zui";
import { X } from "lucide-react";
import { useParams } from "react-router-dom";
import { PanelSearch } from "../../components/PanelSearch";
import { FileExplorer } from "../../components/FileExplorer";
import { useProjectContext } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { filenameFromPath, langFromPath } from "../../ide/lang";
import { resolveApiUrl } from "../../lib/host-config";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { getProjectWorkspaceDisplay, getProjectWorkspaceLabel, getProjectWorkspaceRoot } from "../../utils/projectWorkspace";
import { useMobileFilePreview } from "./useMobileFilePreview";
import styles from "./ProjectFilesView.module.css";

type MobilePreviewKind = "markdown" | "text" | "image" | "pdf" | "unsupported";

export function ProjectFilesView() {
  const { isMobileLayout } = useAuraCapabilities();
  const ctx = useProjectContext();
  const { projectId } = useParams<{ projectId: string }>();
  const listedProject = useProjectsListStore((state) => (
    projectId ? state.projects.find((candidate) => candidate.project_id === projectId) ?? null : null
  ));
  const project = ctx?.project ?? listedProject;
  const rootPath = getProjectWorkspaceRoot(project);
  const workspaceSourceLabel = getProjectWorkspaceLabel(project);
  const workspaceDisplay = getProjectWorkspaceDisplay(project);
  const workspaceSourceDescription = project?.workspace_source === "imported"
    ? "Preview imported project files on mobile."
    : "Preview readable files from the linked workspace.";
  const projectKey = project?.project_id ?? rootPath ?? "project-files";

  return (
    <ProjectFilesContent
      key={projectKey}
      isMobileLayout={isMobileLayout}
      rootPath={rootPath}
      workspaceSourceLabel={workspaceSourceLabel}
      workspaceDisplay={workspaceDisplay}
      workspaceSourceDescription={workspaceSourceDescription}
    />
  );
}

interface ProjectFilesContentProps {
  isMobileLayout: boolean;
  rootPath: string | null;
  workspaceSourceLabel: string;
  workspaceDisplay: string | null;
  workspaceSourceDescription: string;
}

function ProjectFilesContent({
  isMobileLayout,
  rootPath,
  workspaceSourceLabel,
  workspaceDisplay,
  workspaceSourceDescription,
}: ProjectFilesContentProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const selectedFileKind = useMemo<MobilePreviewKind | null>(
    () => (selectedFilePath ? getMobilePreviewKind(selectedFilePath) : null),
    [selectedFilePath],
  );
  const selectedFileName = selectedFilePath ? filenameFromPath(selectedFilePath) : null;
  const selectedFilePreviewUrl = selectedFilePath
    ? resolveApiUrl(`/api/file-preview?path=${encodeURIComponent(selectedFilePath)}`)
    : null;
  const selectedFileLanguage = selectedFilePath ? langFromPath(selectedFilePath) ?? "plain text" : null;
  const {
    previewContent,
    previewError,
    previewLoading,
  } = useMobileFilePreview({
    enabled: isMobileLayout,
    filePath: selectedFilePath,
    previewKind: selectedFileKind,
  });

  return (
    <div className={styles.container}>
      {isMobileLayout ? (
        <div className={styles.mobileSummary}>
          <div className={styles.mobileSummaryText}>
            <Text size="xs" variant="muted" className={styles.mobileEyebrow}>
              Files
            </Text>
            <Text size="sm" weight="medium">
              {workspaceSourceLabel}
            </Text>
            {workspaceDisplay ? (
              <Text variant="muted" size="sm" className={styles.mobileWorkspacePath}>
                {workspaceDisplay}
              </Text>
            ) : null}
            <Text variant="muted" size="sm">
              {workspaceSourceDescription}
            </Text>
          </div>
        </div>
      ) : null}
      {isMobileLayout ? (
        <div className={styles.mobilePreviewCard}>
          <div className={styles.mobilePreviewHeader}>
            <div className={styles.mobilePreviewHeaderText}>
              <Text size="sm" weight="medium">
                {selectedFileName ?? "File preview"}
              </Text>
              <Text variant="muted" size="sm">
                {selectedFileName
                  ? selectedFileKind === "pdf"
                    ? "PDF preview"
                    : selectedFileKind === "image"
                      ? "Image preview"
                      : selectedFileLanguage
                  : "Select a file below to preview it here."}
              </Text>
            </div>
            {selectedFilePath ? (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={<X size={14} />}
                aria-label="Close file preview"
                onClick={() => setSelectedFilePath(null)}
              />
            ) : null}
          </div>

          {selectedFilePath ? (
            <div className={styles.mobilePreviewBody}>
              {selectedFileKind === "image" && selectedFilePreviewUrl ? (
                <img className={styles.mobilePreviewImage} src={selectedFilePreviewUrl} alt={selectedFileName ?? "Preview"} />
              ) : null}

              {selectedFileKind === "pdf" && selectedFilePreviewUrl ? (
                <>
                  <iframe
                    className={styles.mobilePreviewFrame}
                    src={selectedFilePreviewUrl}
                    title={selectedFileName ?? "PDF preview"}
                  />
                  <a className={styles.mobilePreviewLink} href={selectedFilePreviewUrl} target="_blank" rel="noreferrer">
                    Open PDF in browser
                  </a>
                </>
              ) : null}

              {selectedFileKind === "unsupported" && selectedFilePreviewUrl ? (
                <>
                  <Text variant="muted" size="sm">
                    This file type does not have an inline mobile preview yet.
                  </Text>
                  <a className={styles.mobilePreviewLink} href={selectedFilePreviewUrl} target="_blank" rel="noreferrer">
                    Open raw file
                  </a>
                </>
              ) : null}

              {(selectedFileKind === "text" || selectedFileKind === "markdown") && previewLoading ? (
                <div className={styles.mobilePreviewLoading}>
                  <Spinner size="sm" />
                </div>
              ) : null}

              {(selectedFileKind === "text" || selectedFileKind === "markdown") && previewError ? (
                <Text variant="muted" size="sm">
                  {previewError}
                </Text>
              ) : null}

              {selectedFileKind === "markdown" && previewContent ? (
                <div className={styles.mobileMarkdownPreview}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {previewContent}
                  </ReactMarkdown>
                </div>
              ) : null}

              {selectedFileKind === "text" && previewContent ? (
                <pre className={styles.mobileCodePreview}>
                  <code>{previewContent}</code>
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.searchHeader}>
        <PanelSearch
          placeholder="Search files..."
          value={searchQuery}
          onChange={setSearchQuery}
        />
      </div>
      <div className={styles.explorerArea}>
        <FileExplorer
          rootPath={rootPath ?? undefined}
          searchQuery={searchQuery}
          onFileSelect={isMobileLayout ? setSelectedFilePath : undefined}
        />
      </div>
    </div>
  );
}

function getMobilePreviewKind(path: string): MobilePreviewKind {
  const lower = path.toLowerCase();

  if (/\.(md|markdown)$/.test(lower)) {
    return "markdown";
  }

  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) {
    return "image";
  }

  if (lower.endsWith(".pdf")) {
    return "pdf";
  }

  if (/\.(rs|ts|tsx|js|jsx|json|yaml|yml|toml|css|html|txt|sh|py|go|java|sql)$/.test(lower)) {
    return "text";
  }

  return "unsupported";
}
