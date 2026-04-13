import { Container, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function containerExample() {
  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Default Container</Heading>
        <Container className={styles.containerDemo}>
          <p style={{ margin: 0 }}>Default container - constrains content width and centers it horizontally.</p>
        </Container>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Full Bleed Container</Heading>
        <Container fullBleed className={styles.containerDemo}>
          <p style={{ margin: 0 }}>Full bleed container - extends to full width with horizontal padding.</p>
        </Container>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Nested Containers</Heading>
        <Container className={styles.containerDemo}>
          <p style={{ margin: 0, marginBottom: '1rem' }}>Outer container with max-width constraint.</p>
          <Container fullBleed className={styles.containerDemoInner}>
            <p style={{ margin: 0 }}>Inner full-bleed container spans full width of parent.</p>
          </Container>
        </Container>
      </div>
    </div>
  );
}
