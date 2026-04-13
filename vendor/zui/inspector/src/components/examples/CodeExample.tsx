import { Code, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function codeExample() {
  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Default Variant</Heading>
        <div className={styles.row} style={{ flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
          <p>
            Use the <Code>npm install</Code> command to install dependencies for your project.
          </p>
          <p>
            The <Code>useState</Code> and <Code>useEffect</Code> hooks are essential in React development.
          </p>
          <p>
            Set the environment variable <Code>NODE_ENV=production</Code> before deploying.
          </p>
          <p>
            Import components with <Code>import {'{ Button }'} from '@cypher-asi/zui'</Code> syntax.
          </p>
          <p>
            Files like <Code>package.json</Code>, <Code>tsconfig.json</Code>, and <Code>.env</Code> are configuration files.
          </p>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Accent Variant</Heading>
        <div className={styles.row} style={{ flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
          <p>
            To start the development server, run <Code variant="accent">npm run dev</Code> in your terminal.
          </p>
          <p>
            The <Code variant="accent">React.memo()</Code> function optimizes component rendering performance.
          </p>
          <p>
            Access variables with <Code variant="accent">process.env.VARIABLE_NAME</Code> in Node.js.
          </p>
          <p>
            Use <Code variant="accent">git commit -m "message"</Code> to commit your staged changes.
          </p>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Common Use Cases</Heading>
        <div className={styles.row} style={{ flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
          <p>
            Commands and CLI instructions: <Code>npm install</Code>, <Code>git push</Code>
          </p>
          <p>
            Function and variable names: <Code>useState</Code>, <Code>handleClick</Code>
          </p>
          <p>
            File paths and names: <Code>package.json</Code>, <Code>/src/components</Code>
          </p>
          <p>
            Environment variables: <Code>NODE_ENV</Code>, <Code>API_KEY</Code>
          </p>
          <p>
            Note: Always used inline within text, never as standalone blocks
          </p>
        </div>
      </div>
    </div>
  );
}
