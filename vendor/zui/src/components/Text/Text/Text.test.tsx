import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Text } from './Text';

describe('Text', () => {
  it('renders children', () => {
    render(<Text>Hello World</Text>);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    const { container } = render(<Text variant="secondary">Text</Text>);
    const text = container.firstChild as HTMLElement;
    expect(text.className).toContain('secondary');
  });

  it('applies size classes', () => {
    const { container } = render(<Text size="lg">Text</Text>);
    const text = container.firstChild as HTMLElement;
    expect(text.className).toContain('lg');
  });

  it('applies weight classes', () => {
    const { container } = render(<Text weight="semibold">Text</Text>);
    const text = container.firstChild as HTMLElement;
    expect(text.className).toContain('semibold');
  });

  it('renders as different element when as prop is provided', () => {
    render(<Text as="span">Span text</Text>);
    expect(screen.getByText('Span text').tagName).toBe('SPAN');
  });

  it('applies custom className', () => {
    const { container } = render(<Text className="custom">Text</Text>);
    const text = container.firstChild as HTMLElement;
    expect(text.className).toContain('custom');
  });

  it('applies text alignment', () => {
    const { container } = render(<Text align="center">Centered</Text>);
    const text = container.firstChild as HTMLElement;
    expect(text.className).toContain('center');
  });
});
