import React, { useState } from 'react';
import SiteForm from '@/components/provisioning/SiteForm';
import type { ProvisioningInput } from '@/lib/provisioning/types';

type SiteValue = ProvisioningInput['site'];

const DEFAULT_VALUE: SiteValue = {
  siteName: '',
  schemaName: '',
  sqDimX: 5,
  sqDimY: 5,
  defaultUOMDBH: 'mm',
  defaultUOMHOM: 'm',
  doubleDataEntry: false,
  location: '',
  country: ''
};

// Stateful wrapper so the form actually updates when onChange fires.
// Without this, the controlled input never re-renders and subsequent
// keystrokes see stale DOM state.
function StatefulSiteForm(props: { initial: SiteValue; onChangeSpy: (v: SiteValue) => void; showErrors?: boolean }) {
  const [value, setValue] = useState(props.initial);
  return (
    <SiteForm
      value={value}
      onChange={next => {
        setValue(next);
        props.onChangeSpy(next);
      }}
      showErrors={props.showErrors}
    />
  );
}

describe('SiteForm', () => {
  it('shows error helper text for invalid schema name when showErrors is true', () => {
    const onChange = cy.stub().as('onChange');
    cy.mount(<SiteForm value={{ ...DEFAULT_VALUE, schemaName: 'badname' }} onChange={onChange} showErrors />);
    cy.contains(/Must match forestgeo_/i).should('be.visible');
  });

  it('does not show schema-name error for a valid schema name', () => {
    const onChange = cy.stub().as('onChange');
    cy.mount(<SiteForm value={{ ...DEFAULT_VALUE, schemaName: 'forestgeo_rabi' }} onChange={onChange} showErrors />);
    cy.contains(/Must match forestgeo_/i).should('not.exist');
  });

  it('shows schema-name error only after the field is touched when showErrors is false', () => {
    const onChange = cy.stub().as('onChange');
    cy.mount(<SiteForm value={{ ...DEFAULT_VALUE, schemaName: 'badname' }} onChange={onChange} />);
    // Error should not be visible before touching the field
    cy.contains(/Must match forestgeo_/i).should('not.exist');
    // Blur the field to mark it touched
    cy.get('[aria-label="Schema Name"]').focus().blur();
    cy.contains(/Must match forestgeo_/i).should('be.visible');
  });

  it('emits merged SiteValue with updated siteName on input', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulSiteForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Site Name"]').type('Rabi');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const lastCall = calls[calls.length - 1];
      // After typing 'Rabi' the final value should have siteName ending in 'Rabi'
      expect(lastCall.args[0]).to.include({ siteName: 'Rabi' });
      // Sibling fields are preserved
      expect(lastCall.args[0].sqDimX).to.equal(5);
    });
  });

  it('emits numeric sqDimX (not a string) when the number input is replaced', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulSiteForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    // Select-all then type to replace the existing value
    cy.get('[aria-label="Subquadrat Dimension X"]').focus().type('{selectall}10');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const lastCall = calls[calls.length - 1];
      const emitted = lastCall.args[0] as SiteValue;
      expect(emitted.sqDimX).to.equal(10);
      expect(typeof emitted.sqDimX).to.equal('number');
    });
  });

  it('emits numeric sqDimY (not a string) when the number input is replaced', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulSiteForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Subquadrat Dimension Y"]').focus().type('{selectall}8');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const lastCall = calls[calls.length - 1];
      const emitted = lastCall.args[0] as SiteValue;
      expect(emitted.sqDimY).to.equal(8);
      expect(typeof emitted.sqDimY).to.equal('number');
    });
  });

  it('shows required-field errors for empty siteName, location, and country when showErrors is true', () => {
    const onChange = cy.stub();
    cy.mount(<SiteForm value={DEFAULT_VALUE} onChange={onChange} showErrors />);
    cy.contains('Site name is required.').should('be.visible');
    cy.contains('Location is required.').should('be.visible');
    cy.contains('Country is required.').should('be.visible');
  });

  it('toggles doubleDataEntry via the Switch and emits boolean true', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulSiteForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Double Data Entry"]').click();
    cy.get('@onChangeSpy').should('have.been.calledWithMatch', { doubleDataEntry: true });
  });
});
