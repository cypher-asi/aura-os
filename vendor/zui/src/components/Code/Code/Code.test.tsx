import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Code } from './Code';

describe('Code', () => {
  it('renders children', () => {
    render(<Code>const x = 42;</Code>);
    expect(screen.getByText('const x = 42;')).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    const { container } = render(<Code variant="accent">code</Code>);
    const code = container.firstChild as HTMLElement;
    expect(code.className).toContain('accent');
  });

  it('applies custom className', () => {
    const { container } = render(<Code className="custom">code</Code>);
    const code = container.firstChild as HTMLElement;
    expect(code.className).toContain('custom');
  });

  it('renders as code element', () => {
    const { container } = render(<Code>test</Code>);
    expect(container.firstChild?.nodeName).toBe('CODE');
  });
});
