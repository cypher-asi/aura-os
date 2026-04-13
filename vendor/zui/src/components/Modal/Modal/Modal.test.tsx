import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Test Modal',
    children: <div>Modal content</div>,
  };

  describe('open/close behavior', () => {
    it('should render when isOpen is true', () => {
      render(<Modal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Test Modal')).toBeInTheDocument();
      expect(screen.getByText('Modal content')).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
      render(<Modal {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<Modal {...defaultProps} onClose={onClose} />);

      const closeButton = screen.getByRole('button');
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('overlay click', () => {
    it('should call onClose when clicking overlay', () => {
      const onClose = vi.fn();
      render(<Modal {...defaultProps} onClose={onClose} />);

      const overlay = screen.getByRole('dialog');
      fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not close when clicking modal content', () => {
      const onClose = vi.fn();
      render(<Modal {...defaultProps} onClose={onClose} />);

      const modalContent = screen.getByText('Modal content');
      fireEvent.click(modalContent);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('escape key', () => {
    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<Modal {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not respond to other keys', () => {
      const onClose = vi.fn();
      render(<Modal {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Enter' });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('subtitle', () => {
    it('should render subtitle when provided', () => {
      render(<Modal {...defaultProps} subtitle="Modal subtitle" />);
      expect(screen.getByText('Modal subtitle')).toBeInTheDocument();
    });

    it('should not render subtitle when not provided', () => {
      render(<Modal {...defaultProps} />);
      expect(screen.queryByText('Modal subtitle')).not.toBeInTheDocument();
    });
  });

  describe('footer', () => {
    it('should render footer when provided', () => {
      render(<Modal {...defaultProps} footer={<button>Save</button>} />);
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
  });

  describe('header actions', () => {
    it('should render header actions when provided', () => {
      render(<Modal {...defaultProps} headerActions={<button>Action</button>} />);
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });
  });

  describe('sizes', () => {
    it('should apply size class', () => {
      render(<Modal {...defaultProps} size="lg" />);
      const dialog = screen.getByRole('dialog');
      // Modal uses CSS modules, check for class containing 'lg'
      const hasLgClass = Array.from(dialog.querySelectorAll('*')).some((el) =>
        Array.from(el.classList).some((cls) => cls.includes('lg'))
      );
      expect(hasLgClass).toBe(true);
    });
  });

  describe('fullHeight', () => {
    it('should apply fullHeight class when enabled', () => {
      render(<Modal {...defaultProps} fullHeight />);
      const dialog = screen.getByRole('dialog');
      // Modal uses CSS modules, check for class containing 'fullHeight'
      const hasFullHeightClass = Array.from(dialog.querySelectorAll('*')).some((el) =>
        Array.from(el.classList).some((cls) => cls.includes('fullHeight'))
      );
      expect(hasFullHeightClass).toBe(true);
    });
  });
});
