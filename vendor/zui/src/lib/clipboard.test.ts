import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard } from './clipboard';

describe('Clipboard Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('copyToClipboard', () => {
    it('should copy text to clipboard', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      await copyToClipboard('test text');

      expect(writeTextMock).toHaveBeenCalledWith('test text');
    });

    it('should handle clipboard errors', async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard error'));
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      await expect(copyToClipboard('test')).rejects.toThrow('Clipboard error');
    });
  });
});
