'use client';

import React, { useState } from 'react';
import { Box, Dropdown, IconButton, ListDivider, ListItemDecorator, Menu, MenuButton, MenuItem, Typography } from '@mui/joy';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { CENSUS_OVERVIEW_TEXT } from '@/config/censusoverview';
import RebuildViewFullTableModal from './rebuildviewfulltablemodal';

export const CENSUS_OVERVIEW_DELETE_ITEM_TEST_ID = 'census-overview-delete-button';
const MENU_MIN_WIDTH_PX = 240;

export interface CensusOverviewActionsMenuProps {
  schema: string;
  /** null when the census can be deleted; otherwise the reason it can't. */
  deleteBlockReason: string | null;
  onDelete: () => void;
}

/** Secondary census actions kept out of the header: rebuilding the reporting view and deleting the census. */
export default function CensusOverviewActionsMenu({ schema, deleteBlockReason, onDelete }: CensusOverviewActionsMenuProps) {
  const [isRebuildOpen, setIsRebuildOpen] = useState(false);

  return (
    <>
      <Dropdown>
        <MenuButton
          slots={{ root: IconButton }}
          slotProps={{ root: { variant: 'outlined', color: 'neutral', 'aria-label': CENSUS_OVERVIEW_TEXT.moreActionsLabel } }}
        >
          <MoreHorizIcon />
        </MenuButton>
        <Menu placement="bottom-end" sx={{ minWidth: MENU_MIN_WIDTH_PX }}>
          <MenuItem onClick={() => setIsRebuildOpen(true)}>
            <ListItemDecorator>
              <AutorenewIcon />
            </ListItemDecorator>
            {CENSUS_OVERVIEW_TEXT.rebuildViewFullTableAction}
          </MenuItem>
          <ListDivider />
          <MenuItem color="danger" disabled={deleteBlockReason !== null} onClick={onDelete} data-testid={CENSUS_OVERVIEW_DELETE_ITEM_TEST_ID}>
            <ListItemDecorator>
              <DeleteForeverIcon />
            </ListItemDecorator>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography level="body-sm" color="danger">
                {CENSUS_OVERVIEW_TEXT.deleteCensusAction}
              </Typography>
              {deleteBlockReason ? (
                <Typography level="body-xs" color="neutral" sx={{ whiteSpace: 'normal' }}>
                  {deleteBlockReason}
                </Typography>
              ) : null}
            </Box>
          </MenuItem>
        </Menu>
      </Dropdown>
      <RebuildViewFullTableModal schema={schema} open={isRebuildOpen} onClose={() => setIsRebuildOpen(false)} />
    </>
  );
}
