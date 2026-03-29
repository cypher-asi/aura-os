import { useProfile } from "../../../stores/profile-store";
import {
  ProfileActionGroup,
  ProfileCommentsPanel,
  ProfileSummaryCard,
  useProfileSummaryModel,
} from "../shared";
import styles from "./ProfileSidekickPanel.module.css";

export function ProfileSidekickPanel() {
  const { selectedEventId } = useProfile();

  if (selectedEventId) {
    return <ProfileCommentsPanel eventId={selectedEventId} />;
  }

  return <ProfileSidekickSummary />;
}

function ProfileSidekickSummary() {
  const summary = useProfileSummaryModel();

  return (
    <div className={styles.panel}>
      <ProfileSummaryCard summary={summary} />
      <ProfileActionGroup summary={summary} variant="floating" />
    </div>
  );
}
