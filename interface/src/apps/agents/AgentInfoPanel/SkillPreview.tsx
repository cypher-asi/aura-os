import { useState, useEffect } from "react";
import { Text, Badge } from "@cypher-asi/zui";
import { Loader2, FolderOpen, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../../api/client";
import type { HarnessSkill, HarnessSkillInstallation } from "../../../types";
import previewStyles from "../../../components/Preview/Preview.module.css";

interface SkillPreviewProps {
  skill: HarnessSkill;
  installation?: HarnessSkillInstallation;
}

export function SkillPreview({ skill: initial, installation }: SkillPreviewProps) {
  const [skill, setSkill] = useState(initial);
  const [loading, setLoading] = useState(!initial.body);

  const permPaths =
    installation?.approved_paths?.length
      ? installation.approved_paths
      : (skill.frontmatter?.["allowed-paths"] as string[] | undefined) ?? [];
  const permCommands =
    installation?.approved_commands?.length
      ? installation.approved_commands
      : (skill.frontmatter?.["allowed-commands"] as string[] | undefined) ?? [];
  const hasPermissions = permPaths.length > 0 || permCommands.length > 0;

  useEffect(() => {
    setSkill(initial);
    if (initial.body && initial.description) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.harnessSkills.getSkill(initial.name).then((full) => {
      if (!cancelled) {
        setSkill((prev) => ({ ...prev, ...full }));
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [initial]);

  return (
    <>
      <div className={previewStyles.taskMeta}>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Name</span>
          <Text size="sm">{skill.name}</Text>
        </div>
        {skill.description && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Description</span>
            <Text size="sm" variant="secondary">{skill.description}</Text>
          </div>
        )}
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Source</span>
          <Text size="sm" variant="secondary">{skill.source}</Text>
        </div>
        {skill.frontmatter?.["allowed-tools"] && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Allowed Tools</span>
            <Text size="sm" variant="secondary">
              {(skill.frontmatter["allowed-tools"] as string[]).join(", ")}
            </Text>
          </div>
        )}
        {skill.frontmatter?.model && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Model</span>
            <Text size="sm" variant="secondary">{skill.frontmatter.model}</Text>
          </div>
        )}
        {skill.frontmatter?.context && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Context</span>
            <Badge variant="running">{skill.frontmatter.context}</Badge>
          </div>
        )}
      </div>
      {hasPermissions && (
        <div className={previewStyles.taskMeta}>
          <span className={previewStyles.fieldLabel}>Granted Permissions</span>
          <div style={{ paddingLeft: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {permPaths.length > 0 && (
              <div className={previewStyles.taskField}>
                <span className={previewStyles.fieldLabel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <FolderOpen size={12} /> Paths
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {permPaths.map((p) => (
                    <Text key={p} size="sm" variant="secondary" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {p}
                    </Text>
                  ))}
                </div>
              </div>
            )}
            {permCommands.length > 0 && (
              <div className={previewStyles.taskField}>
                <span className={previewStyles.fieldLabel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Terminal size={12} /> Commands
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {permCommands.map((c) => (
                    <Text key={c} size="sm" variant="secondary" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{c}</Text>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {loading && (
        <div className={previewStyles.taskMeta} style={{ alignItems: "center", padding: "var(--space-4) 0" }}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite", opacity: 0.5 }} />
        </div>
      )}
      {!loading && skill.body && (
        <div className={previewStyles.taskMeta}>
          <span className={previewStyles.fieldLabel}>Skill File</span>
        </div>
      )}
      {!loading && skill.body && (
        <div className={previewStyles.specMarkdown}>
          <div className={previewStyles.markdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {skill.body}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </>
  );
}
