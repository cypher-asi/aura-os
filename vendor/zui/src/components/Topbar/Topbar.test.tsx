import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Topbar } from './Topbar';

describe('Topbar', () => {
  it('should render with title', () => {
    render(<Topbar title="Test Title" />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('should render icon when provided', () => {
    render(<Topbar title="Title" icon={<span data-testid="icon">Icon</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('should render actions when provided', () => {
    render(<Topbar title="Title" actions={<button>Action</button>} />);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('should not render icon container when icon is not provided', () => {
    const { container } = render(<Topbar title="Title" />);
    const iconSpan = container.querySelector('[class*="icon"]');
    expect(iconSpan).not.toBeInTheDocument();
  });

  it('should not render actions container when actions are not provided', () => {
    const { container } = render(<Topbar title="Title" />);
    const actionsDiv = container.querySelector('[class*="actions"]');
    expect(actionsDiv).not.toBeInTheDocument();
  });

  it('should accept custom className', () => {
    const { container } = render(<Topbar title="Title" className="custom-topbar" />);
    const header = container.querySelector('header');
    expect(header).toHaveClass('custom-topbar');
  });

  it('should render as header element', () => {
    const { container } = render(<Topbar title="Title" />);
    const header = container.querySelector('header');
    expect(header).toBeInTheDocument();
  });
});
