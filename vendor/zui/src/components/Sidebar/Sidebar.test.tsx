import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('should render with children', () => {
    render(<Sidebar>Test Content</Sidebar>);
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should render header when provided', () => {
    render(<Sidebar header={<div>Header Content</div>}>Main Content</Sidebar>);
    expect(screen.getByText('Header Content')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('should render footer when provided', () => {
    render(<Sidebar footer={<div>Footer Content</div>}>Main Content</Sidebar>);
    expect(screen.getByText('Footer Content')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('should not show resize handle when not resizable', () => {
    const { container } = render(<Sidebar>Content</Sidebar>);
    const resizeHandle = container.querySelector('[class*="resizeHandle"]');
    expect(resizeHandle).not.toBeInTheDocument();
  });

  it('should show resize handle when resizable', () => {
    const { container } = render(<Sidebar resizable>Content</Sidebar>);
    const resizeHandle = container.querySelector('[class*="resizeHandle"]');
    expect(resizeHandle).toBeInTheDocument();
  });

  it('should accept custom className', () => {
    const { container } = render(<Sidebar className="custom-sidebar">Content</Sidebar>);
    const sidebar = container.querySelector('aside');
    expect(sidebar).toHaveClass('custom-sidebar');
  });

  it('should apply custom width when not resizable', () => {
    const { container } = render(<Sidebar defaultWidth={300}>Content</Sidebar>);
    const sidebar = container.querySelector('aside');
    expect(sidebar).toHaveStyle({ width: '300px' });
  });
});
