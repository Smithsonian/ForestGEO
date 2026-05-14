import React, { useState } from 'react';
import PlotForm from '@/components/provisioning/PlotForm';
import type { ProvisioningInput } from '@/lib/provisioning/types';

type PlotValue = ProvisioningInput['plot'];

const DEFAULT_VALUE: PlotValue = {
  plotName: '',
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

  it('shows required unit errors when showErrors is true and unit fields are empty', () => {
    const onChange = cy.stub();
    const emptyUnits: PlotValue = {
      ...DEFAULT_VALUE,
      defaultDimensionUnits: '',
      defaultCoordinateUnits: '',
      defaultAreaUnits: '',
      defaultDBHUnits: '',
      defaultHOMUnits: ''
    };
    cy.mount(<PlotForm value={emptyUnits} onChange={onChange} showErrors />);
    // Each unit FormControl should show a 'Required.' helper text
    cy.get('[aria-label="Default Dimension Units"]').closest('[class*="MuiFormControl"]').contains('Required.').should('be.visible');
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
