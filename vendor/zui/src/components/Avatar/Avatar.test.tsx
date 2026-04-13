import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('renders with initials when no src is provided', () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('renders with single name initial', () => {
    render(<Avatar name="John" />);
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  it('renders with three word name using first two initials', () => {
    render(<Avatar name="John William Doe" />);
    expect(screen.getByText('JW')).toBeInTheDocument();
  });

  it('renders image when src is provided', () => {
    render(<Avatar name="John Doe" src="/test.jpg" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/test.jpg');
    expect(img).toHaveAttribute('alt', 'John Doe');
  });

  it('uses custom alt text when provided', () => {
    render(<Avatar name="John Doe" src="/test.jpg" alt="Custom alt" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', 'Custom alt');
  });

  it('applies size classes correctly', () => {
    const { container } = render(<Avatar name="John Doe" size="lg" />);
    const avatar = container.firstChild;
    expect(avatar).toHaveClass('lg');
  });

  it('applies square variant correctly', () => {
    const { container } = render(<Avatar name="John Doe" square />);
    const avatar = container.firstChild;
    expect(avatar).toHaveClass('square');
  });

  it('applies custom className', () => {
    const { container } = render(<Avatar name="John Doe" className="custom" />);
    const avatar = container.firstChild;
    expect(avatar).toHaveClass('custom');
  });

  it('handles lowercase names', () => {
    render(<Avatar name="john doe" />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('handles names with extra spaces', () => {
    render(<Avatar name="  John   Doe  " />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });
});
