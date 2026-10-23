import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// platform-mocks.ts stubs this module with only AttributeStatusOptions; use the real one.
vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());

import RenderFormExplanations from './renderformexplanations';
import RenderGridFormExplanations from './rendergridformexplanations';
import { AttributeStatusOptions } from '@/lib/db/definitions/core';
import { DatagridType, FormType, TableHeadersByFormType } from '@/config/macros/formdetails';

function statusExplanationLead(): string {
  const explanation = TableHeadersByFormType[FormType.attributes].find(header => header.label === 'status')?.explanation;
  if (!explanation) throw new Error('[renderformexplanations test] attributes form has no status explanation');
  return explanation.slice(0, explanation.indexOf(AttributeStatusOptions[0])).trim();
}

describe('status explanation chips (#524 item 9)', () => {
  it('RenderFormExplanations(attributes) renders one chip per AttributeStatusOptions entry, omitted included', () => {
    render(<>{RenderFormExplanations(FormType.attributes)}</>);

    const chipCounts = AttributeStatusOptions.map(status => ({ status, count: screen.queryAllByText(status, { exact: true }).length }));
    console.log(`[form explanation chips] ${JSON.stringify(chipCounts)} lead=${JSON.stringify(statusExplanationLead())}`);
    expect(chipCounts).toEqual(AttributeStatusOptions.map(status => ({ status, count: 1 })));
    expect(screen.getByText('omitted', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(statusExplanationLead(), { exact: true }), 'no status text may be left glued to the lead sentence').toBeInTheDocument();
  });

  it('RenderGridFormExplanations(attributes) lists every status in both the grid and form chip lists', () => {
    render(<RenderGridFormExplanations datagridType={DatagridType.attributes} />);

    for (const listName of ['Grid status categories', 'Form status categories']) {
      const list = screen.getByRole('list', { name: listName, hidden: true });
      const chips = within(list)
        .getAllByRole('listitem', { hidden: true })
        .map(chip => chip.textContent);
      console.log(`[grid explanation chips] ${listName}: ${JSON.stringify(chips)}`);
      expect(chips).toEqual(AttributeStatusOptions);
    }
  });
});
