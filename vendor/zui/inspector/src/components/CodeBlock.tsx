import { Highlight } from 'prism-react-renderer';
import { useTheme } from '@cypher-asi/zui';
import { getComponentSource } from '../data/componentSources';
import { neonThemeDark, neonThemeLight } from '../styles/neon-theme';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  componentId: string;
}

export function CodeBlock({ componentId }: CodeBlockProps) {
  const code = getComponentSource(componentId);
  const { resolvedTheme } = useTheme();
  
  // Select the appropriate syntax highlighting theme
  const syntaxTheme = resolvedTheme === 'light' ? neonThemeLight : neonThemeDark;

  return (
    <div className={styles.codeBlock}>
      <div className={styles.header}>
        <span className={styles.languageLabel}>tsx</span>
      </div>
      <Highlight
        theme={syntaxTheme}
        code={code}
        language="tsx"
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={className} style={style}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                <span className={styles.lineNumber}>{i + 1}</span>
                <span className={styles.lineContent}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
