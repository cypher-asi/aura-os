import { Text, Badge } from "@cypher-asi/zui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HarnessSkill } from "../../../types";
import previewStyles from "../../../components/Preview/Preview.module.css";

interface SkillPreviewProps {
  skill: HarnessSkill;
}

export function SkillPreview({ skill }: SkillPreviewProps) {
  return (
    <>
      <div className={previewStyles.taskMeta}>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Name</span>
          <Text size="sm">{skill.name}</Text>
        </div>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Description</span>
          <Text size="sm" variant="secondary">{skill.description}</Text>
        </div>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Source</span>
          <Badge variant="pending">{skill.source}</Badge>
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
      {skill.body && (
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
