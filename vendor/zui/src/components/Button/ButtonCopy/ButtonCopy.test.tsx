import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ButtonCopy } from './ButtonCopy';

// Mock clipboard API
const mockWriteText = vi.fn();

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: {
      writeText: mockWriteText,
    },
  });
  mockWriteText.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ButtonCopy', () => {
  it('renders with default props', () => {
    render(<ButtonCopy text="test" />);
    const button = screen.getByRole('button', { name: /copy/i });
    expect(button).toBeInTheDocument();
  });

  it('copies text to clipboard when clicked', async () => {
    render(<ButtonCopy text="Hello World" />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(mockWriteText).toHaveBeenCalledWith('Hello World');
  });

  it('calls onCopy callback after copying', async () => {
    const handleCopy = vi.fn();
    render(<ButtonCopy text="test" onCopy={handleCopy} />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(handleCopy).toHaveBeenCalledTimes(1);
    });
  });

  it('shows "Copied!" title after clicking', async () => {
    render(<ButtonCopy text="test" />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(button).toHaveAttribute('title', 'Copied!');
    });
  });

  it('does not copy when disabled', () => {
    render(<ButtonCopy text="test" disabled />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it('renders with custom title', () => {
    render(<ButtonCopy text="test" title="Copy to clipboard" />);
    const button = screen.getByRole('button', { name: /copy to clipboard/i });
    expect(button).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<ButtonCopy text="test" className="custom-class" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('custom-class');
  });

  it('renders disabled state', () => {
    render(<ButtonCopy text="test" disabled />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('handles clipboard error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockWriteText.mockRejectedValue(new Error('Clipboard error'));
    
    render(<ButtonCopy text="test" />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to copy text:', expect.any(Error));
    });
    
    consoleSpy.mockRestore();
  });
});
