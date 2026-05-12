import React, { useState } from 'react';
import QuadratPlanner from '@/components/provisioning/QuadratPlanner';
import type { ProvisioningInput, QuadratConfig } from '@/lib/provisioning/types';

type PlotValue = ProvisioningInput['plot'];

const PLOT_100x100: PlotValue = {
  plotName: 'Test Plot',
  dimensionX: 100,
  dimensionY: 100,
  area: 1,
  globalX: 0,
  globalY: 0,
  globalZ: 0,
  plotShape: 'square',
  description: '',
  defaultDimensionUnits: 'm',
  defaultCoordinateUnits: 'm',
  defaultAreaUnits: 'ha',
  defaultDBHUnits: 'mm',
  defaultHOMUnits: 'm'
};

const DEFAULT_GRID_VALUE: QuadratConfig = {
  mode: 'grid',
  quadratSizeX: 20,
  quadratSizeY: 20,
  namingPattern: 'sequential'
};

const DEFAULT_CSV_VALUE: QuadratConfig = {
  mode: 'csv',
  rows: []
};

// Stateful wrapper so the component re-renders with each onChange and controlled
// state reflects the latest emitted value on subsequent interactions.
function StatefulPlanner(props: { initial: QuadratConfig; plot?: PlotValue; onChangeSpy: (v: QuadratConfig) => void; showErrors?: boolean }) {
  const [value, setValue] = useState(props.initial);
  return (
    <QuadratPlanner
      value={value}
      onChange={next => {
        setValue(next);
        props.onChangeSpy(next);
      }}
      plot={props.plot ?? PLOT_100x100}
      showErrors={props.showErrors}
    />
  );
}

// Helper: read fixture content and upload it via selectFile.
// MUI Joy Radio inputs cover their labels, so we use { force: true } for radio clicks.
function uploadCsvFixture(fixtureFile: string) {
  return cy.fixture(fixtureFile, 'utf-8').then(content => {
    cy.get('[aria-label="Upload Quadrat CSV"]').selectFile(
      {
        contents: Cypress.Buffer.from(content),
        fileName: fixtureFile,
        mimeType: 'text/csv'
      },
      { force: true }
    );
  });
}

// Click a radio by targeting the input directly and using force — MUI Joy radio inputs
// overlap their labels, preventing a normal label click in headless Cypress.
function clickRadioByValue(value: string) {
  cy.get(`[type="radio"][value="${value}"]`).click({ force: true });
}

