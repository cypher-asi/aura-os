import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel } from './Panel';

describe('Panel', () => {
  it('renders children', () => {
    render(<Panel>Panel content</Panel>);
    expect(screen.getByText('Panel content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<Panel className="custom-class">Content</Panel>);
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('applies glass variant by default', () => {
    const { container } = render(<Panel>Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.backgroundColor).toBeDefined();
  });

  it('applies solid variant styles', () => {
    const { container } = render(<Panel variant="solid">Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.backgroundColor).toContain('var(--color-bg');
  });

  it('applies transparent variant styles', () => {
    const { container } = render(<Panel variant="transparent">Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.backgroundColor).toBe('transparent');
  });

  it('applies future border class by default', () => {
    const { container } = render(<Panel>Content</Panel>);
    expect(container.querySelector('.border-future')).toBeInTheDocument();
  });

  it('applies solid border when specified', () => {
    const { container } = render(<Panel border="solid">Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.border).toContain('1px solid');
  });

  it('applies focused state', () => {
    const { container } = render(<Panel focused>Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.boxShadow).toContain('var(--color-accent');
  });

  it('forwards ref', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Panel ref={ref}>Content</Panel>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('spreads additional props', () => {
    render(<Panel data-testid="test-panel">Content</Panel>);
    expect(screen.getByTestId('test-panel')).toBeInTheDocument();
  });

  it('applies semantic background "bg"', () => {
    const { container } = render(<Panel background="bg">Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.backgroundColor).toBe('var(--color-bg)');
  });

  it('applies semantic background "surface"', () => {
    const { container } = render(<Panel background="surface">Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.backgroundColor).toBe('var(--color-surface)');
  });

  it('applies semantic background "elevated"', () => {
    const { container } = render(<Panel background="elevated">Content</Panel>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.backgroundColor).toBe('var(--color-elevated)');
  });

  it('background overrides variant', () => {
    const { container } = render(
      <Panel variant="glass" background="surface">Content</Panel>
    );
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.backgroundColor).toBe('var(--color-surface)');
  });
});
