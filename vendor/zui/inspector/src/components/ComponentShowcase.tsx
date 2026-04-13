import { Heading, Text, Code, Container } from '@cypher-asi/zui';
import { ComponentInfo } from '../data/componentRegistry';
import { CodeBlock } from './CodeBlock';
import * as Examples from './examples';
import styles from './ComponentShowcase.module.css';

interface ComponentShowcaseProps {
  component: ComponentInfo;
}

export function ComponentShowcase({ component }: ComponentShowcaseProps) {
  // Get the example component dynamically
  const baseKey = component.id.replace(/-/g, '');
  const ExampleComponent = (Examples as any)[`${baseKey}Example`];
  
  // Look for additional example variants (e.g., navitemWithoutIconExample, navitemStatesExample)
  // Must match exact baseKey followed by uppercase letter to avoid "code" matching "codeblock"
  const additionalExamples: Array<{ key: string; component: any }> = [];
  const exactBaseKeyPattern = new RegExp(`^${baseKey}[A-Z].*Example$`);
  Object.keys(Examples).forEach((key) => {
    if (key !== `${baseKey}Example` && exactBaseKeyPattern.test(key)) {
      additionalExamples.push({
        key,
        component: (Examples as any)[key],
      });
    }
  });

  return (
    <div className={styles.showcase}>
      <header className={styles.header}>
        <Heading level={1} className={styles.title}>{component.name}</Heading>
      </header>

      <section className={styles.section}>
        <Heading level={2} className={styles.sectionTitle}>Description</Heading>
        <Text variant="secondary" size="lg" className={styles.description}>{component.description}</Text>
      </section>

      {(ExampleComponent || additionalExamples.length > 0) && (
        <section className={styles.section}>
          <Heading level={2} className={styles.sectionTitle}>Examples</Heading>
          <div className={styles.exampleContainer}>
            {ExampleComponent && <ExampleComponent />}
            {additionalExamples.map(({ key, component: AdditionalExample }) => (
              <AdditionalExample key={key} />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <Heading level={2} className={styles.sectionTitle}>Source Code</Heading>
        <Text variant="secondary" className={styles.codeNote}>
          Below is a reference implementation. View the full source in the{' '}
          <Code>zui/src/components</Code> directory.
        </Text>
        <Container fullBleed>
          <CodeBlock componentId={component.id} />
        </Container>
      </section>
    </div>
  );
}