describe('QuadratPlanner', () => {
  describe('Grid mode', () => {
    it('shows live preview for a 100x100 plot with 20x20 quadrats (5x5 = 25 quadrats)', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_GRID_VALUE} onChangeSpy={onChangeSpy} />);

      cy.contains('Will create 25 quadrats').should('be.visible');
      cy.contains('5 rows × 5 cols of 20×20').should('be.visible');
    });

    it('shows divisibility error when plot dimensions are not divisible by quadrat size', () => {
      const onChangeSpy = cy.stub().as('onChange');
      // 100x100 is not divisible by 30x30
      cy.mount(<StatefulPlanner initial={{ mode: 'grid', quadratSizeX: 30, quadratSizeY: 30, namingPattern: 'sequential' }} onChangeSpy={onChangeSpy} />);

      cy.get('[aria-label="Divisibility error"]').should('be.visible');
      cy.contains('not divisible').should('be.visible');
      cy.contains('Use CSV mode for irregular grids').should('be.visible');
      // No count preview when indivisible
      cy.contains('Will create').should('not.exist');
    });

    it('updates preview live when quadrat size changes from indivisible to divisible', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={{ mode: 'grid', quadratSizeX: 30, quadratSizeY: 30, namingPattern: 'sequential' }} onChangeSpy={onChangeSpy} />);

      cy.get('[aria-label="Divisibility error"]').should('be.visible');

      // Change to 25x25 — 100/25 = 4, valid
      cy.get('[aria-label="Quadrat Size X"]').focus().type('{selectall}25');
      cy.get('[aria-label="Quadrat Size Y"]').focus().type('{selectall}25');

      cy.contains('Will create 16 quadrats').should('be.visible');
      cy.contains('4 rows × 4 cols of 25×25').should('be.visible');
    });

    it('fires onChange with updated namingPattern when row-col radio is selected', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_GRID_VALUE} onChangeSpy={onChangeSpy} />);

      // MUI Joy radio inputs cover their labels; use force to interact with the input directly
      clickRadioByValue('row-col');

      cy.get('@onChange').then((stub: any) => {
        const calls = stub.getCalls();
        const lastCall = calls[calls.length - 1];
        expect(lastCall.args[0]).to.deep.include({ mode: 'grid', namingPattern: 'row-col' });
      });
    });

    it('fires onChange with updated quadratSizeX (as number) when the number input changes', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_GRID_VALUE} onChangeSpy={onChangeSpy} />);

      cy.get('[aria-label="Quadrat Size X"]').focus().type('{selectall}10');

      cy.get('@onChange').then((stub: any) => {
        const calls = stub.getCalls();
        const lastCall = calls[calls.length - 1];
        expect(lastCall.args[0].quadratSizeX).to.equal(10);
        expect(typeof lastCall.args[0].quadratSizeX).to.equal('number');
      });
    });
  });

  describe('CSV mode', () => {
    it('switches to CSV mode when the CSV radio is clicked', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_GRID_VALUE} onChangeSpy={onChangeSpy} />);

      clickRadioByValue('csv');

      cy.get('[aria-label="Upload Quadrat CSV"]').should('be.visible');
      cy.get('[aria-label="Grid preview"]').should('not.exist');
    });

    it('loads 25 quadrats from a valid grid CSV and shows success message', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      uploadCsvFixture('quadrats-valid-grid.csv');

      cy.get('[aria-label="CSV load success"]').should('be.visible');
      cy.contains('Loaded 25 quadrats (no errors)').should('be.visible');
    });

    it('fires onChange with all 25 parsed rows from the valid grid fixture', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      uploadCsvFixture('quadrats-valid-grid.csv');

      // Wait for the success message to confirm async parse completed before asserting stub
      cy.contains('Loaded 25 quadrats (no errors)').should('be.visible');

      cy.get('@onChange').then((stub: any) => {
        const calls = stub.getCalls();
        const lastCall = calls[calls.length - 1];
        const emitted = lastCall.args[0] as QuadratConfig;
        expect(emitted.mode).to.equal('csv');
        if (emitted.mode === 'csv') {
          expect(emitted.rows).to.have.length(25);
          expect(emitted.rows[0]).to.deep.equal({ quadratName: 'Q0001', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 });
        }
      });
    });

    it('shows overlap error when overlapping CSV is uploaded', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      uploadCsvFixture('quadrats-overlapping.csv');

      // Wait for DOM update after async file read
      cy.contains('overlap').should('be.visible');
    });

    it('shows bounds error when out-of-bounds CSV is uploaded', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      uploadCsvFixture('quadrats-out-of-bounds.csv');

      // A 90,0 20x20 quadrat extends to x=110, past dimensionX=100
      cy.contains('extends past plot dimensionX').should('be.visible');
    });

    it('shows parse error with row number for malformed CSV', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      const malformedCsv = 'quadratname,startx,starty,dimensionx,dimensiony\nA,bad,0,20,20';
      cy.get('[aria-label="Upload Quadrat CSV"]').selectFile(
        {
          contents: Cypress.Buffer.from(malformedCsv),
          fileName: 'bad.csv',
          mimeType: 'text/csv'
        },
        { force: true }
      );

      cy.contains('Row 2:').should('be.visible');
      cy.contains('Non-numeric value').should('be.visible');
    });

    it('fires onChange with empty rows when a parse error occurs', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      const malformedCsv = 'quadratname,startx,starty,dimensionx,dimensiony\n,0,0,20,20';
      cy.get('[aria-label="Upload Quadrat CSV"]').selectFile(
        {
          contents: Cypress.Buffer.from(malformedCsv),
          fileName: 'bad.csv',
          mimeType: 'text/csv'
        },
        { force: true }
      );

      // Wait for error message to confirm async parse completed
      cy.contains('parse error').should('be.visible');

      cy.get('@onChange').then((stub: any) => {
        const calls = stub.getCalls();
        const lastCall = calls[calls.length - 1];
        const emitted = lastCall.args[0] as QuadratConfig;
        expect(emitted.mode).to.equal('csv');
        if (emitted.mode === 'csv') {
          expect(emitted.rows).to.have.length(0);
        }
      });
    });
  });

  describe('Mode switching', () => {
    it('switching from grid to CSV clears grid state and shows file input', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_GRID_VALUE} onChangeSpy={onChangeSpy} />);

      cy.contains('Will create 25 quadrats').should('be.visible');

      clickRadioByValue('csv');

      cy.get('[aria-label="Upload Quadrat CSV"]').should('be.visible');
      cy.contains('Will create').should('not.exist');

      cy.get('@onChange').then((stub: any) => {
        const calls = stub.getCalls();
        const lastCall = calls[calls.length - 1];
        expect(lastCall.args[0]).to.deep.equal({ mode: 'csv', rows: [] });
      });
    });

    it('switching from CSV back to grid restores default grid config', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      clickRadioByValue('grid');

      cy.contains('Will create').should('be.visible');
      cy.get('[aria-label="Upload Quadrat CSV"]').should('not.exist');

      cy.get('@onChange').then((stub: any) => {
        const calls = stub.getCalls();
        const lastCall = calls[calls.length - 1];
        expect(lastCall.args[0].mode).to.equal('grid');
      });
    });
  });
});
