import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from './emptystate';

// Test icon component
const TestIcon = () => <span data-testid="test-icon">📊</span>;

describe('EmptyState', () => {
  describe('rendering', () => {
    it('renders icon, title, and description', () => {
      render(
        <EmptyState
          icon={<TestIcon />}
          title="No Data Available"
          description="There is currently no data to display"
        />
      );

      expect(screen.getByTestId('test-icon')).toBeInTheDocument();
      expect(screen.getByText('No Data Available')).toBeInTheDocument();
      expect(screen.getByText('There is currently no data to display')).toBeInTheDocument();
    });

    it('renders without action buttons when not provided', () => {
      render(
        <EmptyState
          icon={<TestIcon />}
          title="Empty State"
          description="No actions available"
        />      );

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders primary action button when provided', () => {
      render(
        <EmptyState
          icon={<TestIcon />}
          title="Empty State"
          description="With primary action"
          primaryAction={{
            label: 'Create New',
            onClick: vi.fn()
          }}
        />      );

      expect(screen.getByRole('button', { name: 'Create New' })).toBeInTheDocument();
    });

    it('renders both primary and secondary action buttons when provided', () => {
      render(
        <EmptyState
          icon={<TestIcon />}
          title="Empty State"
          description="With both actions"
          primaryAction={{
            label: 'Primary Action',
            onClick: vi.fn()
          }}
          secondaryAction={{
            label: 'Secondary Action',
            onClick: vi.fn()
          }}
        />      );

      expect(screen.getByRole('button', { name: 'Primary Action' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Secondary Action' })).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onClick when primary action button is clicked', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <EmptyState
          icon={<TestIcon />}
          title="Empty State"
          description="Test interaction"
          primaryAction={{
            label: 'Click Me',
            onClick: handleClick
          }}
        />      );

      await user.click(screen.getByRole('button', { name: 'Click Me' }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick when secondary action button is clicked', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <EmptyState
          icon={<TestIcon />}
          title="Empty State"
          description="Test interaction"
          secondaryAction={{
            label: 'Help',
            onClick: handleClick
          }}
        />      );

      await user.click(screen.getByRole('button', { name: 'Help' }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('calls correct onClick for each button when both are present', async () => {
      const user = userEvent.setup();
      const handlePrimary = vi.fn();
      const handleSecondary = vi.fn();

      render(
        <EmptyState
          icon={<TestIcon />}
          title="Empty State"
          description="Test both actions"
          primaryAction={{
            label: 'Primary',
            onClick: handlePrimary
          }}
          secondaryAction={{
            label: 'Secondary',
            onClick: handleSecondary
          }}
        />      );

      await user.click(screen.getByRole('button', { name: 'Primary' }));
      expect(handlePrimary).toHaveBeenCalledTimes(1);
      expect(handleSecondary).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Secondary' }));
      expect(handleSecondary).toHaveBeenCalledTimes(1);
      expect(handlePrimary).toHaveBeenCalledTimes(1);
    });
  });

  describe('customization', () => {
    it('applies custom icon color', () => {
      const { container } = render(
        <EmptyState
          icon={<TestIcon />}
          title="Custom Color"
          description="With custom icon color"
          iconColor="success"
        />      );

      // Avatar should have success color classes
      const avatar = container.querySelector('[class*="Avatar"]');
      expect(avatar).toBeInTheDocument();
    });

    it('applies custom button variants and colors', () => {
      render(
        <EmptyState
          icon={<TestIcon />}
          title="Custom Buttons"
          description="With custom button styling"
          primaryAction={{
            label: 'Primary',
            onClick: vi.fn(),
            variant: 'outlined',
            color: 'success'
          }}
          secondaryAction={{
            label: 'Secondary',
            onClick: vi.fn(),
            variant: 'soft',
            color: 'warning'
          }}
        />      );

      expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Secondary' })).toBeInTheDocument();
    });

    it('renders startDecorator icons on buttons', () => {
      const PrimaryIcon = () => <span data-testid="primary-icon">+</span>;
      const SecondaryIcon = () => <span data-testid="secondary-icon">?</span>;

      render(
        <EmptyState
          icon={<TestIcon />}
          title="With Icons"
          description="Buttons with start decorators"
          primaryAction={{
            label: 'Create',
            onClick: vi.fn(),
            startDecorator: <PrimaryIcon />
          }}
          secondaryAction={{
            label: 'Help',
            onClick: vi.fn(),
            startDecorator: <SecondaryIcon />
          }}
        />      );

      expect(screen.getByTestId('primary-icon')).toBeInTheDocument();
      expect(screen.getByTestId('secondary-icon')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper heading hierarchy with h3', () => {
      render(
        <EmptyState
          icon={<TestIcon />}
          title="Accessible Title"
          description="Description text"
        />      );

      const heading = screen.getByText('Accessible Title');
      expect(heading.tagName).toBe('H3');
    });

    it('maintains button accessibility with proper roles', () => {
      render(
        <EmptyState
          icon={<TestIcon />}
          title="Accessible Buttons"
          description="With accessible actions"
          primaryAction={{
            label: 'Primary Action',
            onClick: vi.fn()
          }}
          secondaryAction={{
            label: 'Secondary Action',
            onClick: vi.fn()
          }}
        />      );

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(2);
      expect(buttons[0]).toHaveAccessibleName('Primary Action');
      expect(buttons[1]).toHaveAccessibleName('Secondary Action');
    });
  });
});
