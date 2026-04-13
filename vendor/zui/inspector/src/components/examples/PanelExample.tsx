import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Heading, Panel, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function panelExample() {
  const [focused, setFocused] = useState(false);

  const demoContentStyle: CSSProperties = {
    padding: '1.5rem',
    minHeight: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Default: Glass + Future Border</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Matches the Menu component's glass variant with future border style
        </Text>
        <div style={{ 
          position: 'relative', 
          padding: '2rem',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          borderRadius: '12px',
        }}>
          <Panel>
            <div style={demoContentStyle}>
              <Text>Glass background with future border corners</Text>
            </div>
          </Panel>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Background Variants</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Same variants as Menu: solid, transparent, and glass
        </Text>
        <div style={{ 
          position: 'relative', 
          padding: '2rem',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '12px',
        }}>
          <div className={styles.exampleGrid}>
            <div className={styles.exampleItem}>
              <span className={styles.variantLabel}>variant="solid"</span>
              <Panel variant="solid" border="solid">
                <div style={demoContentStyle}>
                  <Text>Solid background</Text>
                </div>
              </Panel>
            </div>

            <div className={styles.exampleItem}>
              <span className={styles.variantLabel}>variant="glass"</span>
              <Panel variant="glass" border="solid">
                <div style={demoContentStyle}>
                  <Text>Glass background</Text>
                </div>
              </Panel>
            </div>

            <div className={styles.exampleItem}>
              <span className={styles.variantLabel}>variant="transparent"</span>
              <Panel variant="transparent" border="solid">
                <div style={demoContentStyle}>
                  <Text>Transparent background</Text>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Border Types</Heading>
        <div className={styles.exampleGrid}>
          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">border="none"</Text>
            <Panel variant="solid" border="none">
              <div style={demoContentStyle}>
                <Text>No border</Text>
              </div>
            </Panel>
          </div>

          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">border="solid"</Text>
            <Panel variant="solid" border="solid">
              <div style={demoContentStyle}>
                <Text>Solid border</Text>
              </div>
            </Panel>
          </div>

          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">border="future"</Text>
            <Panel variant="solid" border="future">
              <div style={demoContentStyle}>
                <Text>Future border with corner accents</Text>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Hover States (Open / Closed)</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Hover over panels to see different hover backgrounds. Click to toggle open/closed state.
          Matches Menu component hover behavior.
        </Text>
        <div className={styles.exampleGrid}>
          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">Closed state hover</Text>
            <Panel
              hoverable
              open={false}
            >
              <div style={demoContentStyle}>
                <Text>Closed - hover: rgba(255, 255, 255, 0.05)</Text>
              </div>
            </Panel>
          </div>

          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">Open state hover</Text>
            <Panel
              hoverable
              open={true}
            >
              <div style={demoContentStyle}>
                <Text>Open - hover: rgba(0, 0, 0, 0.7)</Text>
              </div>
            </Panel>
          </div>

          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">Interactive toggle (click)</Text>
            <Panel
              hoverable
              open={focused}
              onPointerDown={() => setFocused(!focused)}
            >
              <div style={demoContentStyle}>
                <Text>{focused ? 'Open (click to close)' : 'Closed (click to open)'}</Text>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Focused State</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Focus ring uses accent color glow
        </Text>
        <div style={{ maxWidth: '400px' }}>
          <Panel focused={true}>
            <div style={demoContentStyle}>
              <Text>Focused panel with accent glow</Text>
            </div>
          </Panel>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Panel with Image + Fade Effect</Heading>
        <Text variant="secondary" size="sm" className={styles.exampleDescription}>
          Optional image at the top with gradient fade into panel background
        </Text>
        <div className={styles.exampleGrid}>
          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">Default glass with image</Text>
            <Panel
              image="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400'%3E%3Cdefs%3E%3ClinearGradient id='a' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%23667eea'/%3E%3Cstop offset='100%25' style='stop-color:%23764ba2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='400' fill='url(%23a)'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-family='system-ui' font-size='32' font-weight='600'%3ESpace Imagery%3C/text%3E%3C/svg%3E"
              imageHeight="180px"
              style={{ maxWidth: '400px' }}
            >
              <div style={{ padding: '1.5rem' }}>
                <Heading level={4}>Space Station</Heading>
                <Text variant="secondary" size="sm">
                  The fade effect seamlessly blends the image into the panel background.
                </Text>
              </div>
            </Panel>
          </div>

          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">Solid background with image</Text>
            <Panel
              variant="solid"
              border="solid"
              borderRadius="md"
              image="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400'%3E%3Cdefs%3E%3ClinearGradient id='b' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%2306b6d4'/%3E%3Cstop offset='100%25' style='stop-color:%230891b2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='400' fill='url(%23b)'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-family='system-ui' font-size='32' font-weight='600'%3ENorthern Lights%3C/text%3E%3C/svg%3E"
              imageHeight="160px"
              style={{ maxWidth: '400px' }}
            >
              <div style={{ padding: '1.5rem' }}>
                <Heading level={4}>Northern Lights</Heading>
                <Text variant="secondary" size="sm">
                  Works with any panel variant and border style.
                </Text>
              </div>
            </Panel>
          </div>

          <div className={styles.exampleItem}>
            <Text variant="secondary" size="sm">Card-like usage</Text>
            <Panel
              variant="glass"
              border="future"
              borderRadius="lg"
              image="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400'%3E%3Cdefs%3E%3ClinearGradient id='c' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%23ec4899'/%3E%3Cstop offset='100%25' style='stop-color:%238b5cf6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='400' fill='url(%23c)'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-family='system-ui' font-size='32' font-weight='600'%3EAbstract Waves%3C/text%3E%3C/svg%3E"
              imageHeight="200px"
              style={{ maxWidth: '400px' }}
            >
              <div style={{ padding: '1.5rem' }}>
                <Heading level={4}>Abstract Waves</Heading>
                <Text variant="secondary" size="sm">
                  Perfect for cards, profiles, or featured content.
                </Text>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>Window-like Usage</Heading>
        <Panel style={{ maxWidth: '500px' }}>
          <div style={{ 
            padding: '0.5rem 1rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <Text size="sm" weight="medium">Window Title</Text>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fbbf24' }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#34d399' }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f87171' }} />
            </div>
          </div>
          <div style={{ padding: '1.5rem' }}>
            <Text variant="secondary">
              Panels serve as the base for windows, dialogs, dropdowns, and menus. 
              The glass + future border combination provides a cohesive look.
            </Text>
          </div>
        </Panel>
      </div>
    </div>
  );
}
