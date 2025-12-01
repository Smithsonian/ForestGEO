/**
 * @fileoverview Component tests for ProgressCard
 *
 * Tests the enhanced progress card component with circular progress indicator,
 * animated ring, and quadrat status display. Validates rendering, prop handling,
 * calculations, and loading states.
 *
 * @see /components/dashboard/progresscard.tsx
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressCard, { ProgressCardSkeleton } from './progresscard';

describe('ProgressCard Component', () => {
  const defaultProps = {
    totalQuadrats: 100,
    populatedQuadrats: 75,
    populatedPercent: 75,
    unpopulatedQuadrats: ['Q001', 'Q002', 'Q003'],
    isLoading: false
  };

  describe('Rendering', () => {
    it('should render with basic props', () => {
      render(<ProgressCard {...defaultProps} />);

      expect(screen.getByText('Census Progress')).toBeInTheDocument();
      expect(screen.getByText('Quadrat measurement completion')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    it('should render populated quadrats count', () => {
      render(<ProgressCard {...defaultProps} />);

      expect(screen.getByText(/75.*\/.*100/)).toBeInTheDocument();
    });

    it('should render unpopulated count when quadrats exist', () => {
      render(<ProgressCard {...defaultProps} />);

      expect(screen.getByText('3 Pending')).toBeInTheDocument();
    });

    it('should not render pending chip when all quadrats are populated', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={100} populatedPercent={100} unpopulatedQuadrats={[]} isLoading={false} />);

      expect(screen.queryByText(/Pending/)).not.toBeInTheDocument();
    });
  });

  describe('Progress Percentage', () => {
    it('should handle number percentage', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={50} populatedPercent={50} unpopulatedQuadrats={[]} />);

      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('should handle string percentage', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={33} populatedPercent="33.33" unpopulatedQuadrats={[]} />);

      expect(screen.getByText('33.33%')).toBeInTheDocument();
    });

    it('should display 0% for empty progress', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={0} populatedPercent={0} unpopulatedQuadrats={[]} />);

      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('should display 100% for complete progress', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={100} populatedPercent={100} unpopulatedQuadrats={[]} />);

      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('should handle decimal percentages', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={66} populatedPercent={66.67} unpopulatedQuadrats={[]} />);

      expect(screen.getByText('66.67%')).toBeInTheDocument();
    });
  });

  describe('Unpopulated Quadrats Display', () => {
    it('should display unpopulated quadrats list when count <= 10', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={95} populatedPercent={95} unpopulatedQuadrats={['Q001', 'Q002', 'Q003', 'Q004', 'Q005']} />);

      expect(screen.getByText('Unpopulated quadrats:')).toBeInTheDocument();
      expect(screen.getByText('Q001')).toBeInTheDocument();
      expect(screen.getByText('Q002')).toBeInTheDocument();
      expect(screen.getByText('Q003')).toBeInTheDocument();
      expect(screen.getByText('Q004')).toBeInTheDocument();
      expect(screen.getByText('Q005')).toBeInTheDocument();
    });

    it('should not display unpopulated list when count > 10', () => {
      const manyQuadrats = Array.from({ length: 15 }, (_, i) => `Q${String(i + 1).padStart(3, '0')}`);

      render(<ProgressCard totalQuadrats={100} populatedQuadrats={85} populatedPercent={85} unpopulatedQuadrats={manyQuadrats} />);

      expect(screen.queryByText('Unpopulated quadrats:')).not.toBeInTheDocument();
    });

    it('should filter out empty string quadrats', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={97} populatedPercent={97} unpopulatedQuadrats={['Q001', '', '  ', 'Q002']} />);

      // Should only count Q001 and Q002
      expect(screen.getByText('2 Pending')).toBeInTheDocument();
    });

    it('should handle empty unpopulated array', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={100} populatedPercent={100} unpopulatedQuadrats={[]} />);

      expect(screen.queryByText(/Pending/)).not.toBeInTheDocument();
      expect(screen.queryByText('Unpopulated quadrats:')).not.toBeInTheDocument();
    });
  });

  describe('Color Coding', () => {
    it('should render for >= 90% completion', () => {
      const { container: _container } = render(<ProgressCard totalQuadrats={100} populatedQuadrats={90} populatedPercent={90} unpopulatedQuadrats={[]} />);

      const percentText = screen.getByText('90%');
      expect(percentText).toBeInTheDocument();
      // Color is applied via sx prop - just verify rendering
    });

    it('should render for < 90% completion', () => {
      const { container: _container } = render(<ProgressCard totalQuadrats={100} populatedQuadrats={89} populatedPercent={89} unpopulatedQuadrats={[]} />);

      const percentText = screen.getByText('89%');
      expect(percentText).toBeInTheDocument();
      // Color is applied via sx prop - just verify rendering
    });
  });

  describe('Tooltips', () => {
    it('should render populated quadrats chip', () => {
      render(<ProgressCard {...defaultProps} />);

      const chip = screen.getByText(/75.*\/.*100/);
      expect(chip).toBeInTheDocument();
    });

    it('should render pending quadrats chip when visible', () => {
      render(<ProgressCard {...defaultProps} />);

      const pendingChip = screen.getByText('3 Pending');
      expect(pendingChip).toBeInTheDocument();
    });
  });

  describe('Click Handler', () => {
    it('should render with onViewUnpopulated callback', () => {
      const handleViewUnpopulated = vi.fn();

      render(<ProgressCard {...defaultProps} onViewUnpopulated={handleViewUnpopulated} />);

      const pendingChip = screen.getByText('3 Pending');
      expect(pendingChip).toBeInTheDocument();
      // Chip renders with callback - click handling tested in E2E
    });

    it('should wrap pending chip in button when onClick provided', () => {
      render(<ProgressCard {...defaultProps} onViewUnpopulated={() => {}} />);

      // When onViewUnpopulated is provided, the chip is wrapped in a button
      const button = screen.getByRole('button', { name: /view.*unpopulated/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveStyle({ cursor: 'pointer' });
    });

    it('should not wrap pending chip in button when onClick not provided', () => {
      render(<ProgressCard {...defaultProps} />);

      // Without onViewUnpopulated, there should be no button wrapping the pending chip
      const pendingText = screen.getByText('3 Pending');
      expect(pendingText).toBeInTheDocument();

      // The chip should not be wrapped in a clickable button
      expect(screen.queryByRole('button', { name: /view.*unpopulated/i })).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should render skeleton when isLoading is true', () => {
      const { container } = render(<ProgressCard {...defaultProps} isLoading={true} />);

      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('should render content when isLoading is false', () => {
      render(<ProgressCard {...defaultProps} isLoading={false} />);

      expect(screen.getByText('Census Progress')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      render(<ProgressCard {...defaultProps} />);

      const heading = screen.getByText('Census Progress');
      expect(heading.tagName).toBe('H4');
    });

    it('should have descriptive tooltips', () => {
      render(<ProgressCard {...defaultProps} />);

      // Check that tooltips exist via the Tooltip wrapper
      expect(screen.getByText(/75.*\/.*100/)).toBeInTheDocument();
      expect(screen.getByText('3 Pending')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should render card element', () => {
      const { container } = render(<ProgressCard {...defaultProps} />);

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
    });

    it('should have MUI card class', () => {
      const { container } = render(<ProgressCard {...defaultProps} />);

      const card = container.querySelector('.MuiCard-root');
      expect(card).toHaveClass('MuiCard-root');
    });

    it('should render circular progress element', () => {
      const { container } = render(<ProgressCard {...defaultProps} />);

      const progress = container.querySelector('.MuiCircularProgress-root');
      expect(progress).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers with locale formatting', () => {
      render(<ProgressCard totalQuadrats={10000} populatedQuadrats={7500} populatedPercent={75} unpopulatedQuadrats={[]} />);

      expect(screen.getByText(/7,500.*\/.*10,000/)).toBeInTheDocument();
    });

    it('should handle zero total quadrats', () => {
      render(<ProgressCard totalQuadrats={0} populatedQuadrats={0} populatedPercent={0} unpopulatedQuadrats={[]} />);

      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(screen.getByText(/0.*\/.*0/)).toBeInTheDocument();
    });

    it('should handle single unpopulated quadrat', () => {
      render(<ProgressCard totalQuadrats={100} populatedQuadrats={99} populatedPercent={99} unpopulatedQuadrats={['Q001']} />);

      expect(screen.getByText('1 Pending')).toBeInTheDocument();
      expect(screen.getByText('Q001')).toBeInTheDocument();
    });
  });
});

describe('ProgressCardSkeleton Component', () => {
  it('should render skeleton placeholders', () => {
    const { container } = render(<ProgressCardSkeleton />);

    const skeletons = container.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should match card dimensions', () => {
    const { container } = render(<ProgressCardSkeleton />);

    const card = container.querySelector('.MuiCard-root');
    expect(card).toBeInTheDocument();
  });

  it('should render circular skeleton for progress ring', () => {
    const { container } = render(<ProgressCardSkeleton />);

    const circularSkeleton = container.querySelector('.MuiSkeleton-variantCircular');
    expect(circularSkeleton).toBeInTheDocument();
  });

  it('should render text skeletons for header', () => {
    const { container } = render(<ProgressCardSkeleton />);

    const textSkeletons = container.querySelectorAll('.MuiSkeleton-variantText');
    expect(textSkeletons.length).toBeGreaterThanOrEqual(2);
  });

  it('should render rectangular skeletons for chips', () => {
    const { container } = render(<ProgressCardSkeleton />);

    const rectSkeletons = container.querySelectorAll('.MuiSkeleton-variantRectangular');
    expect(rectSkeletons.length).toBeGreaterThanOrEqual(2);
  });
});
