import {
  useTheme,
  ACCENT_COLORS,
  THEMES,
  Heading,
  Text,
  Button,
  Toggle,
  Card,
  Badge,
} from '@cypher-asi/zui';
import type { Theme, AccentColor } from '@cypher-asi/zui';
import styles from './Example.module.css';

const ACCENT_LABELS: Record<AccentColor, string> = {
  cyan: 'Cyan',
  blue: 'Blue',
  purple: 'Purple',
  green: 'Green',
  orange: 'Orange',
  rose: 'Rose',
};

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};

export function themeExample() {
  const { theme, accent, resolvedTheme, systemTheme, setTheme, setAccent } = useTheme();

  return (
    <div className={styles.exampleGroup}>
      {/* Theme Mode Selection */}
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Theme Mode</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Switch between dark, light, or system-based themes.
        </Text>
        <div className={styles.row}>
          {THEMES.map((t) => (
            <Button
              key={t}
              variant={theme === t ? 'filled' : 'secondary'}
              onClick={() => setTheme(t)}
            >
              {THEME_LABELS[t]}
            </Button>
          ))}
        </div>
        <div className={styles.row} style={{ marginTop: '1rem' }}>
          <Text variant="secondary" size="sm">
            Current: <strong>{THEME_LABELS[theme]}</strong>
          </Text>
          <Text variant="muted" size="sm">
            Resolved: <strong>{resolvedTheme}</strong>
          </Text>
          <Text variant="muted" size="sm">
            System preference: <strong>{systemTheme}</strong>
          </Text>
        </div>
      </div>

      {/* Accent Color Selection */}
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Accent Color</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Choose your preferred accent color for interactive elements.
        </Text>
        <div className={styles.row}>
          {ACCENT_COLORS.map((color) => (
            <Button
              key={color}
              variant={accent === color ? 'filled' : 'secondary'}
              onClick={() => setAccent(color)}
              style={accent === color ? undefined : {
                borderColor: `var(--color-accent)`,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: getAccentPreviewColor(color, resolvedTheme),
                  flexShrink: 0,
                }}
              />
              {ACCENT_LABELS[color]}
            </Button>
          ))}
        </div>
      </div>

      {/* Preview Section */}
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Preview</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          See how your theme settings affect various components.
        </Text>
        
        <Card style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Buttons */}
            <div>
              <Text variant="secondary" size="sm" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Buttons
              </Text>
              <div className={styles.row}>
                <Button variant="filled">Filled</Button>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
              </div>
            </div>

            {/* Toggle */}
            <div>
              <Text variant="secondary" size="sm" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Toggles
              </Text>
              <div className={styles.row}>
                <Toggle label="Default" defaultChecked />
                <Toggle label="Accent" variant="accent" defaultChecked />
              </div>
            </div>

            {/* Badges */}
            <div>
              <Text variant="secondary" size="sm" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Status Badges
              </Text>
              <div className={styles.row}>
                <Badge variant="running" label="Running" />
                <Badge variant="pending" label="Pending" />
                <Badge variant="error" label="Error" />
                <Badge variant="stopped" label="Stopped" />
              </div>
            </div>

            {/* Text Samples */}
            <div>
              <Text variant="secondary" size="sm" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Typography
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <Text>Primary text color</Text>
                <Text variant="secondary">Secondary text color</Text>
                <Text variant="muted">Muted text color</Text>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Usage Code */}
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Usage</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Wrap your app with ThemeProvider and use the useTheme hook to access theme controls.
        </Text>
        <Card style={{ padding: '1rem', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
{`// In your app entry point
import { ThemeProvider } from '@cypher-asi/zui';

<ThemeProvider defaultTheme="dark" defaultAccent="cyan">
  <App />
</ThemeProvider>

// In any component
import { useTheme } from '@cypher-asi/zui';

function MyComponent() {
  const { theme, accent, setTheme, setAccent } = useTheme();
  // ...
}`}
          </pre>
        </Card>
      </div>
    </div>
  );
}

// Helper to get a preview color for the accent buttons
function getAccentPreviewColor(color: AccentColor, resolvedTheme: 'dark' | 'light'): string {
  const darkColors: Record<AccentColor, string> = {
    cyan: '#01f4cb',
    blue: '#3b82f6',
    purple: '#a855f7',
    green: '#22c55e',
    orange: '#f97316',
    rose: '#f43f5e',
  };
  
  const lightColors: Record<AccentColor, string> = {
    cyan: '#0d9488',
    blue: '#3b82f6',
    purple: '#a855f7',
    green: '#16a34a',
    orange: '#ea580c',
    rose: '#f43f5e',
  };
  
  return resolvedTheme === 'dark' ? darkColors[color] : lightColors[color];
}
