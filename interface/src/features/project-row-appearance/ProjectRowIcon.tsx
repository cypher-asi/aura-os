import { DynamicIcon } from "lucide-react/dynamic";
import { useProjectAppearance } from "../../hooks/use-project-appearance";

interface ProjectRowIconProps {
  projectId: string;
}

/**
 * Icon rendered in the explorer row for each project, used by every
 * app that builds a project-list tree (projects sidebar, tasks,
 * process, …). Reads appearance for `projectId` and composes
 * whichever of (Lucide icon, accent color) the user has configured:
 *
 * - **Both icon + accent:** the Lucide glyph painted in the accent
 *   color. Reads as "this project is themed."
 * - **Icon only:** plain Lucide glyph in the default text color.
 * - **Accent only:** a small filled dot in the accent color. Acts as
 *   a row pip without taking up icon real estate.
 * - **Neither:** nothing — the row renders without a leading glyph,
 *   matching the pre-feature default.
 *
 * The appearance store dedupes loads per project id so mounting many
 * of these concurrently (e.g. sidebar boot) collapses to one request
 * per project.
 */
export function ProjectRowIcon({ projectId }: ProjectRowIconProps) {
  const { appearance } = useProjectAppearance(projectId);
  const { icon, accent } = appearance;

  if (icon) {
    return (
      <DynamicIcon
        name={icon as Parameters<typeof DynamicIcon>[0]["name"]}
        size={16}
        style={accent ? { color: accent } : undefined}
      />
    );
  }

  if (accent) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: accent,
        }}
      />
    );
  }

  return null;
}
