import { useState } from 'react';
import { Heading, Text, PanelDrill, Button, Input } from '@cypher-asi/zui';
import type { PanelDrillItem } from '@cypher-asi/zui';
import styles from './Example.module.css';

// Stateful component to demonstrate state preservation
function SettingsPanel({ onNavigate }: { onNavigate: (item: PanelDrillItem) => void }) {
  const [name, setName] = useState('');

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Settings</Text>
      <div>
        <Text size="sm" variant="secondary">Your name (state preserved on navigation):</Text>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name..."
          style={{ marginTop: '0.5rem' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Button
          variant="ghost"
          onClick={() => onNavigate({
            id: 'account',
            label: 'Account',
            content: <AccountPanel onNavigate={onNavigate} />,
          })}
        >
          Account Settings →
        </Button>
        <Button
          variant="ghost"
          onClick={() => onNavigate({
            id: 'appearance',
            label: 'Appearance',
            content: <AppearancePanel onNavigate={onNavigate} />,
          })}
        >
          Appearance →
        </Button>
      </div>
    </div>
  );
}

function AccountPanel({ onNavigate }: { onNavigate: (item: PanelDrillItem) => void }) {
  const [email, setEmail] = useState('');

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Account Settings</Text>
      <div>
        <Text size="sm" variant="secondary">Email (state preserved):</Text>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter email..."
          style={{ marginTop: '0.5rem' }}
        />
      </div>
      <Button
        variant="ghost"
        onClick={() => onNavigate({
          id: 'security',
          label: 'Security',
          content: <SecurityPanel />,
        })}
      >
        Security Settings →
      </Button>
    </div>
  );
}

function AppearancePanel({ onNavigate }: { onNavigate: (item: PanelDrillItem) => void }) {
  const [fontSize, setFontSize] = useState(14);

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Appearance</Text>
      <div>
        <Text size="sm" variant="secondary">Font size: {fontSize}px (state preserved)</Text>
        <input
          type="range"
          min="10"
          max="24"
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          style={{ width: '100%', marginTop: '0.5rem' }}
        />
      </div>
      <Button
        variant="ghost"
        onClick={() => onNavigate({
          id: 'colors',
          label: 'Colors',
          content: <ColorsPanel />,
        })}
      >
        Color Settings →
      </Button>
    </div>
  );
}

function SecurityPanel() {
  const [twoFactor, setTwoFactor] = useState(false);

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Security</Text>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={twoFactor}
          onChange={(e) => setTwoFactor(e.target.checked)}
        />
        <Text size="sm">Enable two-factor authentication</Text>
      </label>
      <Text size="sm" variant="secondary">
        This is the deepest level. Use the breadcrumb above to navigate back.
        Your state in previous panels will be preserved!
      </Text>
    </div>
  );
}

function ColorsPanel() {
  const [accent, setAccent] = useState('#3b82f6');

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Colors</Text>
      <div>
        <Text size="sm" variant="secondary">Accent color (state preserved):</Text>
        <input
          type="color"
          value={accent}
          onChange={(e) => setAccent(e.target.value)}
          style={{ marginTop: '0.5rem', width: '100%', height: '40px', cursor: 'pointer' }}
        />
      </div>
      <Text size="sm" variant="secondary">
        Navigate back using the breadcrumb. Your selections will be remembered!
      </Text>
    </div>
  );
}

export function paneldrillExample() {
  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Interactive Drill-Down Navigation</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Click through the settings to drill down. Use the breadcrumb to navigate back.
          Notice how form state is preserved when you return to previous panels.
        </Text>
        <PanelDrillDemo />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Panel Variants</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          PanelDrill inherits all Panel props including variant, border, and borderRadius.
        </Text>
        <div className={styles.exampleGrid}>
          <PanelDrillVariantDemo variant="glass" border="future" label="Glass + Future Border" />
          <PanelDrillVariantDemo variant="solid" border="solid" label="Solid + Solid Border" />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Background Prop Support</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          PanelDrill supports all Panel background props including background="none" for transparent panels.
        </Text>
        <div className={styles.exampleGrid}>
          <PanelDrillBackgroundDemo background="bg" label="background='bg'" />
          <PanelDrillBackgroundDemo background="surface" label="background='surface'" />
          <PanelDrillBackgroundDemo background="none" label="background='none' (transparent)" />
        </div>
      </div>
    </div>
  );
}

function PanelDrillDemo() {
  const [stack, setStack] = useState<PanelDrillItem[]>([
    { id: 'settings', label: 'Settings', content: <SettingsPanel onNavigate={pushPanel} /> },
  ]);

  function pushPanel(item: PanelDrillItem) {
    setStack((prev) => [...prev, item]);
  }

  function navigateBack(_id: string, index: number) {
    setStack((prev) => prev.slice(0, index + 1));
  }

  // Update root panel's onNavigate reference when pushPanel changes
  const rootContent = <SettingsPanel onNavigate={pushPanel} />;

  return (
    <div style={{
      height: '320px',
      maxWidth: '400px',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      borderRadius: '12px',
      padding: '1.5rem',
    }}>
      <PanelDrill
        stack={stack.map((item, i) => i === 0 ? { ...item, content: rootContent } : item)}
        onNavigate={navigateBack}
        style={{ height: '100%' }}
      />
    </div>
  );
}

function PanelDrillVariantDemo({
  variant,
  border,
  label,
}: {
  variant: 'glass' | 'solid' | 'transparent';
  border: 'none' | 'solid' | 'future';
  label: string;
}) {
  const [stack, setStack] = useState<PanelDrillItem[]>([
    { id: 'home', label: 'Home', content: <SimpleContent level={1} onNext={(item) => setStack((s) => [...s, item])} /> },
  ]);

  return (
    <div className={styles.exampleItem}>
      <Text variant="secondary" size="sm">{label}</Text>
      <div style={{
        height: '200px',
        background: variant === 'glass'
          ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
          : 'var(--color-bg-secondary)',
        borderRadius: '8px',
        padding: '1rem',
      }}>
        <PanelDrill
          stack={stack}
          onNavigate={(_id, index) => setStack((s) => s.slice(0, index + 1))}
          variant={variant}
          border={border}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}

function PanelDrillBackgroundDemo({
  background,
  label,
}: {
  background: 'none' | 'bg' | 'surface' | 'elevated';
  label: string;
}) {
  const [stack, setStack] = useState<PanelDrillItem[]>([
    { id: 'home', label: 'Home', content: <SimpleContent level={1} onNext={(item) => setStack((s) => [...s, item])} /> },
  ]);

  return (
    <div className={styles.exampleItem}>
      <Text variant="secondary" size="sm">{label}</Text>
      <div style={{
        height: '200px',
        background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
        borderRadius: '8px',
        padding: '1rem',
      }}>
        <PanelDrill
          stack={stack}
          onNavigate={(_id, index) => setStack((s) => s.slice(0, index + 1))}
          background={background}
          border="solid"
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}

function SimpleContent({
  level,
  onNext,
}: {
  level: number;
  onNext: (item: PanelDrillItem) => void;
}) {
  const labels = ['Home', 'Level 2', 'Level 3', 'Level 4'];
  const nextLabel = labels[level] || `Level ${level + 1}`;

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Text weight="medium">Level {level}</Text>
      {level < 4 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNext({
            id: `level-${level + 1}`,
            label: nextLabel,
            content: <SimpleContent level={level + 1} onNext={onNext} />,
          })}
        >
          Go deeper →
        </Button>
      )}
      {level >= 4 && (
        <Text size="sm" variant="secondary">Maximum depth reached</Text>
      )}
    </div>
  );
}
