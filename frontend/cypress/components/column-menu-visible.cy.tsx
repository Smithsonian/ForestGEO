import React from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { ALWAYS_VISIBLE_COLUMN_MENU_SX } from '@/config/styleddatagrid';

describe('ALWAYS_VISIBLE_COLUMN_MENU_SX', () => {
  it('shows the column-menu button on a sortable header without hover', () => {
    cy.viewport(1000, 400);
    cy.mount(
      <div style={{ width: 900, height: 300 }}>
        <DataGrid
          rows={[{ id: 1, treeTag: '010203' }]}
          columns={[{ field: 'treeTag', headerName: 'Tree Tag', width: 200 }]}
          sx={ALWAYS_VISIBLE_COLUMN_MENU_SX}
        />
      </div>
    );
    cy.get('[role="columnheader"][data-field="treeTag"] .MuiDataGrid-menuIcon button').should('be.visible');
  });
});
