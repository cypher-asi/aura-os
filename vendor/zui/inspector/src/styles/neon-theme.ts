import { PrismTheme } from 'prism-react-renderer';

// Dark theme - Classy futuristic syntax highlighting
export const neonThemeDark: PrismTheme = {
  plain: {
    color: '#e6e8eb',
    backgroundColor: '#09090b',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: {
        color: '#7a8ba3',
        fontStyle: 'italic',
      },
    },
    {
      types: ['namespace'],
      style: {
        opacity: 0.7,
      },
    },
    {
      types: ['string', 'attr-value'],
      style: {
        color: '#01f4cb',
      },
    },
    {
      types: ['punctuation', 'operator'],
      style: {
        color: '#9db4e6',
      },
    },
    {
      types: ['entity', 'url', 'symbol', 'number', 'boolean', 'constant', 'regex', 'inserted'],
      style: {
        color: '#ffb86c',
      },
    },
    {
      types: ['atrule', 'keyword', 'attr-name', 'selector'],
      style: {
        color: '#cb01f4',
      },
    },
    {
      types: ['function', 'deleted', 'tag'],
      style: {
        color: '#01a4f4',
      },
    },
    {
      types: ['function-variable'],
      style: {
        color: '#01a4f4',
      },
    },
    {
      types: ['variable'],
      style: {
        color: '#d8b1f0',
      },
    },
    {
      types: ['property'],
      style: {
        color: '#b8d5f6',
      },
    },
    {
      types: ['class-name'],
      style: {
        color: '#ffd866',
      },
    },
    {
      types: ['parameter'],
      style: {
        color: '#f8c892',
      },
    },
    {
      types: ['char'],
      style: {
        color: '#01f4cb',
      },
    },
  ],
};

// Light theme - Higher contrast for readability
export const neonThemeLight: PrismTheme = {
  plain: {
    color: '#1f2937',
    backgroundColor: '#f8f9fa',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: {
        color: '#6b7280',
        fontStyle: 'italic',
      },
    },
    {
      types: ['namespace'],
      style: {
        opacity: 0.8,
      },
    },
    {
      types: ['string', 'attr-value'],
      style: {
        color: '#059669',
      },
    },
    {
      types: ['punctuation', 'operator'],
      style: {
        color: '#4b5563',
      },
    },
    {
      types: ['entity', 'url', 'symbol', 'number', 'boolean', 'constant', 'regex', 'inserted'],
      style: {
        color: '#d97706',
      },
    },
    {
      types: ['atrule', 'keyword', 'attr-name', 'selector'],
      style: {
        color: '#7c3aed',
      },
    },
    {
      types: ['function', 'deleted', 'tag'],
      style: {
        color: '#2563eb',
      },
    },
    {
      types: ['function-variable'],
      style: {
        color: '#2563eb',
      },
    },
    {
      types: ['variable'],
      style: {
        color: '#7c3aed',
      },
    },
    {
      types: ['property'],
      style: {
        color: '#0891b2',
      },
    },
    {
      types: ['class-name'],
      style: {
        color: '#b45309',
      },
    },
    {
      types: ['parameter'],
      style: {
        color: '#9a3412',
      },
    },
    {
      types: ['char'],
      style: {
        color: '#059669',
      },
    },
  ],
};

// Default export for backwards compatibility
export const neonTheme = neonThemeDark;
