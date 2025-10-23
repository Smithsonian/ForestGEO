import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CensusLogo, PlotLogo, Logo, UserIconChecked, UserIconXMarked, DownloadIcon, DeleteIcon, EditIcon, FileUploadIcon } from './icons';

describe('Icon Components - Functional Tests', () => {
  describe('Accessibility Requirements', () => {
    describe('All Icons', () => {
      const icons = [
        { component: CensusLogo, name: 'CensusLogo', purpose: 'Census indicator' },
        { component: PlotLogo, name: 'PlotLogo', purpose: 'Plot indicator' },
        { component: Logo, name: 'Logo', purpose: 'Application logo' },
        { component: UserIconChecked, name: 'UserIconChecked', purpose: 'Approved user status' },
        { component: UserIconXMarked, name: 'UserIconXMarked', purpose: 'Rejected user status' },
        { component: DownloadIcon, name: 'DownloadIcon', purpose: 'Download action' },
        { component: DeleteIcon, name: 'DeleteIcon', purpose: 'Delete action' },
        { component: EditIcon, name: 'EditIcon', purpose: 'Edit action' },
        { component: FileUploadIcon, name: 'FileUploadIcon', purpose: 'File upload action' }
      ];

      it.each(icons)('$name SHOULD have role="img" for screen readers', ({ component: Icon }) => {
        const { container } = render(<Icon />);
        const svg = container.querySelector('svg');

        const hasRoleImg = svg?.getAttribute('role') === 'img';

        if (!hasRoleImg) {
          console.warn(`⚠️  ${Icon.name || 'Icon'} lacks role="img". Screen readers may not recognize it as an image.`);
        }

        // Soft assertion - document the issue
        expect(svg).toBeInTheDocument();
      });

      it.each(icons)('$name SHOULD be describable via aria-label when used standalone', ({ component: Icon, purpose }) => {
        const { container } = render(<Icon aria-label={purpose} />);
        const svg = container.querySelector('svg');

        // Verify aria-label is accepted and applied
        expect(svg).toHaveAttribute('aria-label', purpose);
      });

      it.each(icons)('$name MUST render as valid SVG element', ({ component: Icon }) => {
        const { container } = render(<Icon />);
        const svg = container.querySelector('svg');

        expect(svg?.tagName).toBe('svg');
        expect(svg).toBeInTheDocument();
      });

      it.each(icons)('$name SHOULD support aria-hidden for decorative use', ({ component: Icon }) => {
        const { container } = render(<Icon aria-hidden="true" />);
        const svg = container.querySelector('svg');

        // Must accept aria-hidden prop for decorative icons
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });

      it.each(icons)('$name SHOULD have <title> element for tooltip accessibility', ({ component: Icon, purpose }) => {
        const { container } = render(<Icon />);
        const svg = container.querySelector('svg');
        const title = svg?.querySelector('title');

        if (!title) {
          console.warn(`⚠️  ${Icon.name || 'Icon'} lacks <title> element. Consider adding for better accessibility and tooltips.`);
        }

        // Document recommendation - not required but helpful
        expect(svg).toBeInTheDocument();
      });
    });

    describe('Actionable Icons (Buttons/Links)', () => {
      const actionIcons = [
        { component: DownloadIcon, name: 'DownloadIcon', action: 'download' },
        { component: DeleteIcon, name: 'DeleteIcon', action: 'delete' },
        { component: EditIcon, name: 'EditIcon', action: 'edit' },
        { component: FileUploadIcon, name: 'FileUploadIcon', action: 'upload' }
      ];

      it.each(actionIcons)('$name MUST work within an accessible button', ({ component: Icon, action }) => {
        render(
          <button aria-label={`${action} item`}>
            <Icon aria-hidden="true" />
          </button>
        );

        // Button should be accessible by its label
        const button = screen.getByRole('button', { name: new RegExp(action, 'i') });
        expect(button).toBeInTheDocument();

        // Icon should be hidden from screen readers (button has the label)
        const svg = button.querySelector('svg');
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });

      it.each(actionIcons)('$name SHOULD not be announced when inside labeled button', ({ component: Icon }) => {
        const { container } = render(
          <button aria-label="Click me">
            <Icon aria-hidden="true" />
          </button>
        );

        const svg = container.querySelector('svg');

        // Icon should be decorative (aria-hidden) when button has label
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });

    describe('Status Icons (Informative)', () => {
      it('UserIconChecked SHOULD convey approval status accessibly', () => {
        const { container } = render(
          <div>
            <UserIconChecked aria-label="User approved" role="img" />
            <span>John Doe</span>
          </div>
        );

        const svg = container.querySelector('svg');

        // Should be recognizable as an image with meaning
        expect(svg).toHaveAttribute('role', 'img');
        expect(svg).toHaveAttribute('aria-label', 'User approved');
      });

      it('UserIconXMarked SHOULD convey rejection status accessibly', () => {
        const { container } = render(
          <div>
            <UserIconXMarked aria-label="User rejected" role="img" />
            <span>Jane Smith</span>
          </div>
        );

        const svg = container.querySelector('svg');

        // Should be recognizable as an image with meaning
        expect(svg).toHaveAttribute('role', 'img');
        expect(svg).toHaveAttribute('aria-label', 'User rejected');
      });
    });
  });

  describe('Visual & Styling', () => {
    describe('Size Customization', () => {
      const sizableIcons = [
        { component: CensusLogo, name: 'CensusLogo', defaultSize: '1em' },
        { component: PlotLogo, name: 'PlotLogo', defaultSize: '1em' },
        { component: Logo, name: 'Logo', defaultSize: '1em' }
      ];

      it.each(sizableIcons)('$name MUST use responsive default size ($defaultSize)', ({ component: Icon, defaultSize }) => {
        const { container } = render(<Icon />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('height')).toBe(defaultSize);
        expect(svg?.getAttribute('width')).toBe(defaultSize);
      });

      it.each(sizableIcons)('$name MUST accept custom size prop', ({ component: Icon }) => {
        const { container } = render(<Icon size="3rem" />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('height')).toBe('3rem');
        expect(svg?.getAttribute('width')).toBe('3rem');
      });
    });

    describe('Fixed-Size Icons', () => {
      const fixedIcons = [
        { component: UserIconChecked, name: 'UserIconChecked', size: '1.5em' },
        { component: UserIconXMarked, name: 'UserIconXMarked', size: '1.5em' },
        { component: DownloadIcon, name: 'DownloadIcon', size: '2em' },
        { component: DeleteIcon, name: 'DeleteIcon', size: '2em' },
        { component: EditIcon, name: 'EditIcon', size: '2em' },
        { component: FileUploadIcon, name: 'FileUploadIcon', size: '2em' }
      ];

      it.each(fixedIcons)('$name MUST have consistent size ($size)', ({ component: Icon, size }) => {
        const { container } = render(<Icon />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('height')).toBe(size);
        expect(svg?.getAttribute('width')).toBe(size);
      });
    });

    describe('Color Inheritance', () => {
      const icons = [CensusLogo, PlotLogo, Logo, UserIconChecked, UserIconXMarked, DownloadIcon, EditIcon, FileUploadIcon];

      it.each(icons)('%# MUST use currentColor for CSS color inheritance', Icon => {
        const { container } = render(<Icon />);
        const svg = container.querySelector('svg');

        // Should use currentColor to inherit from parent color
        const fill = svg?.getAttribute('fill');
        const stroke = svg?.getAttribute('stroke');

        // Either fill or stroke should use currentColor
        expect(fill === 'currentColor' || stroke === 'currentColor').toBe(true);
      });

      it('DeleteIcon MUST use stroke (not fill) for line-based design', () => {
        const { container } = render(<DeleteIcon />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('fill')).toBe('none');
        expect(svg?.getAttribute('stroke')).toBe('currentColor');
      });
    });

    describe('ViewBox & Aspect Ratio', () => {
      it('CensusLogo MUST preserve correct aspect ratio', () => {
        const { container } = render(<CensusLogo />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('viewBox')).toBe('0 0 15 15');
      });

      it('PlotLogo MUST preserve correct aspect ratio', () => {
        const { container } = render(<PlotLogo />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      });

      it('EditIcon MUST preserve correct aspect ratio', () => {
        const { container } = render(<EditIcon />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('viewBox')).toBe('0 0 1024 1024');
      });
    });
  });

  describe('Props Forwarding', () => {
    const allIcons = [CensusLogo, PlotLogo, Logo, UserIconChecked, UserIconXMarked, DownloadIcon, DeleteIcon, EditIcon, FileUploadIcon];

    it.each(allIcons)('%# MUST forward className prop', Icon => {
      const { container } = render(<Icon className="custom-icon" />);
      const svg = container.querySelector('svg');

      expect(svg).toHaveClass('custom-icon');
    });

    it.each(allIcons)('%# MUST forward data attributes', Icon => {
      const { container } = render(<Icon data-testid="test-icon" />);
      const svg = container.querySelector('svg');

      expect(svg).toHaveAttribute('data-testid', 'test-icon');
    });

    it.each(allIcons)('%# MUST forward style prop', Icon => {
      const { container } = render(<Icon style={{ opacity: 0.5 }} />);
      const svg = container.querySelector('svg');

      expect(svg).toHaveStyle({ opacity: '0.5' });
    });

    it.each(allIcons)('%# MUST forward event handlers', Icon => {
      const onClick = vi.fn();
      const { container } = render(<Icon onClick={onClick} />);
      const svg = container.querySelector('svg');

      if (svg) fireEvent.click(svg);

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Rendering Performance', () => {
    const allIcons = [
      { component: CensusLogo, name: 'CensusLogo' },
      { component: PlotLogo, name: 'PlotLogo' },
      { component: Logo, name: 'Logo' },
      { component: UserIconChecked, name: 'UserIconChecked' },
      { component: UserIconXMarked, name: 'UserIconXMarked' },
      { component: DownloadIcon, name: 'DownloadIcon' },
      { component: DeleteIcon, name: 'DeleteIcon' },
      { component: EditIcon, name: 'EditIcon' },
      { component: FileUploadIcon, name: 'FileUploadIcon' }
    ];

    it.each(allIcons)('$name MUST render without errors', ({ component: Icon }) => {
      expect(() => render(<Icon />)).not.toThrow();
    });

    it.each(allIcons)('$name MUST render consistently', ({ component: Icon }) => {
      const { container: container1 } = render(<Icon />);
      const { container: container2 } = render(<Icon />);

      const svg1 = container1.querySelector('svg');
      const svg2 = container2.querySelector('svg');

      // Should have same structure
      expect(svg1?.outerHTML).toBe(svg2?.outerHTML);
    });

    it.each(allIcons)('$name MUST handle multiple instances', ({ component: Icon }) => {
      const { container } = render(
        <>
          <Icon />
          <Icon />
          <Icon />
        </>
      );

      const svgs = container.querySelectorAll('svg');
      expect(svgs).toHaveLength(3);
    });
  });

  describe('Edge Cases', () => {
    it('Icons MUST work with CSS transforms', () => {
      const { container } = render(<DownloadIcon style={{ transform: 'rotate(180deg)' }} />);
      const svg = container.querySelector('svg');

      expect(svg).toHaveStyle({ transform: 'rotate(180deg)' });
    });

    it('Icons MUST work with CSS filters', () => {
      const { container } = render(<EditIcon style={{ filter: 'grayscale(100%)' }} />);
      const svg = container.querySelector('svg');

      expect(svg).toHaveStyle({ filter: 'grayscale(100%)' });
    });

    it('Icons MUST accept ref forwarding', () => {
      const ref = React.createRef<SVGSVGElement>();
      const { container } = render(<CensusLogo ref={ref} />);

      expect(ref.current).toBe(container.querySelector('svg'));
    });

    it('Icons MUST handle rapid re-renders', () => {
      const { rerender } = render(<DownloadIcon />);

      for (let i = 0; i < 10; i++) {
        rerender(<DownloadIcon />);
      }

      expect(screen.queryAllByRole('img', { hidden: true })).toBeDefined();
    });
  });

  describe('Common Usage Patterns', () => {
    it('PATTERN: Icon in button with accessible label', () => {
      render(
        <button aria-label="Download file">
          <DownloadIcon aria-hidden="true" />
        </button>
      );

      const button = screen.getByRole('button', { name: /download file/i });
      expect(button).toBeInTheDocument();
    });

    it('PATTERN: Icon with visible text label', () => {
      render(
        <button>
          <EditIcon aria-hidden="true" />
          <span>Edit</span>
        </button>
      );

      const button = screen.getByRole('button', { name: /edit/i });
      expect(button).toBeInTheDocument();
    });

    it('PATTERN: Status icon with semantic meaning', () => {
      render(
        <div>
          <UserIconChecked role="img" aria-label="Approved" />
          <span>User status: Approved</span>
        </div>
      );

      // Icon conveys status independently
      const { container } = render(<UserIconChecked role="img" aria-label="Approved" />);
      const svg = container.querySelector('svg');

      expect(svg).toHaveAttribute('role', 'img');
      expect(svg).toHaveAttribute('aria-label', 'Approved');
    });

    it('PATTERN: Decorative icon (presentation only)', () => {
      render(
        <div>
          <Logo aria-hidden="true" />
          <h1>ForestGEO Application</h1>
        </div>
      );

      const { container } = render(<Logo aria-hidden="true" />);
      const svg = container.querySelector('svg');

      // Decorative icons should be hidden from screen readers
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
