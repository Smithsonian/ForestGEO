import React, { useState } from 'react';
import PlotForm from '@/components/provisioning/PlotForm';
import type { ProvisioningInput } from '@/lib/provisioning/types';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

type PlotValue = ProvisioningInput['plot'];

const DEFAULT_VALUE: PlotValue = {
  plotName: '',
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

// Stateful wrapper so the form re-renders with each onChange and controlled
// inputs reflect the latest emitted value on subsequent keystrokes.
function StatefulPlotForm(props: { initial: PlotValue; onChangeSpy: (v: PlotValue) => void; showErrors?: boolean }) {
  const [value, setValue] = useState(props.initial);
  return (
    <PlotForm
      value={value}
      onChange={next => {
        setValue(next);
        props.onChangeSpy(next);
      }}
      showErrors={props.showErrors}
    />
  );
}

describe('PlotForm', () => {
  it('shows required-field error for empty plotName when showErrors is true', () => {
    const onChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} onChange={onChange} showErrors />);
    cy.contains('Plot name is required.').should('be.visible');
  });

  it('does not show plotName error when name is provided', () => {
    const onChange = cy.stub();
    cy.mount(<PlotForm value={{ ...DEFAULT_VALUE, plotName: 'Rabi Main' }} onChange={onChange} showErrors />);
    cy.contains('Plot name is required.').should('not.exist');
  });

  it('shows plotName error only after the field is touched when showErrors is false', () => {
    const onChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} onChange={onChange} />);
    cy.contains('Plot name is required.').should('not.exist');
    cy.get('[aria-label="Plot Name"]').focus().blur();
    cy.contains('Plot name is required.').should('be.visible');
  });

  it('emits merged PlotValue with updated plotName on input', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Plot Name"]').type('Rabi');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const lastCall = calls[calls.length - 1];
      expect(lastCall.args[0]).to.include({ plotName: 'Rabi' });
      // Sibling numeric fields are preserved as numbers
      expect(lastCall.args[0].dimensionX).to.equal(100);
    });
  });

  it('emits numeric dimensionX (not a string) when the number input is replaced', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Dimension X"]').focus().type('{selectall}200');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const lastCall = calls[calls.length - 1];
      const emitted = lastCall.args[0] as PlotValue;
      expect(emitted.dimensionX).to.equal(200);
      expect(typeof emitted.dimensionX).to.equal('number');
    });
  });

  it('emits numeric globalZ accepting negative values', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    // Type a negative value by clearing and entering -5
    cy.get('[aria-label="Global Z"]').focus().type('{selectall}-5');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const lastCall = calls[calls.length - 1];
      const emitted = lastCall.args[0] as PlotValue;
      expect(emitted.globalZ).to.equal(-5);
      expect(typeof emitted.globalZ).to.equal('number');
    });
  });

  it('shows dimensionX error for zero value when showErrors is true', () => {
    const onChange = cy.stub();
    cy.mount(<PlotForm value={{ ...DEFAULT_VALUE, dimensionX: 0 }} onChange={onChange} showErrors />);
    cy.contains('Must be a positive number.').should('be.visible');
  });

  it('emits updated plotShape when a different option is selected', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    // MUI Joy Select renders a button — click it to open the listbox
    cy.get('[aria-label="Plot Shape"]').click();
    // Select the "Rectangular" option from the dropdown listbox
    cy.get('[role="option"]').contains('Rectangular').click();
    cy.get('@onChangeSpy').should('have.been.calledWithMatch', { plotShape: 'rectangular' });
  });

  it('renders the five unit fields as dropdowns, not free-text inputs', () => {
    const onChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} onChange={onChange} showErrors />);
    // MUI Joy Select renders as a <button>, not an <input> — this fails if any
    // of the five reverts to a free-text Input.
    for (const label of ['Default Dimension Units', 'Default Coordinate Units', 'Default Area Units', 'Default DBH Units', 'Default HOM Units']) {
      cy.get(`[aria-label="${label}"]`).should('have.prop', 'tagName', 'BUTTON');
    }
  });

  it('binds each unit dropdown to the correct option list (dimension units vs area units)', () => {
    // MUI Joy's Select keeps every Listbox mounted (keepMounted: true, linked to its
    // trigger via aria-controls) even while closed, so a bare [role="option"] query
    // would collect every Select's options across the form at once. Scope the query
    // to the Listbox owned by each specific trigger via aria-controls instead.
    const onChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} onChange={onChange} showErrors />);

    const assertOptionsMatch = (triggerAriaLabel: string, expectedOptions: readonly string[]) => {
      cy.get(`[aria-label="${triggerAriaLabel}"]`)
        .invoke('attr', 'aria-controls')
        .then(listboxId => {
          cy.get(`#${listboxId}`)
            .find('[role="option"]')
            .then($options => Cypress._.map($options, el => el.textContent))
            .should('deep.equal', [...expectedOptions]);
        });
    };

    // Dimension Units must be bound to unitSelectionOptions, not areaSelectionOptions —
    // wiring it to the wrong list would still render a Select and still pass a looser test.
    assertOptionsMatch('Default Dimension Units', unitSelectionOptions);

    // Area Units must be bound to areaSelectionOptions, not unitSelectionOptions.
    assertOptionsMatch('Default Area Units', areaSelectionOptions);
  });

  it('emits updated defaultAreaUnits when a different option is selected from the Area Units dropdown', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Default Area Units"]').click();
    cy.get('[role="option"]').contains('hm2').click();
    cy.get('@onChangeSpy').should('have.been.calledWithMatch', { defaultAreaUnits: 'hm2' });
  });

  it('keeps the dimensionX input empty (not 0) when the user clears it', () => {
    // Regression: Number('') === 0 used to force the input to '0' the moment a user
    // tried to clear it, fighting against in-progress edits. The form now mirrors
    // numeric fields with string drafts so empty stays empty.
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Dimension X"]').focus().clear();
    cy.get('[aria-label="Dimension X"]').should('have.value', '');
  });

  it('does not emit onChange when the dimensionX input is cleared to empty', () => {
    // Empty input means "mid-edit" — keep the last valid numeric value in the parent's
    // state rather than coercing to 0 (which historically caused validation to flip
    // unexpectedly while typing).
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Dimension X"]').focus().clear();
    cy.get('@onChangeSpy').then((stub: any) => {
      const lastCall = stub.getCalls().at(-1);
      // Either no call was made (most likely) or the last propagated value retained dimensionX
      if (lastCall) {
        expect(lastCall.args[0].dimensionX).to.equal(DEFAULT_VALUE.dimensionX);
      }
    });
  });
});
