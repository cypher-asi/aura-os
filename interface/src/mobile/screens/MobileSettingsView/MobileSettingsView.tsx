import { formatBuildTime, getBuildInfo } from "../../../lib/build-info";
import { AppearanceSection } from "../../../views/SettingsView/AppearanceSection";
import styles from "./MobileSettingsView.module.css";

function isPlaceholderVersion(version: string) {
  return version.trim() === "0.0.0";
}

function hasSupportBuildId(commit: string) {
  return commit.trim().length > 0 && commit !== "local";
}

export function MobileSettingsView() {
  const build = getBuildInfo();
  const channelLabel = build.channel.charAt(0).toUpperCase() + build.channel.slice(1);
  const showVersion = !isPlaceholderVersion(build.version);
  const showChannel = showVersion && build.channel !== "dev";
  const showBuildId = hasSupportBuildId(build.commit);

  return (
    <main className={styles.settingsRoot}>
      <header className={styles.settingsHeader}>
        <h1>AURA</h1>
        <p>Remote agent workspace</p>
      </header>

      <section
        className={styles.settingsPanel}
        data-testid="mobile-settings-about-panel"
        aria-labelledby="mobile-settings-about-heading"
      >
        <h2 id="mobile-settings-about-heading">App</h2>
        <dl className={styles.infoGrid}>
          <dt>Mode</dt>
          <dd data-testid="mobile-settings-agent-mode">Remote agents</dd>

          <dt>Version</dt>
          <dd>
            <span className={styles.monoText} data-testid="mobile-settings-version">
              {showVersion ? build.version : "Current build"}
            </span>{" "}
            {showChannel ? (
              <span className={styles.mutedText} data-testid="mobile-settings-channel">
                ({channelLabel})
              </span>
            ) : null}
          </dd>

          <dt>Updates</dt>
          <dd>
            <span data-testid="mobile-settings-update-summary">Automatic</span>
          </dd>

          {showBuildId ? (
            <>
              <dt>Build ID</dt>
              <dd>
                <span className={styles.monoText} data-testid="mobile-settings-commit">
                  {build.commit}
                </span>
              </dd>
            </>
          ) : null}

          <dt>Built</dt>
          <dd>
            <span data-testid="mobile-settings-build-time">
              {formatBuildTime(build.buildTime)}
            </span>
          </dd>
        </dl>
      </section>

      <section className={`${styles.settingsPanel} ${styles.appearancePanelMobile}`}>
        <AppearanceSection />
      </section>

      <section className={styles.settingsNote}>
        AURA keeps app updates automatic. Agent access and runtime policy are managed by your workspace.
      </section>
    </main>
  );
}
