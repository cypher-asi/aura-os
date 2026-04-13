import { CodeBlock, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function codeblockExample() {
  const tsxCode = `import { useState } from 'react';
import { Button } from '@cypher-asi/zui';

export function App() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <h1>Counter: {count}</h1>
      <Button onClick={() => setCount(count + 1)}>
        Increment
      </Button>
    </div>
  );
}`;

  const tsCode = `interface User {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

const user: User = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  isActive: true
};

function greetUser(user: User): string {
  return \`Hello, \${user.name}!\`;
}`;

  const jsonCode = `{
  "name": "@cypher-asi/zui",
  "version": "0.1.0",
  "dependencies": {
    "react": "^18.2.0",
    "typescript": "^5.3.3",
    "prism-react-renderer": "^2.3.1"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}`;

  const cssCode = `.container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  background: var(--color-elevated);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
}

.container:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}`;

  const bashCode = `# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run tests
npm test`;

  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>TSX/React Component</Heading>
        <CodeBlock language="tsx" code={tsxCode} showLineNumbers />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>TypeScript with Line Numbers</Heading>
        <CodeBlock language="typescript" code={tsCode} showLineNumbers />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>JSON Configuration</Heading>
        <CodeBlock language="json" code={jsonCode} />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>CSS Styling</Heading>
        <CodeBlock language="css" code={cssCode} />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Bash Commands</Heading>
        <CodeBlock language="bash" code={bashCode} showLanguageLabel={false} />
      </div>
    </div>
  );
}
