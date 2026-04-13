import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  describe('rendering', () => {
    it('should render with title', () => {
      render(<PageHeader title="Test Page" />);
      expect(screen.getByRole('heading', { name: 'Test Page' })).toBeInTheDocument();
    });

    it('should render with subtitle', () => {
      render(<PageHeader title="Test Page" subtitle="This is a subtitle" />);
      expect(screen.getByText('This is a subtitle')).toBeInTheDocument();
    });

    it('should render with count', () => {
      render(<PageHeader title="Test Page" count={42} />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should render with string count', () => {
      render(<PageHeader title="Test Page" count="10+" />);
      expect(screen.getByText('10+')).toBeInTheDocument();
    });

    it('should render with actions', () => {
      render(
        <PageHeader
          title="Test Page"
          actions={<button data-testid="action-btn">Action</button>}
        />
      );
      expect(screen.getByTestId('action-btn')).toBeInTheDocument();
    });

    it('should render with subtitle as ReactNode', () => {
      render(
        <PageHeader
          title="Test Page"
          subtitle={
            <span data-testid="custom-subtitle">
              Custom <strong>subtitle</strong>
            </span>
          }
        />
      );
      expect(screen.getByTestId('custom-subtitle')).toBeInTheDocument();
    });
  });

  describe('props', () => {
    it('should accept custom className', () => {
      const { container } = render(<PageHeader title="Test Page" className="custom-class" />);
      const header = container.querySelector('header');
      expect(header).toHaveClass('custom-class');
    });

    it('should spread additional props to header element', () => {
      render(<PageHeader title="Test Page" data-testid="custom-header" />);
      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    });

    it('should not render count when undefined', () => {
      const { container } = render(<PageHeader title="Test Page" />);
      const count = container.querySelector('.count');
      expect(count).not.toBeInTheDocument();
    });

    it('should not render actions section when no actions provided', () => {
      const { container } = render(<PageHeader title="Test Page" />);
      const actionsContainer = container.querySelector('.headerRight');
      expect(actionsContainer).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should use semantic header element', () => {
      const { container } = render(<PageHeader title="Test Page" />);
      const header = container.querySelector('header');
      expect(header).toBeInTheDocument();
    });

    it('should use h1 for title', () => {
      render(<PageHeader title="Test Page" />);
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toBeInTheDocument();
    });
  });

  describe('combinations', () => {
    it('should render all props together', () => {
      render(
        <PageHeader
          title="Test Page"
          subtitle="A test subtitle"
          count={99}
          actions={<button>Click me</button>}
          className="custom"
        />
      );

      expect(screen.getByRole('heading', { name: 'Test Page' })).toBeInTheDocument();
      expect(screen.getByText('A test subtitle')).toBeInTheDocument();
      expect(screen.getByText('99')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
    });
  });
});
