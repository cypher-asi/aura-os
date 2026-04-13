import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from './Tabs';

const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

const tabs = [
  { id: 'a', label: 'Tab A' },
  { id: 'b', label: 'Tab B' },
];

describe('Tabs', () => {
  it('renders all tabs', () => {
    render(<Tabs tabs={tabs} value="a" />);
    expect(screen.getByText('Tab A')).toBeInTheDocument();
    expect(screen.getByText('Tab B')).toBeInTheDocument();
  });

  it('calls onChange when a tab is clicked', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByText('Tab B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('marks the active tab', () => {
    render(<Tabs tabs={tabs} value="a" />);
    expect(hasModuleClass(screen.getByText('Tab A'), 'active')).toBe(true);
    expect(hasModuleClass(screen.getByText('Tab B'), 'active')).toBe(false);
  });

  describe('size', () => {
    it('does not apply size class for default sm', () => {
      render(<Tabs tabs={tabs} value="a" />);
      const tab = screen.getByText('Tab A');
      expect(hasModuleClass(tab, 'tabXs')).toBe(false);
      expect(hasModuleClass(tab, 'tabMd')).toBe(false);
    });

    it('applies tabXs class when size is xs', () => {
      render(<Tabs tabs={tabs} value="a" size="xs" />);
      const tab = screen.getByText('Tab A');
      expect(hasModuleClass(tab, 'tabXs')).toBe(true);
    });

    it('applies tabMd class when size is md', () => {
      render(<Tabs tabs={tabs} value="a" size="md" />);
      const tab = screen.getByText('Tab A');
      expect(hasModuleClass(tab, 'tabMd')).toBe(true);
    });
  });
});
