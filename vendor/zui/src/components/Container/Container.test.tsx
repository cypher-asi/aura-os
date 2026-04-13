import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Container } from './Container';

describe('Container', () => {
  it('renders children', () => {
    render(<Container>Test Content</Container>);
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <Container className="custom-class">Content</Container>
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('forwards HTML attributes', () => {
    render(<Container data-testid="test-container">Content</Container>);
    expect(screen.getByTestId('test-container')).toBeInTheDocument();
  });

  it('applies fullBleed styles when prop is true', () => {
    const { container } = render(
      <Container fullBleed data-testid="full-bleed-container">Content</Container>
    );
    const element = screen.getByTestId('full-bleed-container');
    expect(element).toHaveClass('fullBleed');
  });

  it('does not apply fullBleed styles by default', () => {
    const { container } = render(
      <Container data-testid="default-container">Content</Container>
    );
    const element = screen.getByTestId('default-container');
    expect(element).not.toHaveClass('fullBleed');
  });
});
