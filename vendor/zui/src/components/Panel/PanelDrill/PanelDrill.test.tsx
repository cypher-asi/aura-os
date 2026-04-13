import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelDrill } from './PanelDrill';
import type { PanelDrillItem } from './PanelDrill';

describe('PanelDrill', () => {
  const mockStack: PanelDrillItem[] = [
    { id: 'root', label: 'Home', content: <div>Home Content</div> },
    { id: 'settings', label: 'Settings', content: <div>Settings Content</div> },
    { id: 'account', label: 'Account', content: <div>Account Content</div> },
  ];

  it('renders all panels in stack with only active one visible', () => {
    render(<PanelDrill stack={mockStack} />);
    // All content is in the DOM (panels stay mounted)
    expect(screen.getByText('Account Content')).toBeInTheDocument();
    expect(screen.getByText('Home Content')).toBeInTheDocument();
    expect(screen.getByText('Settings Content')).toBeInTheDocument();

    // Only active panel is not hidden
    const accountPanel = screen.getByText('Account Content').closest('[aria-hidden]');
    const homePanel = screen.getByText('Home Content').closest('[aria-hidden]');
    const settingsPanel = screen.getByText('Settings Content').closest('[aria-hidden]');

    expect(accountPanel).toHaveAttribute('aria-hidden', 'false');
    expect(homePanel).toHaveAttribute('aria-hidden', 'true');
    expect(settingsPanel).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders empty state when stack is empty', () => {
    render(<PanelDrill stack={[]} />);
    expect(screen.getByText('No content')).toBeInTheDocument();
  });

  it('shows breadcrumb when stack has multiple items', () => {
    render(<PanelDrill stack={mockStack} onNavigate={vi.fn()} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('shows breadcrumb even when stack has only one item', () => {
    render(
      <PanelDrill
        stack={[{ id: 'root', label: 'Home', content: <div>Home Content</div> }]}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Home Content')).toBeInTheDocument();
  });

  it('hides breadcrumb when showBreadcrumb is false', () => {
    render(<PanelDrill stack={mockStack} showBreadcrumb={false} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('calls onNavigate when breadcrumb item is clicked', async () => {
    const user = userEvent.setup();
    const handleNavigate = vi.fn();
    render(<PanelDrill stack={mockStack} onNavigate={handleNavigate} />);

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(handleNavigate).toHaveBeenCalledWith('root', 0);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(handleNavigate).toHaveBeenCalledWith('settings', 1);
  });

  it('applies custom className', () => {
    const { container } = render(
      <PanelDrill stack={mockStack} className="custom-class" />
    );
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('forwards Panel props', () => {
    const { container } = render(
      <PanelDrill stack={mockStack} data-testid="test-panel" variant="solid" />
    );
    expect(screen.getByTestId('test-panel')).toBeInTheDocument();
  });

  it('forwards ref to Panel', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<PanelDrill ref={ref} stack={mockStack} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('renders custom breadcrumb separator', () => {
    render(
      <PanelDrill
        stack={mockStack}
        onNavigate={vi.fn()}
        breadcrumbSeparator=">"
      />
    );
    expect(screen.getAllByText('>')).toHaveLength(2);
  });

  it('updates active panel when stack changes while keeping all mounted', () => {
    const { rerender } = render(
      <PanelDrill
        stack={[{ id: 'root', label: 'Home', content: <div>Home Content</div> }]}
      />
    );
    expect(screen.getByText('Home Content')).toBeInTheDocument();

    rerender(
      <PanelDrill
        stack={[
          { id: 'root', label: 'Home', content: <div>Home Content</div> },
          { id: 'settings', label: 'Settings', content: <div>Settings Content</div> },
        ]}
      />
    );
    // Both panels are in DOM
    expect(screen.getByText('Settings Content')).toBeInTheDocument();
    expect(screen.getByText('Home Content')).toBeInTheDocument();

    // Settings is active, Home is hidden
    const settingsPanel = screen.getByText('Settings Content').closest('[aria-hidden]');
    const homePanel = screen.getByText('Home Content').closest('[aria-hidden]');
    expect(settingsPanel).toHaveAttribute('aria-hidden', 'false');
    expect(homePanel).toHaveAttribute('aria-hidden', 'true');
  });

  it('preserves component state when navigating back', async () => {
    // Stateful component to test state preservation
    function StatefulCounter({ testId }: { testId: string }) {
      const [count, setCount] = useState(0);
      return (
        <div>
          <span data-testid={testId}>{count}</span>
          <button onClick={() => setCount((c) => c + 1)}>Increment {testId}</button>
        </div>
      );
    }

    const user = userEvent.setup();

    function TestHarness() {
      const [stack, setStack] = useState<PanelDrillItem[]>([
        { id: 'home', label: 'Home', content: <StatefulCounter testId="home-count" /> },
      ]);

      const pushSettings = () => {
        setStack((prev) => [
          ...prev,
          { id: 'settings', label: 'Settings', content: <StatefulCounter testId="settings-count" /> },
        ]);
      };

      const navigateBack = (_id: string, index: number) => {
        setStack((prev) => prev.slice(0, index + 1));
      };

      return (
        <div>
          <button onClick={pushSettings}>Go to Settings</button>
          <PanelDrill stack={stack} onNavigate={navigateBack} />
        </div>
      );
    }

    render(<TestHarness />);

    // Initial state: home counter is 0
    expect(screen.getByTestId('home-count')).toHaveTextContent('0');

    // Increment home counter
    await user.click(screen.getByRole('button', { name: 'Increment home-count' }));
    expect(screen.getByTestId('home-count')).toHaveTextContent('1');

    // Navigate to settings
    await user.click(screen.getByRole('button', { name: 'Go to Settings' }));
    expect(screen.getByTestId('settings-count')).toHaveTextContent('0');

    // Increment settings counter
    await user.click(screen.getByRole('button', { name: 'Increment settings-count' }));
    expect(screen.getByTestId('settings-count')).toHaveTextContent('1');

    // Navigate back to home via breadcrumb
    await user.click(screen.getByRole('button', { name: 'Home' }));

    // Home counter should still be 1 (state preserved)
    expect(screen.getByTestId('home-count')).toHaveTextContent('1');
  });
});
