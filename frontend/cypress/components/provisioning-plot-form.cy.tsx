import React, { useState } from 'react';
import PlotForm from '@/components/provisioning/PlotForm';
import type { ProvisioningPlotInput } from '@/lib/provisioning/types';
import { applyAreaDerivation, resolvePlotAreaChange, type AreaMode } from '@/lib/provisioning/area';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

type PlotValue = ProvisioningPlotInput;

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
// inputs reflect the latest emitted value on subsequent keystrokes. Mirrors
// the wizard's ownership of areaMode: PlotForm itself is stateless about it.
function StatefulPlotForm(props: { initial: PlotValue; onChangeSpy: (v: PlotValue) => void; showErrors?: boolean }) {
  const [value, setValue] = useState(props.initial);
  const [areaMode, setAreaMode] = useState<AreaMode>('derived');
  return (
    <PlotForm
      value={value}
      areaMode={areaMode}
      onAreaModeChange={next => {
        setAreaMode(next);
        if (next === 'derived') setValue(prev => applyAreaDerivation(prev, 'derived'));
      }}
      onChange={(next, requestedMode) => {
        const resolved = resolvePlotAreaChange(next, areaMode, requestedMode);
        setAreaMode(resolved.areaMode);
        setValue(resolved.plot);
        props.onChangeSpy(resolved.plot);
      }}
      showErrors={props.showErrors}
    />
  );
}

// Second harness: owns value + areaMode at the level ABOVE PlotForm, like the
// wizard page does, and conditionally mounts PlotForm so we can unmount/remount
// it the same way step navigation does. Exposes "Quadrats" / "Back" buttons that
// swap PlotForm out of and back into the DOM without touching areaMode.
function WizardLikeHarness(props: { initial: PlotValue; onChangeSpy: (v: PlotValue) => void }) {
  const [value, setValue] = useState(props.initial);
  const [areaMode, setAreaMode] = useState<AreaMode>('derived');
  const [showPlotStep, setShowPlotStep] = useState(true);

  return (
    <div>
      <button type="button" onClick={() => setShowPlotStep(false)}>
        Quadrats
      </button>
      <button type="button" onClick={() => setShowPlotStep(true)}>
        Back
      </button>
      {showPlotStep ? (
        <PlotForm
          value={value}
          areaMode={areaMode}
          onAreaModeChange={next => {
            setAreaMode(next);
            if (next === 'derived') setValue(prev => applyAreaDerivation(prev, 'derived'));
          }}
          onChange={(next, requestedMode) => {
            const resolved = resolvePlotAreaChange(next, areaMode, requestedMode);
            setAreaMode(resolved.areaMode);
            setValue(resolved.plot);
            props.onChangeSpy(resolved.plot);
          }}
        />
      ) : (
        <div aria-label="Quadrats step placeholder">Quadrats step</div>
      )}
    </div>
  );
}

