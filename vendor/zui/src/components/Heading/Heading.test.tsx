import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Heading } from './Heading';

describe('Heading', () => {
  it('renders children', () => {
    render(<Heading>Test Heading</Heading>);
    expect(screen.getByText('Test Heading')).toBeInTheDocument();
  });

  it('renders h2 by default', () => {
    render(<Heading>Default</Heading>);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders different heading levels', () => {
    render(<Heading level={1}>H1</Heading>);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    const { container } = render(<Heading variant="secondary">Secondary</Heading>);
    const heading = container.firstChild as HTMLElement;
    expect(heading.className).toContain('secondary');
  });

  it('applies custom className', () => {
    const { container } = render(<Heading className="custom">Custom</Heading>);
    const heading = container.firstChild as HTMLElement;
    expect(heading.className).toContain('custom');
  });

  it('applies correct level class', () => {
    const { container } = render(<Heading level={3}>H3</Heading>);
    const heading = container.firstChild as HTMLElement;
    expect(heading.className).toContain('level3');
  });
});
