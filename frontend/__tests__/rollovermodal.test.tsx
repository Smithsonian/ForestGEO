import RolloverModal from '@/components/client/rollovermodal';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fetch API
global.fetch = vi.fn();

// Mock contexts
vi.mock('@/app/contexts/userselectionprovider', () => ({
  useSiteContext: () => ({ schemaName: 'testSchema' }),
  usePlotContext: () => ({ plotID: 1 }),
}));
vi.mock('@/app/contexts/listselectionprovider', () => ({
  useOrgCensusListContext: () => [
    { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] },
    { plotCensusNumber: 2, dateRanges: [{ censusID: 2 }] },
  ],
}));

// Mock Data
const previousPersonnel = [
  { personnelID: 1, name: 'Person 1' },
  { personnelID: 2, name: 'Person 2' },
];
const previousQuadrats = [
  { quadratID: 1, name: 'Quadrat 1' },
  { quadratID: 2, name: 'Quadrat 2' },
];

describe('RolloverModal Component', () => {
  const setup = (props = {}) => render(
    <RolloverModal
      open={true}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      {...props}
    />
  );

  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/fetchall/personnel/')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve(previousPersonnel),
        });
      }
      if (url.includes('/fetchall/quadrats/')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve(previousQuadrats),
        });
      }
      if (url.includes('/cmprevalidation/personnel/')) {
        return Promise.resolve({
          status: 200,
        });
      }
      if (url.includes('/cmprevalidation/quadrats/')) {
        return Promise.resolve({
          status: 200,
        });
      }
      return Promise.reject(new Error('Unknown API call'));
    });
  });

  it('should open modal and display title', async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText(/Rollover Census Data/i)).toBeInTheDocument();
    });
  });

  it('should show error if no checkbox is selected and confirm is pressed', async () => {
    setup();
    fireEvent.click(screen.getByText(/Confirm/i));
    await waitFor(() => {
      expect(screen.getByText(/You must select at least one option to roll over or confirm no rollover/i)).toBeInTheDocument();
    });
  });

  it('should allow selecting and confirming personnel rollover', async () => {
    setup();
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText(/Roll over personnel data/i));
    });
    fireEvent.click(screen.getByText(/Confirm/i));
    await waitFor(() => {
      expect(screen.queryByText(/You must select at least one option to roll over or confirm no rollover/i)).toBeNull();
    });
  });

  it('should allow selecting and confirming quadrats rollover', async () => {
    setup();
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText(/Roll over quadrats data/i));
    });
    fireEvent.click(screen.getByText(/Confirm/i));
    await waitFor(() => {
      expect(screen.queryByText(/You must select at least one option to roll over or confirm no rollover/i)).toBeNull();
    });
  });

  it('should allow selecting and confirming both personnel and quadrats rollover', async () => {
    setup();
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText(/Roll over personnel data/i));
      fireEvent.click(screen.getByLabelText(/Roll over quadrats data/i));
    });
    fireEvent.click(screen.getByText(/Confirm/i));
    await waitFor(() => {
      expect(screen.queryByText(/You must select at least one option to roll over or confirm no rollover/i)).toBeNull();
    });
  });

  it('should allow customizing personnel selection', async () => {
    setup();
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText(/Roll over personnel data/i));
      fireEvent.click(screen.getByText(/Customize personnel selection/i));
    });
    expect(screen.getByText(/Person 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Person 2/i)).toBeInTheDocument();
  });

  it('should allow customizing quadrats selection', async () => {
    setup();
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText(/Roll over quadrats data/i));
      fireEvent.click(screen.getByText(/Customize quadrats selection/i));
    });
    expect(screen.getByText(/Quadrat 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Quadrat 2/i)).toBeInTheDocument();
  });

  it('should confirm no rollover for personnel', async () => {
    setup();
    fireEvent.mouseDown(screen.getByLabelText(/Do not roll over any Personnel data/i));
    fireEvent.click(screen.getByText(/Confirm No Rollover/i));
    fireEvent.click(screen.getByText(/Confirm/i));
    await waitFor(() => {
      expect(screen.queryByText(/You must select at least one option to roll over or confirm no rollover/i)).toBeNull();
    });
  });

  it('should confirm no rollover for quadrats', async () => {
    setup();
    fireEvent.mouseDown(screen.getByLabelText(/Do not roll over any Quadrats data/i));
    fireEvent.click(screen.getByText(/Confirm No Rollover/i));
    fireEvent.click(screen.getByText(/Confirm/i));
    await waitFor(() => {
      expect(screen.queryByText(/You must select at least one option to roll over or confirm no rollover/i)).toBeNull();
    });
  });

  it('should handle error during fetch data', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')));
    setup();
    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch previous data. Please try again/i)).toBeInTheDocument();
    });
  });
});
