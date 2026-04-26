import { formatBuildTime, getBuildInfo } from "../../lib/build-info";
import { UpdateControl } from "../../components/UpdateControl";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "./SettingsView.module.css";

function isPlaceholderVersion(version: string) {
  return version.trim() === "0.0.0";
}

function hasSupportBuildId(commit: string) {
  return commit.trim().length > 0 && commit !== "local";
}

export function SettingsView() {
  const build = getBuildInfo();
  const capabilities = useAuraCapabilities();
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
        data-testid="settings-about-panel"
        aria-labelledby="settings-about-heading"
      >
        <h2 id="settings-about-heading">App</h2>
        <dl className={styles.infoGrid}>
          <dt>
            Mode
          </dt>
          <dd data-testid="settings-agent-mode">
            Remote agents
          </dd>
          <dt>
            Version
          </dt>
          <dd>
            <span className={styles.monoText} data-testid="settings-version">
              {showVersion ? build.version : "Current build"}
            </span>{" "}
            {showChannel ? (
              <span className={styles.mutedText} data-testid="settings-channel">
                ({channelLabel})
              </span>
            ) : null}
          </dd>
          <dt>
            Updates
          </dt>
          <dd className={capabilities.isMobileClient ? undefined : styles.updateCell}>
            {capabilities.isMobileClient ? (
              <span data-testid="settings-update-summary">Automatic</span>
            ) : (
              <UpdateControl />
            )}
          </dd>
          {showBuildId ? (
            <>
              <dt>
                Build ID
              </dt>
              <dd>
                <span className={styles.monoText} data-testid="settings-commit">
                  {build.commit}
                </span>
              </dd>
            </>
          ) : null}
          <dt>
            Built
          </dt>
          <dd>
            <span data-testid="settings-build-time">
              {formatBuildTime(build.buildTime)}
            </span>
          </dd>
        </dl>
      </section>

      <section className={styles.settingsNote}>
        AURA keeps app updates automatic. Agent access and runtime policy are managed by your workspace.
      </section>
    </main>
  );
}