describe('PlotForm', () => {
  it('shows required-field error for empty plotName when showErrors is true', () => {
    const onChange = cy.stub();
    const onAreaModeChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} areaMode="derived" onAreaModeChange={onAreaModeChange} onChange={onChange} showErrors />);
    cy.contains('Plot name is required.').should('be.visible');
  });

  it('does not show plotName error when name is provided', () => {
    const onChange = cy.stub();
    const onAreaModeChange = cy.stub();
    cy.mount(
      <PlotForm value={{ ...DEFAULT_VALUE, plotName: 'Rabi Main' }} areaMode="derived" onAreaModeChange={onAreaModeChange} onChange={onChange} showErrors />
    );
    cy.contains('Plot name is required.').should('not.exist');
  });

  it('shows plotName error only after the field is touched when showErrors is false', () => {
    const onChange = cy.stub();
    const onAreaModeChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} areaMode="derived" onAreaModeChange={onAreaModeChange} onChange={onChange} />);
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

  it('emits a UTM-scale Global Y exactly (the forestgeo_ldw regression value)', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Global Y"]').focus().type('{selectall}4343000');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const emitted = calls[calls.length - 1].args[0] as PlotValue;
      expect(emitted.globalY).to.equal(4343000);
      expect(typeof emitted.globalY).to.equal('number');
    });
  });

  it('labels the global coordinate inputs with the selected coordinate unit', () => {
    const onChange = cy.stub();
    const onAreaModeChange = cy.stub();
    cy.mount(
      <PlotForm value={{ ...DEFAULT_VALUE, defaultCoordinateUnits: 'cm' }} areaMode="derived" onAreaModeChange={onAreaModeChange} onChange={onChange} />
    );
    cy.contains('label', 'Global X (cm)').should('be.visible');
    cy.contains('label', 'Global Y (cm)').should('be.visible');
    cy.contains('label', 'Global Z (cm)').should('be.visible');
  });

  it('emits numeric globalCoordinatesEPSG when an EPSG code is typed', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Coordinate system EPSG code"]').focus().type('26916');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const emitted = calls[calls.length - 1].args[0] as PlotValue;
      expect(emitted.globalCoordinatesEPSG).to.equal(26916);
      expect(typeof emitted.globalCoordinatesEPSG).to.equal('number');
    });
  });

  it('clearing the EPSG input commits "not recorded" (undefined), not the last value', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={{ ...DEFAULT_VALUE, globalCoordinatesEPSG: 26916 }} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Coordinate system EPSG code"]').focus().type('{selectall}{backspace}');
    cy.get('@onChangeSpy').then((stub: any) => {
      const calls = stub.getCalls();
      const emitted = calls[calls.length - 1].args[0] as PlotValue;
      expect(emitted.globalCoordinatesEPSG).to.equal(undefined);
    });
  });

  it('shows an EPSG range error for an out-of-range code when the field is touched', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Coordinate system EPSG code"]').focus().type('99999').blur();
    cy.contains('Must be an integer between 1024 and 32767.').should('be.visible');
  });

  it('rejects a geographic EPSG code (4326) with a pointer to projected systems', () => {
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Coordinate system EPSG code"]').focus().type('4326').blur();
    cy.contains('is a geographic (latitude/longitude) system').should('be.visible');
    cy.contains('26916').should('be.visible');
  });

  it('shows dimensionX error for zero value when showErrors is true', () => {
    const onChange = cy.stub();
    const onAreaModeChange = cy.stub();
    cy.mount(<PlotForm value={{ ...DEFAULT_VALUE, dimensionX: 0 }} areaMode="derived" onAreaModeChange={onAreaModeChange} onChange={onChange} showErrors />);
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
    const onAreaModeChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} areaMode="derived" onAreaModeChange={onAreaModeChange} onChange={onChange} showErrors />);
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
    const onAreaModeChange = cy.stub();
    cy.mount(<PlotForm value={DEFAULT_VALUE} areaMode="derived" onAreaModeChange={onAreaModeChange} onChange={onChange} showErrors />);

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
    // Area Units is disabled while derived (Step 5), so this manual-entry test
    // must take manual ownership of the area first before the dropdown is interactive.
    const onChangeSpy = cy.stub().as('onChangeSpy');
    cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
    cy.get('[aria-label="Area"]').focus().type('{selectall}9999');
    cy.get('[aria-label="Default Area Units"]').should('not.be.disabled').click();
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

  describe('area derivation', () => {
    it('recalculates Area when a dimension changes while derived', () => {
      const onChangeSpy = cy.stub().as('onChangeSpy');
      cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
      cy.get('[aria-label="Dimension X"]').focus().type('{selectall}40');
      cy.get('[aria-label="Dimension Y"]').focus().type('{selectall}25');
      cy.get('[aria-label="Area"]').should('have.value', '1000');
      cy.get('@onChangeSpy').then((stub: any) => {
        const lastCall = stub.getCalls().at(-1);
        expect(lastCall.args[0].area).to.equal(1000);
      });
    });

    it('stops deriving once the user types an Area, and it survives a later dimension edit', () => {
      const onChangeSpy = cy.stub().as('onChangeSpy');
      cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
      cy.get('[aria-label="Area"]').focus().type('{selectall}7500');
      cy.get('[aria-label="Area"]').should('have.value', '7500');

      // A later dimension edit must not overwrite the manually-entered area —
      // neither the displayed draft nor the value handed to the parent.
      cy.get('[aria-label="Dimension X"]').focus().type('{selectall}55');
      cy.get('[aria-label="Area"]').should('have.value', '7500');
      cy.get('@onChangeSpy').then((stub: any) => {
        const lastCall = stub.getCalls().at(-1);
        expect(lastCall.args[0].area).to.equal(7500);
      });
    });

    it('clearing Area while still derived stays blank instead of snapping back to the derived value', () => {
      // Regression for the render-computed Area display: a bare clear never reaches
      // onChange (see handleNumericChange's isUncommittedNumericDraft guard), so the
      // mode transition to 'manual' has not happened yet at the moment the box is
      // cleared. The displayed value must still respect the user's in-progress edit
      // rather than falling back to the (still current) derived value.
      const onChangeSpy = cy.stub().as('onChangeSpy');
      cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
      cy.get('[aria-label="Area"]').should('have.value', '10000');
      cy.get('[aria-label="Area"]').focus().clear();
      cy.get('[aria-label="Area"]').should('have.value', '');

      cy.get('[aria-label="Area"]').type('4242');
      cy.get('[aria-label="Area"]').should('have.value', '4242');
      cy.get('@onChangeSpy').then((stub: any) => {
        const lastCall = stub.getCalls().at(-1);
        expect(lastCall.args[0].area).to.equal(4242);
      });
    });

    it('"Use calculated area" returns to derived mode and recomputes from current dimensions', () => {
      const onChangeSpy = cy.stub().as('onChangeSpy');
      cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
      cy.get('[aria-label="Area"]').focus().type('{selectall}7500');
      cy.get('[aria-label="Area"]').should('have.value', '7500');

      cy.contains('button', 'Use calculated value').click();
      // DEFAULT_VALUE dimensions are 100x100, so derived area is 10000
      cy.get('[aria-label="Area"]').should('have.value', '10000');

      // Prove derivation is actually back on (not just a one-off recompute) by
      // editing a dimension and checking both the redisplayed Area and the value
      // handed to the parent track the new dimensions.
      cy.get('[aria-label="Dimension X"]').focus().type('{selectall}30');
      cy.get('[aria-label="Area"]').should('have.value', '3000');
      cy.get('@onChangeSpy').then((stub: any) => {
        const lastCall = stub.getCalls().at(-1);
        expect(lastCall.args[0].area).to.equal(3000);
      });
    });

    it('disables the Area Units select while derived and enables it once manual', () => {
      const onChangeSpy = cy.stub().as('onChangeSpy');
      cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
      cy.get('[aria-label="Default Area Units"]').should('be.disabled');

      cy.get('[aria-label="Area"]').focus().type('{selectall}7500');
      cy.get('[aria-label="Default Area Units"]').should('not.be.disabled');
    });

    it('flips Default Area Units to match Default Dimension Units while derived', () => {
      // deriveAreaUnit maps unitSelectionOptions[i] -> areaSelectionOptions[i] by index
      // (see lib/provisioning/area.ts); this exercises that mapping end-to-end through
      // the actual dropdown rather than asserting on the pure function alone.
      const onChangeSpy = cy.stub().as('onChangeSpy');
      cy.mount(<StatefulPlotForm initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);
      cy.get('[aria-label="Default Area Units"]').should('contain.text', 'm2');

      cy.get('[aria-label="Default Dimension Units"]')
        .invoke('attr', 'aria-controls')
        .then(listboxId => {
          cy.get('[aria-label="Default Dimension Units"]').click();
          cy.get(`#${listboxId}`).find('[role="option"]').contains('cm').click();
        });

      cy.get('[aria-label="Default Dimension Units"]').should('contain.text', 'cm');
      cy.get('[aria-label="Default Area Units"]').should('contain.text', 'cm2');
      cy.get('@onChangeSpy').should('have.been.calledWithMatch', { defaultDimensionUnits: 'cm', defaultAreaUnits: 'cm2' });
    });

    it('shows the selected dimension unit in the Dimension X/Y labels', () => {
      const onChange = cy.stub();
      const onAreaModeChange = cy.stub();
      cy.mount(
        <PlotForm
          value={{ ...DEFAULT_VALUE, defaultDimensionUnits: 'cm' }}
          areaMode="derived"
          onAreaModeChange={onAreaModeChange}
          onChange={onChange}
          showErrors
        />
      );
      cy.contains('label', 'Dimension X (cm)').should('be.visible');
      cy.contains('label', 'Dimension Y (cm)').should('be.visible');
    });

    it('keeps a manually-entered area intact across an unmount/remount of PlotForm caused by wizard step navigation', () => {
      // A plain rerender would not catch the production bug: the wizard unmounts
      // PlotForm entirely on step change (Plot -> Quadrats) and remounts it on Back.
      // areaMode living in the wizard (not in PlotForm's local state) is what makes
      // the manual value survive that unmount/remount.
      const onChangeSpy = cy.stub().as('onChangeSpy');
      cy.mount(<WizardLikeHarness initial={DEFAULT_VALUE} onChangeSpy={onChangeSpy} />);

      cy.get('[aria-label="Area"]').focus().type('{selectall}8888');
      cy.get('[aria-label="Area"]').should('have.value', '8888');

      cy.contains('button', 'Quadrats').click();
      cy.get('[aria-label="Quadrats step placeholder"]').should('be.visible');
      cy.get('[aria-label="Area"]').should('not.exist');

      cy.contains('button', 'Back').click();
      cy.get('[aria-label="Area"]').should('have.value', '8888');

      cy.get('[aria-label="Dimension X"]').focus().type('{selectall}33');
      cy.get('[aria-label="Area"]').should('have.value', '8888');
      cy.get('@onChangeSpy').then((stub: any) => {
        const lastCall = stub.getCalls().at(-1);
        expect(lastCall.args[0].area).to.equal(8888);
      });
    });
  });
});
