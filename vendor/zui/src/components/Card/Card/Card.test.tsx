import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from './Card';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Card', () => {
  describe('children', () => {
    it('should render children', () => {
      render(<Card>Card content</Card>);
      expect(screen.getByText('Card content')).toBeInTheDocument();
    });

    it('should render complex children', () => {
      render(
        <Card>
          <h1>Title</h1>
          <p>Description</p>
        </Card>
      );
      expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
      expect(screen.getByText('Description')).toBeInTheDocument();
    });
  });

  describe('click handling', () => {
    it('should handle onClick', () => {
      const handleClick = vi.fn();
      const { container } = render(<Card onClick={handleClick}>Clickable card</Card>);

      // Card wraps content directly, so find the card element
      const card = container.firstChild as HTMLElement;
      fireEvent.click(card);

      expect(handleClick).toHaveBeenCalled();
    });
  });

  describe('custom className', () => {
    it('should accept custom className', () => {
      const { container } = render(<Card className="custom-card">Content</Card>);
      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('custom-card');
    });

    it('should preserve base card class', () => {
      const { container } = render(<Card className="custom-card">Content</Card>);
      const card = container.firstChild as HTMLElement;
      expect(hasModuleClass(card, 'card')).toBe(true);
    });
  });

  describe('HTML attributes', () => {
    it('should pass through HTML attributes', () => {
      render(<Card data-testid="my-card">Content</Card>);
      expect(screen.getByTestId('my-card')).toBeInTheDocument();
    });

    it('should support role attribute', () => {
      render(<Card role="button">Button Card</Card>);
      expect(screen.getByRole('button', { name: 'Button Card' })).toBeInTheDocument();
    });
  });
});
