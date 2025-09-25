import React from 'react';
import { mount } from '@cypress/react';
import { CensusLogo, DeleteIcon, DownloadIcon, EditIcon, FileUploadIcon, Logo, PlotLogo, UserIconChecked, UserIconXMarked } from '@/components/icons';

describe('Icon Components', () => {
  describe('CensusLogo', () => {
    it('renders with default size and props', () => {
      mount(<CensusLogo />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 15 15')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '1em')
        .and('have.attr', 'width', '1em');
    });

    it('renders with custom size', () => {
      mount(<CensusLogo size="2rem" />);
      cy.get('svg').should('have.attr', 'height', '2rem').and('have.attr', 'width', '2rem');
    });

    it('accepts additional SVG props', () => {
      mount(<CensusLogo className="test-class" data-testid="census-logo" />);
      cy.get('svg').should('have.class', 'test-class').and('have.attr', 'data-testid', 'census-logo');
    });

    it('contains the correct path element', () => {
      mount(<CensusLogo />);
      cy.get('svg path')
        .should('exist')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'fill-rule', 'evenodd')
        .and('have.attr', 'clip-rule', 'evenodd');
    });
  });

  describe('PlotLogo', () => {
    it('renders with default size and props', () => {
      mount(<PlotLogo />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 24 24')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '1em')
        .and('have.attr', 'width', '1em');
    });

    it('renders with custom size', () => {
      mount(<PlotLogo size="3rem" />);
      cy.get('svg').should('have.attr', 'height', '3rem').and('have.attr', 'width', '3rem');
    });

    it('contains the correct path element', () => {
      mount(<PlotLogo />);
      cy.get('svg path').should('exist');
    });
  });

  describe('Logo', () => {
    it('renders with default size and props', () => {
      mount(<Logo />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 24 24')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '1em')
        .and('have.attr', 'width', '1em');
    });

    it('renders with custom size', () => {
      mount(<Logo size="4rem" />);
      cy.get('svg').should('have.attr', 'height', '4rem').and('have.attr', 'width', '4rem');
    });
  });

  describe('UserIconChecked', () => {
    it('renders with default hardcoded size', () => {
      mount(<UserIconChecked />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 640 512')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '1.5em')
        .and('have.attr', 'width', '1.5em');
    });

    it('accepts IconSvgProps but hardcoded values override them', () => {
      // Note: This demonstrates a potential design issue - the component ignores size prop
      mount(<UserIconChecked size={48} />);
      cy.get('svg')
        .should('have.attr', 'height', '1.5em') // Still hardcoded, not '48'
        .and('have.attr', 'width', '1.5em');
    });

    it('accepts other SVG props', () => {
      mount(<UserIconChecked className="user-checked" data-testid="user-checked-icon" />);
      cy.get('svg').should('have.class', 'user-checked').and('have.attr', 'data-testid', 'user-checked-icon');
    });
  });

  describe('UserIconXMarked', () => {
    it('renders with default hardcoded size', () => {
      mount(<UserIconXMarked />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 640 512')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '1.5em')
        .and('have.attr', 'width', '1.5em');
    });

    it('ignores size prop due to hardcoded values', () => {
      mount(<UserIconXMarked size={64} />);
      cy.get('svg')
        .should('have.attr', 'height', '1.5em') // Still hardcoded
        .and('have.attr', 'width', '1.5em');
    });
  });

  describe('DownloadIcon', () => {
    it('renders with default hardcoded size', () => {
      mount(<DownloadIcon />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 512 512')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '2em')
        .and('have.attr', 'width', '2em');
    });

    it('ignores size prop due to hardcoded values', () => {
      mount(<DownloadIcon size={32} />);
      cy.get('svg')
        .should('have.attr', 'height', '2em') // Still hardcoded
        .and('have.attr', 'width', '2em');
    });
  });

  describe('DeleteIcon', () => {
    it('renders with stroke-based design', () => {
      mount(<DeleteIcon />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 24 24')
        .and('have.attr', 'fill', 'none')
        .and('have.attr', 'stroke', 'currentColor')
        .and('have.attr', 'height', '2em')
        .and('have.attr', 'width', '2em');
    });

    it('has correct stroke properties', () => {
      mount(<DeleteIcon />);
      cy.get('svg').should('have.attr', 'stroke-linecap', 'round').and('have.attr', 'stroke-linejoin', 'round').and('have.attr', 'stroke-width', '2');
    });

    it('contains path elements for delete icon', () => {
      mount(<DeleteIcon />);
      cy.get('svg path').should('exist'); // Just check that path elements exist
    });
  });

  describe('EditIcon', () => {
    it('renders with default hardcoded size', () => {
      mount(<EditIcon />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 1024 1024')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '2em')
        .and('have.attr', 'width', '2em');
    });

    it('ignores size prop due to hardcoded values', () => {
      mount(<EditIcon size={16} />);
      cy.get('svg')
        .should('have.attr', 'height', '2em') // Still hardcoded
        .and('have.attr', 'width', '2em');
    });
  });

  describe('FileUploadIcon', () => {
    it('renders with default hardcoded size', () => {
      mount(<FileUploadIcon />);
      cy.get('svg')
        .should('be.visible')
        .and('have.attr', 'viewBox', '0 0 24 24')
        .and('have.attr', 'fill', 'currentColor')
        .and('have.attr', 'height', '2em')
        .and('have.attr', 'width', '2em');
    });

    it('ignores size prop due to hardcoded values', () => {
      mount(<FileUploadIcon size={128} />);
      cy.get('svg')
        .should('have.attr', 'height', '2em') // Still hardcoded
        .and('have.attr', 'width', '2em');
    });
  });

  describe('Accessibility and semantic structure', () => {
    it('all icons should be focusable when needed', () => {
      mount(
        <div>
          <CensusLogo tabIndex={0} />
          <PlotLogo tabIndex={0} />
          <Logo tabIndex={0} />
        </div>
      );

      cy.get('svg[tabindex="0"]').should('have.length', 3);
    });

    it('icons can receive aria labels for accessibility', () => {
      mount(<CensusLogo aria-label="Census timeline icon" role="img" />);
      cy.get('svg').should('have.attr', 'aria-label', 'Census timeline icon').and('have.attr', 'role', 'img');
    });
  });

  describe('Color inheritance', () => {
    it('icons inherit color from parent', () => {
      mount(
        <div style={{ color: 'red' }}>
          <CensusLogo />
        </div>
      );

      cy.get('svg').should('have.attr', 'fill', 'currentColor');
    });

    it('stroke-based icons inherit stroke color', () => {
      mount(
        <div style={{ color: 'blue' }}>
          <DeleteIcon />
        </div>
      );

      cy.get('svg').should('have.attr', 'stroke', 'currentColor');
    });
  });
});
