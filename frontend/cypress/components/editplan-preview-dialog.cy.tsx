import React from 'react';
import PreviewDialog from '@/components/editplan/previewdialog';
import type { EditPlan, Effect } from '@/config/editplan/types';

// ---------------------------------------------------------------------------
// Cypress component test for PreviewDialog — the shared single-row edit
// preview surface introduced by the editplan refactor.
//
// The existing vitest + Testing Library spec (previewdialog.test.tsx) covers
// the same behavior in jsdom. This Cypress spec adds browser-level coverage
// so regressions in CSS stacking, MUI Joy's Modal portal, and real click
// event bubbling are also caught.
// ---------------------------------------------------------------------------

const PLAN_HASH = 'a'.repeat(64);

function makeEffect(overrides: Partial<Effect> = {}): Effect {
  return {
    id: overrides.id ?? 'effect-generic',
    severity: overrides.severity ?? 'info',
    category: overrides.category ?? 'field',
    title: overrides.title ?? 'Generic effect',
    detail: overrides.detail ?? 'A generic effect for testing.',
    affectedTable: overrides.affectedTable ?? 'coremeasurements',
    affectedRowCount: overrides.affectedRowCount ?? 0,
    references: overrides.references
  };
}

function makeMixedSeverityPlan(): EditPlan {
  return {
    dataType: 'measurementssummary',
    targetID: 4242,
    fieldChanges: [
      { field: 'MeasuredDBH', from: 10, to: 12 },
      { field: 'TreeTag', from: 'OLD', to: 'NEW' }
    ],
    effects: [
      makeEffect({
        id: 'info-children-untouched',
        severity: 'info',
        category: 'field',
        title: 'No other measurements on this stem will change',
        detail: 'The DBH update only applies to this measurement row.',
        affectedRowCount: 0
      }),
      makeEffect({
        id: 'warn-reparenting-stems',
        severity: 'warn',
        category: 'identity',
        title: 'Reparenting stem to a new tree',
        detail: 'Stem S1 will move from tree OLD to tree NEW.',
        affectedTable: 'stems',
        affectedRowCount: 1,
        references: { stemGUIDs: [42], treeIDs: [7, 8] }
      }),
      makeEffect({
        id: 'destructive-duplicate-merge',
        severity: 'destructive',
        category: 'destructive',
        title: 'Duplicate measurement will be removed',
        detail: 'Row 9999 shares the same (tree, stem, date) and will be deleted.',
        affectedTable: 'coremeasurements',
        affectedRowCount: 3,
        references: { coreMeasurementIDs: [9999, 10000, 10001] }
      })
    ],
    maxSeverity: 'destructive',
    planHash: PLAN_HASH,
    generatedAt: '2026-04-21T12:00:00.000Z'
  };
}

describe('PreviewDialog (Cypress component)', () => {
  it('renders effects grouped destructive -> warn -> info and fires onConfirm', () => {
    const plan = makeMixedSeverityPlan();
    const onConfirm = cy.stub().as('onConfirm').resolves(undefined);
    const onCancel = cy.stub().as('onCancel');

    cy.mount(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

    cy.contains(/Review changes.*Measurement #4242/).should('be.visible');

    // Field diff rows rendered
    cy.get('[data-testid="edit-preview-field-MeasuredDBH"]').should('contain.text', '10').and('contain.text', '12');
    cy.get('[data-testid="edit-preview-field-TreeTag"]').should('contain.text', 'OLD').and('contain.text', 'NEW');

    // Severity ordering: destructive first, then warn, then info.
    // The `edit-effect-<id>` selector intentionally excludes the nested
    // `edit-effect-rowcount-<id>` chips; we want only the outer effect cards.
    cy.get('[data-testid="edit-preview-effects"]')
      .find('[data-testid^="edit-effect-"]')
      .filter((_index, el) => !(el.getAttribute('data-testid') ?? '').startsWith('edit-effect-rowcount-'))
      .then($cards => {
        const ids = Cypress.$.makeArray($cards).map(el => el.getAttribute('data-testid'));
        expect(ids).to.deep.equal(['edit-effect-destructive-duplicate-merge', 'edit-effect-warn-reparenting-stems', 'edit-effect-info-children-untouched']);
      });

    // Affected-row badge renders for effects with row counts.
    cy.get('[data-testid="edit-effect-rowcount-destructive-duplicate-merge"]').should('contain.text', '3 rows');
    cy.get('[data-testid="edit-effect-rowcount-warn-reparenting-stems"]').should('contain.text', '1 row');

    // Apply calls onConfirm.
    cy.get('[data-testid="edit-preview-apply"]').click();
    cy.get('@onConfirm').should('have.been.calledOnce');
    cy.get('@onCancel').should('not.have.been.called');
  });

  it('fires onCancel when Cancel is clicked without touching onConfirm', () => {
    const plan = makeMixedSeverityPlan();
    const onConfirm = cy.stub().as('onConfirm').resolves(undefined);
    const onCancel = cy.stub().as('onCancel');

    cy.mount(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

    cy.get('[data-testid="edit-preview-cancel"]').click();
    cy.get('@onCancel').should('have.been.calledOnce');
    cy.get('@onConfirm').should('not.have.been.called');
  });

  it('disables both action buttons while busy so double-apply is impossible', () => {
    const plan = makeMixedSeverityPlan();
    const onConfirm = cy.stub().as('onConfirm').resolves(undefined);
    const onCancel = cy.stub().as('onCancel');

    cy.mount(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={true} />);

    cy.get('[data-testid="edit-preview-apply"]').should('be.disabled');
    cy.get('[data-testid="edit-preview-cancel"]').should('be.disabled');
  });
});
