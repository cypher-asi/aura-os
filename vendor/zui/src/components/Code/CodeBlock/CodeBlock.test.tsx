import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeBlock } from './CodeBlock';

describe('CodeBlock', () => {
  it('renders code content', () => {
    render(<CodeBlock>const x = 42;</CodeBlock>);
    expect(screen.getByText(/const x = 42;/)).toBeInTheDocument();
  });

  it('displays line numbers when enabled', () => {
    const code = 'line 1\nline 2\nline 3';
    const { container } = render(<CodeBlock showLineNumbers>{code}</CodeBlock>);
    const lineNumbers = container.querySelectorAll('[class*="lineNumber"]');
    expect(lineNumbers.length).toBe(3);
  });

  it('does not display line numbers by default', () => {
    const { container } = render(<CodeBlock>code</CodeBlock>);
    const lineNumbers = container.querySelectorAll('[class*="lineNumber"]');
    expect(lineNumbers.length).toBe(0);
  });

  it('applies language data attribute', () => {
    const { container } = render(<CodeBlock language="typescript">code</CodeBlock>);
    const codeBlock = container.querySelector('[data-language]');
    expect(codeBlock?.getAttribute('data-language')).toBe('typescript');
  });

  it('applies custom className', () => {
    const { container } = render(<CodeBlock className="custom">code</CodeBlock>);
    const codeBlock = container.firstChild as HTMLElement;
    expect(codeBlock.className).toContain('custom');
  });
});
