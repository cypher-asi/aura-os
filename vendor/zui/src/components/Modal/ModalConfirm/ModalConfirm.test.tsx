import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalConfirm } from './ModalConfirm';

describe('ModalConfirm', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Confirm Action',
    message: 'Are you sure?',
  };

  describe('buttons', () => {
    it('should render confirm and cancel buttons', () => {
      render(<ModalConfirm {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('should use custom button labels', () => {
      render(<ModalConfirm {...defaultProps} confirmLabel="Delete" cancelLabel="Keep" />);

      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    });
  });

  describe('confirm action', () => {
    it('should call onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn();
      render(<ModalConfirm {...defaultProps} onConfirm={onConfirm} />);

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when cancel button is clicked', () => {
      const onClose = vi.fn();
      render(<ModalConfirm {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('message', () => {
    it('should render message text', () => {
      render(<ModalConfirm {...defaultProps} />);
      expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    });

    it('should render complex message content', () => {
      render(
        <ModalConfirm
          {...defaultProps}
          message={
            <div>
              <strong>Warning:</strong> This cannot be undone.
            </div>
          }
        />
      );
      expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('should disable buttons when isLoading is true', () => {
      render(<ModalConfirm {...defaultProps} isLoading />);

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('should enable buttons when isLoading is false', () => {
      render(<ModalConfirm {...defaultProps} isLoading={false} />);

      expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
    });
  });

  describe('danger mode', () => {
    it('should apply danger styling when danger is true', () => {
      render(<ModalConfirm {...defaultProps} danger />);
      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      // CSS modules hash class names, check if any class contains 'dangerButton'
      const hasDangerClass = Array.from(confirmButton.classList).some((cls) =>
        cls.includes('dangerButton')
      );
      expect(hasDangerClass).toBe(true);
    });
  });

  describe('title', () => {
    it('should render title', () => {
      render(<ModalConfirm {...defaultProps} />);
      expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    });
  });

  describe('visibility', () => {
    it('should not render when isOpen is false', () => {
      render(<ModalConfirm {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
      render(<ModalConfirm {...defaultProps} isOpen />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
