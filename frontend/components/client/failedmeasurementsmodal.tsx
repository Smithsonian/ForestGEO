'use client';

import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography } from '@mui/joy';
import IsolatedFailedMeasurementsDataGrid from '@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';

interface FailedMeasurementsModalProps {
  open: boolean;
  handleCloseModal: () => Promise<void>;
}

export default function FailedMeasurementsModal(props: FailedMeasurementsModalProps) {
  const { open, handleCloseModal } = props;
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  async function resubmitRows() {
    await fetch(`/api/formatrunquery`, {
      method: 'POST',
      body: JSON.stringify({
        query: `CALL ${currentSite?.schemaName}.reingestfailedrows(?, ?);`,
        params: [currentPlot?.plotID, currentCensus?.dateRanges[0].censusID]
      })
    });
    const response = await fetch(`/api/setupbulkprocessor/${currentSite?.schemaName}/${currentPlot?.plotID ?? -1}/${currentCensus?.dateRanges[0].censusID}`);
    const failedOutput: { fileID: string; batchID: string }[] = await response.json();
    const grouped: Record<string, string[]> = failedOutput.reduce(
      (acc, { fileID, batchID }) => {
        if (!acc[fileID]) {
          acc[fileID] = [];
        }
        acc[fileID].push(batchID);
        return acc;
      },
      {} as Record<string, string[]>
    );
    for (const fileID in grouped) {
      console.log(`Processing FileID: ${fileID}`);
      // Map each batchID to a queued task.
      const batchTasks = grouped[fileID].map(async batchID => {
        console.log(`  BatchID: ${batchID}`);
        try {
          await fetch(`/api/setupbulkprocedure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${currentSite?.schemaName}`);
          console.log(`Processed batch ${batchID} for file ${fileID}`);
        } catch (e: any) {
          // unforeseen error OR max attempts exceeded. Need to move to errors and reset the table. User should reupload
          // clear temporarymeasurements table:
          await fetch(`/api/formatrunquery`, {
            body: JSON.stringify({
              query: `delete from ${currentSite?.schemaName}.temporarymeasurements where PlotID = ? and CensusID = ?;`,
              params: [currentPlot?.plotID, currentCensus?.dateRanges[0].censusID]
            }),
            method: 'POST'
          });
          throw e;
        }
      });
      await Promise.all(batchTasks);
    }
    await handleCloseModal();
  }

  return (
    <Modal open={open} onClose={handleCloseModal}>
      <ModalDialog size="lg" sx={{ width: '100%', maxHeight: '100vh', overflow: 'auto' }} role="alertdialog">
        <DialogTitle>Failed Measurements</DialogTitle>
        <DialogContent>
          <Typography level={'title-sm'}>
            The following measurements failed to be uploaded. <br />
            Edit the measurements in this table and press the submit button to try again.
          </Typography>
          <IsolatedFailedMeasurementsDataGrid />
        </DialogContent>
        <DialogActions>
          <Button variant="solid" color="primary" onClick={resubmitRows}>
            Resubmit Rows
          </Button>
          <Button variant={'soft'} color={'danger'} onClick={handleCloseModal}>
            Close Modal
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
