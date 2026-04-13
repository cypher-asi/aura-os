import { useState } from 'react';
import { Drawer, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function drawerExample() {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [leftNoBorderOpen, setLeftNoBorderOpen] = useState(false);
  const [rightNoBorderOpen, setRightNoBorderOpen] = useState(false);

  return (
    <>
      {/* Features */}
      <div className={styles.exampleGrid}>
        <div className={styles.exampleItem}>
          <Heading level={3} className={styles.exampleTitle}>Features</Heading>
          <ul className={styles.featureList}>
            <li className={styles.featureItem}>
              <strong>Resizable:</strong> Drag the resize handle to adjust size
            </li>
            <li className={styles.featureItem}>
              <strong>Toggle Mode:</strong> Use showToggle for always-visible open/close chevron
            </li>
            <li className={styles.featureItem}>
              <strong>No Border:</strong> Use noBorder prop to remove border
            </li>
            <li className={styles.featureItem}>
              <strong>Transparent:</strong> Use transparent prop for transparent bg and no border
            </li>
          </ul>
        </div>
      </div>

      {/* Left Side with Title */}
      <div className={styles.sectionMarginTop}>
        <Heading level={3} className={styles.exampleTitle}>Left Side (side="left")</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Default background with border and <code className={styles.codeInline}>showToggle</code>.
        </Text>
      </div>

      <div className={styles.drawerExampleRow}>
        <div className={`${styles.drawerDemoContainer} ${styles.drawerExampleFlex}`}>
          <Drawer
            side="left"
            isOpen={leftOpen}
            onClose={() => setLeftOpen(false)}
            onOpen={() => setLeftOpen(true)}
            title="Explorer"
            defaultSize={180}
            minSize={120}
            maxSize={250}
            showToggle
          >
            <div style={{ padding: '8px 12px' }}>Content here</div>
          </Drawer>
          <div className={styles.drawerDemoContent}>
            <p className={styles.drawerDemoText}>Main content area</p>
          </div>
        </div>

        <div className={`${styles.drawerDemoContainer} ${styles.drawerExampleFlex}`}>
          <Drawer
            side="left"
            isOpen={leftNoBorderOpen}
            onClose={() => setLeftNoBorderOpen(false)}
            onOpen={() => setLeftNoBorderOpen(true)}
            title="Files"
            defaultSize={180}
            minSize={120}
            maxSize={250}
            showToggle
          >
            <div style={{ padding: '8px 12px' }}>Content here</div>
          </Drawer>
          <div className={styles.drawerDemoContent}>
            <p className={styles.drawerDemoText}>Main content area</p>
          </div>
        </div>
      </div>

      {/* Right Side with Title */}
      <div className={styles.sectionMarginTop}>
        <Heading level={3} className={styles.exampleTitle}>Right Side (side="right")</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Same configuration on the right side.
        </Text>
      </div>

      <div className={styles.drawerExampleRow}>
        <div className={`${styles.drawerDemoContainer} ${styles.drawerExampleFlex}`}>
          <div className={styles.drawerDemoContent}>
            <p className={styles.drawerDemoText}>Main content area</p>
          </div>
          <Drawer
            side="right"
            isOpen={rightOpen}
            onClose={() => setRightOpen(false)}
            onOpen={() => setRightOpen(true)}
            title="Properties"
            defaultSize={180}
            minSize={120}
            maxSize={250}
            showToggle
          >
            <div style={{ padding: '8px 12px' }}>Content here</div>
          </Drawer>
        </div>

        <div className={`${styles.drawerDemoContainer} ${styles.drawerExampleFlex}`}>
          <div className={styles.drawerDemoContent}>
            <p className={styles.drawerDemoText}>Main content area</p>
          </div>
          <Drawer
            side="right"
            isOpen={rightNoBorderOpen}
            onClose={() => setRightNoBorderOpen(false)}
            onOpen={() => setRightNoBorderOpen(true)}
            title="Inspector"
            defaultSize={180}
            minSize={120}
            maxSize={250}
            showToggle
          >
            <div style={{ padding: '8px 12px' }}>Content here</div>
          </Drawer>
        </div>
      </div>
    </>
  );
}
