import React, { useState } from 'react';
import QuadratPlanner from '@/components/provisioning/QuadratPlanner';
import type { ProvisioningPlotInput, QuadratRequestConfig } from '@/lib/provisioning/types';

type PlotValue = ProvisioningPlotInput;

const PLOT_100x100: PlotValue = {
  plotName: 'Test Plot',
  dimensionX: 100,
  dimensionY: 100,
  area: 10000,
  globalX: 0,
  globalY: 0,
  globalZ: 0,
  plotShape: 'square',
  description: '',
  defaultDimensionUnits: 'm',
  defaultCoordinateUnits: 'm',
  defaultAreaUnits: 'm2',
  defaultDBHUnits: 'mm',
  defaultHOMUnits: 'm'
};

const DEFAULT_GRID_VALUE: QuadratRequestConfig = {
  mode: 'grid',
  quadratSizeX: 20,
  quadratSizeY: 20,
  namingPattern: 'sequential'
};

const DEFAULT_CSV_VALUE: QuadratRequestConfig = {
  mode: 'csv',
  rows: [],
  coordinateReferenceCorner: 'SW'
};

// ReferenceCornerSelect has no aria-label — its accessible name comes from the
// FormLabel it's associated with via htmlFor/id — so tests select it by id.
const REFERENCE_CORNER_SELECT_ID = 'reference-corner-input';
const REFERENCE_CORNER_SELECT_SELECTOR = `#${REFERENCE_CORNER_SELECT_ID}`;

// Stateful wrapper so the component re-renders with each onChange and controlled
// state reflects the latest emitted value on subsequent interactions.
function StatefulPlanner(props: { initial: QuadratRequestConfig; plot?: PlotValue; onChangeSpy: (v: QuadratRequestConfig) => void; showErrors?: boolean }) {
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

// MUI Joy's Select keeps every Listbox mounted (keepMounted: true, linked to its trigger
// via aria-controls) even while closed, so a bare [role="option"] query would collect
// every Select's options across the form at once. Scope the query to the Listbox owned
// by the reference-corner trigger via aria-controls, matching provisioning-plot-form.cy.tsx.
// Selected by id (not aria-label): ReferenceCornerSelect deliberately has no aria-label
// so its accessible name comes from the associated FormLabel — see the "accessible name"
// describe block below.
function selectReferenceCorner(optionLabel: string) {
  cy.get(REFERENCE_CORNER_SELECT_SELECTOR)
    .invoke('attr', 'aria-controls')
    .then(listboxId => {
      cy.get(REFERENCE_CORNER_SELECT_SELECTOR).click();
      cy.get(`#${listboxId}`).find('[role="option"]').contains(optionLabel).click();
    });
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
        const emitted = lastCall.args[0] as QuadratRequestConfig;
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

      // Both quadrat names must appear so the message identifies which quadrat overlaps
      // which — a bare "overlaps with ..." with no subject is a regression (see
      // fixtures/quadrats-overlapping.csv: rows "A" and "B" overlap).
      cy.contains('Quadrat "A" overlaps with "B"').should('be.visible');
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
        const emitted = lastCall.args[0] as QuadratRequestConfig;
        expect(emitted.mode).to.equal('csv');
        if (emitted.mode === 'csv') {
          expect(emitted.rows).to.have.length(0);
        }
      });
    });
  });

  describe('showErrors prop', () => {
    it('renders a "CSV required" alert when showErrors is true and CSV mode has no rows', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} showErrors />);

      cy.get('[aria-label="CSV required"]').should('be.visible');
      cy.contains('Upload a quadrat CSV before continuing.').should('be.visible');
    });

    it('does not render the "CSV required" alert when showErrors is false even with empty CSV rows', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      cy.get('[aria-label="CSV required"]').should('not.exist');
    });

    it('renders an aggregate validation alert when showErrors is true and CSV has out-of-bounds rows', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} showErrors />);

      uploadCsvFixture('quadrats-out-of-bounds.csv');

      // Wait for parse to complete (the in-panel result summary appears)
      cy.contains('extends past plot dimensionX').should('be.visible');
      // Aggregate banner from showErrors=true also surfaces above the form
      cy.get('[aria-label="CSV validation summary"]').should('be.visible');
      cy.contains(/validation issue/).should('be.visible');
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
        expect(lastCall.args[0]).to.deep.equal({ mode: 'csv', rows: [], coordinateReferenceCorner: 'SW' });
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

  describe('Coordinate reference corner', () => {
    it('defaults the selector to south-west', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      cy.get(REFERENCE_CORNER_SELECT_SELECTOR).should('contain.text', 'South-west (lower-left)');
    });

    it("exposes the visible FormLabel text as the select's accessible name (WCAG 2.5.3 Label in Name)", () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      // No aria-label: an explicit aria-label wins over label association and would make
      // the accessible name diverge from what a sighted user reads. The FormLabel's
      // htmlFor targeting the rendered control's id is what supplies the accessible name.
      const labelText = "Which corner does each row's StartX/StartY identify?";
      // The label's `for` must target the id ReferenceCornerSelect actually renders on
      // its control — proving the association is live, not just two matching literals.
      cy.contains('label', labelText).should('have.attr', 'for', REFERENCE_CORNER_SELECT_ID);
      cy.get(REFERENCE_CORNER_SELECT_SELECTOR).should('exist').and('not.have.attr', 'aria-label');
    });

    it('shows bounds errors for the north-east-labeled grid while the selector is still on south-west', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      uploadCsvFixture('quadrats-northeast-grid.csv');

      // Q0005 is startX=100 in the file: read as south-west it extends to x=120, past dimensionX=100.
      cy.contains('Quadrat "Q0005" extends past plot dimensionX').should('be.visible');
      cy.get('[aria-label="CSV load success"]').should('not.exist');
    });

    it('clears those errors when the selector is switched to north-east, without re-uploading', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      uploadCsvFixture('quadrats-northeast-grid.csv');
      cy.contains('Quadrat "Q0005" extends past plot dimensionX').should('be.visible');

      selectReferenceCorner('North-east (upper-right)');

      cy.contains('Quadrat "Q0005" extends past plot dimensionX').should('not.exist');
      cy.get('[aria-label="CSV load success"]').should('be.visible');
      cy.contains('Loaded 25 quadrats (no errors), read as North-east (upper-right)').should('be.visible');

      cy.get('@onChange').then((stub: any) => {
        const calls = stub.getCalls();
        const lastCall = calls[calls.length - 1];
        expect(lastCall.args[0]).to.deep.include({ mode: 'csv', coordinateReferenceCorner: 'NE' });
        // Re-deriving from the existing rows, not a re-upload: the row count is unchanged.
        expect(lastCall.args[0].rows).to.have.length(25);
      });
    });

    it('still rejects a genuinely out-of-bounds file under north-east — the corner is not an escape hatch', () => {
      const onChangeSpy = cy.stub().as('onChange');
      cy.mount(<StatefulPlanner initial={DEFAULT_CSV_VALUE} onChangeSpy={onChangeSpy} />);

      selectReferenceCorner('North-east (upper-right)');
      uploadCsvFixture('quadrats-out-of-bounds.csv');

      // A,90,0,20,20 read as north-east normalizes to startX=70, startY=-20 — still invalid.
      cy.get('[aria-label="CSV load success"]').should('not.exist');
      cy.contains(/validation (error|errors) found/).should('be.visible');
    });
  });
});
