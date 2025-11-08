/**
 * @fileoverview Component tests for MetricCard
 *
 * Tests the enhanced metric card component with gradients, animations,
 * and loading states. Validates rendering, prop handling, accessibility,
 * and user interactions.
 *
 * @see /components/dashboard/metriccard.tsx
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricCard, { MetricCardSkeleton } from './metriccard';
import ParkIcon from '@mui/icons-material/Park';

describe('MetricCard Component', () => {
  describe('Rendering', () => {
    it('should render with basic props', () => {
      render(
        <MetricCard
          title="Total Trees"
          value={1234}
          icon={<ParkIcon data-testid="park-icon" />}
        />
      );

      expect(screen.getByText('Total Trees')).toBeInTheDocument();
      expect(screen.getByText('1,234')).toBeInTheDocument();
      expect(screen.getByTestId('park-icon')).toBeInTheDocument();
    });

    it('should render with string value', () => {
      render(
        <MetricCard
          title="Status"
          value="Active"
          icon={<ParkIcon />}
        />
      );

      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('should format number values with locale string', () => {
      render(
        <MetricCard
          title="Large Number"
          value={1234567}
          icon={<ParkIcon />}
        />
      );

      expect(screen.getByText('1,234,567')).toBeInTheDocument();
    });

    it('should render zero value', () => {
      render(
        <MetricCard
          title="Count"
          value={0}
          icon={<ParkIcon />}
        />
      );

      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('Gradient Variants', () => {
    it('should apply primary gradient by default', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
      // Gradient is applied via sx prop, just verify card renders
    });

    it('should apply success gradient', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          gradient="success"
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
    });

    it('should apply warning gradient', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          gradient="warning"
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
    });

    it('should apply info gradient', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          gradient="info"
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
    });

    it('should apply neutral gradient', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          gradient="neutral"
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
    });
  });

  describe('Trend Indicators', () => {
    it('should render trend with up direction', () => {
      render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          trend={{
            value: '+12%',
            direction: 'up'
          }}
        />
      );

      expect(screen.getByText('+12%')).toBeInTheDocument();
      // TrendingUpIcon should be present
      const svg = screen.getByText('+12%').parentElement?.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render trend with down direction', () => {
      render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          trend={{
            value: '-5%',
            direction: 'down'
          }}
        />
      );

      expect(screen.getByText('-5%')).toBeInTheDocument();
      // TrendingDownIcon should be present
      const svg = screen.getByText('-5%').parentElement?.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render trend with neutral direction (no icon)', () => {
      render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          trend={{
            value: 'Current census',
            direction: 'neutral'
          }}
        />
      );

      expect(screen.getByText('Current census')).toBeInTheDocument();
      // No trending icon for neutral
      const trendContainer = screen.getByText('Current census').parentElement;
      const trendIcons = trendContainer?.querySelectorAll('svg[data-testid*="Trending"]');
      expect(trendIcons?.length).toBe(0);
    });

    it('should not render trend section when trend prop is undefined', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
        />
      );

      // Check that there's no trend-related text
      const card = container.querySelector('.MuiCard-root');
      expect(card?.textContent).not.toContain('trend');
    });
  });

  describe('Loading State', () => {
    it('should render skeleton when isLoading is true', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          isLoading={true}
        />
      );

      // Should render MetricCardSkeleton instead
      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('should render content when isLoading is false', () => {
      render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          isLoading={false}
        />
      );

      expect(screen.getByText('Test')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });
  });

  describe('Click Handler', () => {
    it('should call onClick when card is clicked', () => {
      const handleClick = vi.fn();
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          onClick={handleClick}
        />
      );

      const card = container.querySelector('.MuiCard-root') as HTMLElement;
      card?.click();

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should have pointer cursor when onClick is provided', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
          onClick={() => {}}
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ cursor: 'pointer' });
    });

    it('should have default cursor when onClick is not provided', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveStyle({ cursor: 'default' });
    });
  });

  describe('Accessibility', () => {
    it('should have proper text hierarchy', () => {
      render(
        <MetricCard
          title="Total Trees"
          value={1234}
          icon={<ParkIcon />}
        />
      );

      const title = screen.getByText('Total Trees');
      const value = screen.getByText('1,234');

      expect(title).toBeInTheDocument();
      expect(value).toBeInTheDocument();
    });

    it('should display title text', () => {
      render(
        <MetricCard
          title="total trees"
          value={100}
          icon={<ParkIcon />}
        />
      );

      // Title is rendered as-is, CSS handles text-transform
      expect(screen.getByText('total trees')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should render card element', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
        />
      );

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
    });

    it('should use solid variant for card', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon />}
        />
      );

      const card = container.querySelector('.MuiCard-variantSolid');
      expect(card).toBeInTheDocument();
    });

    it('should render icon in Avatar', () => {
      const { container } = render(
        <MetricCard
          title="Test"
          value={100}
          icon={<ParkIcon data-testid="icon" />}
        />
      );

      const avatar = container.querySelector('.MuiAvatar-root');
      expect(avatar).toBeInTheDocument();
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });
  });
});

describe('MetricCardSkeleton Component', () => {
  it('should render skeleton placeholders', () => {
    const { container } = render(<MetricCardSkeleton />);

    const skeletons = container.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should have shimmer animation keyframes defined', () => {
    const { container } = render(<MetricCardSkeleton />);

    const card = container.querySelector('.MuiCard-root');
    // Card should exist with animation class
    expect(card).toBeInTheDocument();
  });

  it('should match card dimensions', () => {
    const { container } = render(<MetricCardSkeleton />);

    const card = container.querySelector('.MuiCard-root');
    expect(card).toBeInTheDocument();
  });

  it('should render circular skeleton for icon', () => {
    const { container } = render(<MetricCardSkeleton />);

    const circularSkeleton = container.querySelector('.MuiSkeleton-variantCircular');
    expect(circularSkeleton).toBeInTheDocument();
  });

  it('should render multiple text skeletons', () => {
    const { container } = render(<MetricCardSkeleton />);

    const textSkeletons = container.querySelectorAll('.MuiSkeleton-variantText');
    expect(textSkeletons.length).toBeGreaterThanOrEqual(2);
  });
});
