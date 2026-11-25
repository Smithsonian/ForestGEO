'use client';

import React from 'react';
import { Button, Dropdown, ListDivider, Menu, MenuButton, MenuItem, Skeleton, Stack, Typography } from '@mui/joy';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import {
  describeViewDataValidationActions,
  formatViewDataFactsLine,
  VIEW_DATA_TEXT,
  type ViewDataStateCounts,
  type ViewDataValidationActionID
} from '@/config/viewdata';

const FACTS_SKELETON_WIDTH = 280;
const MENU_MIN_WIDTH = 300;
const DESCRIBED_ITEM_SX = { flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 } as const;

function DescribedMenuItem({ label, description, disabled = false, onClick }: { label: string; description: string; disabled?: boolean; onClick: () => void }) {
  return (
    <MenuItem disabled={disabled} onClick={onClick} sx={DESCRIBED_ITEM_SX}>
      <Typography level="title-sm">{label}</Typography>
      <Typography level="body-xs">{description}</Typography>
    </MenuItem>
  );
}

function MenuGroupLabel({ children }: { children: string }) {
  return (
    <Typography level="body-xs" textTransform="uppercase" role="presentation" sx={{ px: 1.5, py: 0.5, fontWeight: 'lg' }}>
      {children}
    </Typography>
  );
}

export interface AddMeasurementsMenuProps {
  onManualEntry: () => void;
  onUploadCsv: () => void;
  onImportArcgis: () => void;
}

export function AddMeasurementsMenu({ onManualEntry, onUploadCsv, onImportArcgis }: AddMeasurementsMenuProps) {
  return (
    <Dropdown>
      <MenuButton variant="solid" color="primary" size="sm" endDecorator={<ArrowDropDownIcon />}>
        {VIEW_DATA_TEXT.addMeasurements}
      </MenuButton>
      <Menu placement="bottom-end" sx={{ minWidth: MENU_MIN_WIDTH }}>
        <DescribedMenuItem label={VIEW_DATA_TEXT.manualEntry} description={VIEW_DATA_TEXT.manualEntryDescription} onClick={onManualEntry} />
        <DescribedMenuItem label={VIEW_DATA_TEXT.uploadCsv} description={VIEW_DATA_TEXT.uploadCsvDescription} onClick={onUploadCsv} />
        <DescribedMenuItem label={VIEW_DATA_TEXT.importArcgis} description={VIEW_DATA_TEXT.importArcgisDescription} onClick={onImportArcgis} />
      </Menu>
    </Dropdown>
  );
}

export interface ViewDataHeaderProps extends AddMeasurementsMenuProps {
  scopeLine: string;
  stateCounts: ViewDataStateCounts | null;
  isReadOnly: boolean;
  showActions: boolean;
  failedUploadCount: number;
  canFixFailedUploads: boolean;
  onFixFailedUploads: () => void;
  onExportCsv: () => void;
  onRunValidations: () => void;
  onOverrideValidations: () => void;
  onResetValidations: () => void;
  onRefreshView: () => void | Promise<void>;
  onOpenHeaderReference: () => void;
}

export default function ViewDataHeader(props: ViewDataHeaderProps) {
  const {
    scopeLine,
    stateCounts,
    isReadOnly,
    showActions,
    failedUploadCount,
    canFixFailedUploads,
    onFixFailedUploads,
    onExportCsv,
    onRefreshView,
    onOpenHeaderReference
  } = props;
  const validationHandlers: Record<ViewDataValidationActionID, () => void> = {
    'run-validations': props.onRunValidations,
    'override-validations': props.onOverrideValidations,
    'reset-validations': props.onResetValidations
  };
  const validationActions = describeViewDataValidationActions({
    pending: stateCounts?.pending ?? 0,
    overridable: stateCounts?.overridable ?? 0,
    revalidatable: stateCounts?.revalidatable ?? 0
  });

  return (
    <Stack
      component="header"
      direction={{ xs: 'column', md: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', md: 'flex-end' }}
      spacing={1.5}
      sx={{ mb: 1.5, width: '100%' }}
    >
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography level="body-sm" textColor="text.tertiary" data-testid="view-data-scope-line">
          {scopeLine}
        </Typography>
        <Typography level="h3" component="h1">
          {VIEW_DATA_TEXT.title}
        </Typography>
        {stateCounts ? (
          <Typography level="body-sm" data-testid="view-data-facts-line">
            {formatViewDataFactsLine(stateCounts, isReadOnly)}
          </Typography>
        ) : (
          <Skeleton variant="text" level="body-sm" width={FACTS_SKELETON_WIDTH} />
        )}
      </Stack>
      {showActions && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }} data-testid="view-data-header-actions">
          {canFixFailedUploads && failedUploadCount > 0 && (
            <Button variant="outlined" color="warning" size="sm" startDecorator={<BuildCircleOutlinedIcon />} onClick={onFixFailedUploads}>
              {VIEW_DATA_TEXT.fixFailedUploads(failedUploadCount)}
            </Button>
          )}
          <Button variant="outlined" color="neutral" size="sm" startDecorator={<FileDownloadOutlinedIcon />} onClick={onExportCsv}>
            {VIEW_DATA_TEXT.exportCsv}
          </Button>
          <Dropdown>
            <MenuButton variant="outlined" color="neutral" size="sm" endDecorator={<ArrowDropDownIcon />}>
              {VIEW_DATA_TEXT.moreActions}
            </MenuButton>
            <Menu placement="bottom-end" sx={{ minWidth: MENU_MIN_WIDTH }}>
              <MenuGroupLabel>{VIEW_DATA_TEXT.validationGroup}</MenuGroupLabel>
              {validationActions.map(action => (
                <DescribedMenuItem
                  key={action.id}
                  label={action.label}
                  description={action.description}
                  disabled={action.disabled}
                  onClick={validationHandlers[action.id]}
                />
              ))}
              <ListDivider />
              <MenuGroupLabel>{VIEW_DATA_TEXT.viewGroup}</MenuGroupLabel>
              <DescribedMenuItem label={VIEW_DATA_TEXT.refreshView} description={VIEW_DATA_TEXT.refreshViewDescription} onClick={() => void onRefreshView()} />
              <DescribedMenuItem
                label={VIEW_DATA_TEXT.headerReference}
                description={VIEW_DATA_TEXT.headerReferenceDescription}
                onClick={onOpenHeaderReference}
              />
            </Menu>
          </Dropdown>
          <AddMeasurementsMenu onManualEntry={props.onManualEntry} onUploadCsv={props.onUploadCsv} onImportArcgis={props.onImportArcgis} />
        </Stack>
      )}
    </Stack>
  );
}
