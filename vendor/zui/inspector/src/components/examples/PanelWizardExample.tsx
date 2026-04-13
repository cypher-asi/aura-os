import { useState } from 'react';
import { Heading, Text, PanelWizard, Input, Toggle } from '@cypher-asi/zui';
import type { WizardStep } from '@cypher-asi/zui';
import styles from './Example.module.css';

// Step 1: Personal Info
function PersonalInfoStep({
  data,
  onChange,
}: {
  data: { name: string; email: string };
  onChange: (data: { name: string; email: string }) => void;
}) {
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Personal Information</Text>
      <Text size="sm" variant="secondary">
        Please enter your details below. All fields are required.
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Text size="sm">Name</Text>
        <Input
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          placeholder="Enter your name..."
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Text size="sm">Email</Text>
        <Input
          value={data.email}
          onChange={(e) => onChange({ ...data, email: e.target.value })}
          placeholder="Enter your email..."
          type="email"
        />
      </div>
    </div>
  );
}

// Step 2: Preferences
function PreferencesStep({
  data,
  onChange,
}: {
  data: { notifications: boolean; theme: string };
  onChange: (data: { notifications: boolean; theme: string }) => void;
}) {
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Preferences</Text>
      <Text size="sm" variant="secondary">
        Customize your experience.
      </Text>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text size="sm">Enable notifications</Text>
        <Toggle
          checked={data.notifications}
          onChange={(checked) => onChange({ ...data, notifications: checked })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Text size="sm">Theme preference</Text>
        <select
          value={data.theme}
          onChange={(e) => onChange({ ...data, theme: e.target.value })}
          style={{
            padding: '0.5rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
    </div>
  );
}

// Step 3: Review
function ReviewStep({
  personalInfo,
  preferences,
}: {
  personalInfo: { name: string; email: string };
  preferences: { notifications: boolean; theme: string };
}) {
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Text weight="medium">Review Your Information</Text>
      <Text size="sm" variant="secondary">
        Please confirm your details before finishing.
      </Text>
      <div style={{ 
        background: 'var(--color-bg-secondary)', 
        borderRadius: 'var(--radius-md)', 
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}>
        <div>
          <Text size="xs" variant="secondary">Name</Text>
          <Text size="sm">{personalInfo.name}</Text>
        </div>
        <div>
          <Text size="xs" variant="secondary">Email</Text>
          <Text size="sm">{personalInfo.email}</Text>
        </div>
        <div>
          <Text size="xs" variant="secondary">Notifications</Text>
          <Text size="sm">{preferences.notifications ? 'Enabled' : 'Disabled'}</Text>
        </div>
        <div>
          <Text size="xs" variant="secondary">Theme</Text>
          <Text size="sm" style={{ textTransform: 'capitalize' }}>{preferences.theme}</Text>
        </div>
      </div>
    </div>
  );
}

export function panelwizardExample() {
  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Interactive Multi-Step Wizard</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Complete the form by filling in required fields. The Next button is disabled until all required fields are filled.
          Click on completed step indicators to navigate back.
        </Text>
        <PanelWizardDemo />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Panel Variants</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          PanelWizard inherits all Panel props including variant, border, and borderRadius.
        </Text>
        <div className={styles.exampleGrid}>
          <PanelWizardVariantDemo variant="glass" border="future" label="Glass + Future Border" />
          <PanelWizardVariantDemo variant="solid" border="solid" label="Solid + Solid Border" />
        </div>
      </div>
    </div>
  );
}

function PanelWizardDemo() {
  const [currentStep, setCurrentStep] = useState(0);
  const [personalInfo, setPersonalInfo] = useState({ name: '', email: '' });
  const [preferences, setPreferences] = useState({ notifications: true, theme: 'system' });
  const [finished, setFinished] = useState(false);

  const steps: WizardStep[] = [
    {
      id: 'personal',
      label: 'Personal Info',
      content: <PersonalInfoStep data={personalInfo} onChange={setPersonalInfo} />,
      isComplete: personalInfo.name.trim().length > 0 && personalInfo.email.trim().length > 0,
    },
    {
      id: 'preferences',
      label: 'Preferences',
      content: <PreferencesStep data={preferences} onChange={setPreferences} />,
      isComplete: true, // Preferences step has no required fields
    },
    {
      id: 'review',
      label: 'Review',
      content: <ReviewStep personalInfo={personalInfo} preferences={preferences} />,
      isComplete: true,
    },
  ];

  const handleFinish = () => {
    setFinished(true);
  };

  const handleReset = () => {
    setCurrentStep(0);
    setPersonalInfo({ name: '', email: '' });
    setPreferences({ notifications: true, theme: 'system' });
    setFinished(false);
  };

  if (finished) {
    return (
      <div style={{
        height: '350px',
        maxWidth: '500px',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        borderRadius: '12px',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
      }}>
        <Text weight="medium" size="lg" style={{ color: 'var(--color-accent)' }}>
          Setup Complete!
        </Text>
        <Text variant="secondary" size="sm" style={{ textAlign: 'center' }}>
          Welcome, {personalInfo.name}! Your account has been configured.
        </Text>
        <button
          onClick={handleReset}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text)',
            cursor: 'pointer',
          }}
        >
          Start Over
        </button>
      </div>
    );
  }

  return (
    <div style={{
      height: '350px',
      maxWidth: '500px',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      borderRadius: '12px',
      padding: '1.5rem',
    }}>
      <PanelWizard
        steps={steps}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        onFinish={handleFinish}
        style={{ height: '100%' }}
      />
    </div>
  );
}

function PanelWizardVariantDemo({
  variant,
  border,
  label,
}: {
  variant: 'glass' | 'solid' | 'transparent';
  border: 'none' | 'solid' | 'future';
  label: string;
}) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps: WizardStep[] = [
    {
      id: 'step1',
      label: 'Step 1',
      content: <SimpleStepContent step={1} />,
      isComplete: true,
    },
    {
      id: 'step2',
      label: 'Step 2',
      content: <SimpleStepContent step={2} />,
      isComplete: true,
    },
    {
      id: 'step3',
      label: 'Step 3',
      content: <SimpleStepContent step={3} />,
      isComplete: true,
    },
  ];

  return (
    <div className={styles.exampleItem}>
      <Text variant="secondary" size="sm">{label}</Text>
      <div style={{
        height: '220px',
        background: variant === 'glass'
          ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
          : 'var(--color-bg-secondary)',
        borderRadius: '8px',
        padding: '1rem',
      }}>
        <PanelWizard
          steps={steps}
          currentStep={currentStep}
          onStepChange={setCurrentStep}
          onFinish={() => setCurrentStep(0)}
          variant={variant}
          border={border}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}

function SimpleStepContent({ step }: { step: number }) {
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Text weight="medium">Step {step} Content</Text>
      <Text size="sm" variant="secondary">
        This is the content for step {step}. Use the navigation buttons below to move between steps.
      </Text>
    </div>
  );
}
