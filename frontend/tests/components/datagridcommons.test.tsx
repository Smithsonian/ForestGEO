import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SnackbarProvider} from 'notistack';
import fetchMock from 'jest-fetch-mock';
import {CensusContext, PlotContext, QuadratContext, SiteContext} from '@/app/contexts/userselectionprovider';
import PersonnelPage from '@/app/(hub)/properties/personnel/page';
import AttributesPage from '@/app/(hub)/properties/attributes/page';
import QuadratsPage from '@/app/(hub)/properties/quadrats/page';
import SpeciesPage from '@/app/(hub)/properties/species/page';
import CensusPage from '@/app/(hub)/properties/census/page';

fetchMock.enableMocks();

beforeEach(() => {
  fetchMock.resetMocks();
});

const mockContextProvider = ({children}: { children: React.ReactNode }) => (
  <SnackbarProvider>
    <SiteContext.Provider value={{schemaName: 'testSchema', siteID: 1, siteName: 'Test Site'}}>
      <PlotContext.Provider value={{id: 1, key: 'mockKey', num: 1}}>
        <CensusContext.Provider value={{
          id: 1,
          censusID: 100,
          plotID: 1,
          plotCensusNumber: 1,
          startDate: new Date(),
          endDate: new Date(),
          description: 'Mock description'
        }}>
          <QuadratContext.Provider value={{quadratID: 1, plotID: 1, quadratName: 'mockQuadratName'}}>
            {children}
          </QuadratContext.Provider>
        </CensusContext.Provider>
      </PlotContext.Provider>
    </SiteContext.Provider>
  </SnackbarProvider>
);

describe('AttributesPage Integration Tests', () => {
  it('loads initial data and displays in grid', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({
      attributes: [{id: 1, code: 'A001', description: 'Initial Attribute', status: 'Active'}],
      totalCount: 1
    }));

    render(<AttributesPage/>, {wrapper: mockContextProvider});

    await waitFor(() => {
      expect(screen.getByText('Initial Attribute')).toBeInTheDocument();
    });
  });

  it('allows adding a new attribute and handles API response', async () => {
    render(<AttributesPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponses(
      [JSON.stringify({message: "Insert successful"}), {status: 200}]
    );

    fireEvent.click(screen.getByRole('button', {name: /add new row/i}));
    fireEvent.change(screen.getByLabelText(/code/i), {target: {value: 'A002'}});
    fireEvent.change(screen.getByLabelText(/description/i), {target: {value: 'New Attribute'}});
    fireEvent.click(screen.getByRole('button', {name: /save/i}));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/attributes?schema=testSchema', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({code: 'A002', description: 'New Attribute', status: 'Active'})
      }));
      expect(screen.getByText(/insert successful/i)).toBeInTheDocument();
    });
  });

  it('handles attribute editing and updates', async () => {
    render(<AttributesPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponseOnce(JSON.stringify({message: "Update successful"}));

    fireEvent.click(screen.getByRole('button', {name: /edit/i}));
    fireEvent.change(screen.getByLabelText(/description/i), {target: {value: 'Updated Attribute'}});
    fireEvent.click(screen.getByRole('button', {name: /save/i}));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/attributes?schema=testSchema', expect.objectContaining({
        method: 'PATCH'
      }));
      expect(screen.getByText(/update successful/i)).toBeInTheDocument();
    });
  });

  it('deletes an attribute after confirmation', async () => {
    render(<AttributesPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponseOnce(JSON.stringify({message: "Delete successful"}));

    fireEvent.click(screen.getByRole('button', {name: /delete/i}));
    // Assume confirmation dialog appears and user confirms
    fireEvent.click(screen.getByRole('button', {name: /confirm delete/i}));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/attributes?schema=testSchema', expect.objectContaining({
        method: 'DELETE'
      }));
      expect(screen.getByText(/delete successful/i)).toBeInTheDocument();
    });
  });

  it('displays an error message on API failure', async () => {
    fetchMock.mockReject(new Error('API call failed'));
    render(<AttributesPage/>, {wrapper: mockContextProvider});
    fireEvent.click(screen.getByRole('button', {name: /refresh/i}));

    await waitFor(() => {
      expect(screen.getByText(/error fetching data/i)).toBeInTheDocument();
    });
  });

  it('displays error message when POST request fails on AttributesPage', async () => {
    render(<AttributesPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponseOnce(JSON.stringify({message: 'Failed to create attribute'}), {status: 400});

    fireEvent.click(screen.getByRole('button', {name: /add new row/i}));
    fireEvent.change(screen.getByLabelText(/code/i), {target: {value: 'A003'}});
    fireEvent.change(screen.getByLabelText(/description/i), {target: {value: 'Failed Attribute'}});
    fireEvent.click(screen.getByRole('button', {name: /save/i}));

    await waitFor(() => {
      expect(screen.getByText(/failed to create attribute/i)).toBeInTheDocument();
    });
  });

  it('displays error message when PATCH request fails on AttributesPage', async () => {
    render(<AttributesPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponseOnce(JSON.stringify({message: 'Failed to update attribute'}), {status: 400});

    fireEvent.click(screen.getByRole('button', {name: /edit/i}));
    fireEvent.change(screen.getByLabelText(/description/i), {target: {value: 'Invalid Update'}});
    fireEvent.click(screen.getByRole('button', {name: /save/i}));

    await waitFor(() => {
      expect(screen.getByText(/failed to update attribute/i)).toBeInTheDocument();
    });
  });
  it('allows adding new personnel and handles API response', async () => {
    render(<PersonnelPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponseOnce(JSON.stringify({message: "Insert successful", newPersonnelID: 101}), {status: 200});

    fireEvent.click(screen.getByRole('button', {name: /add new row/i}));
    fireEvent.change(screen.getByLabelText(/first name/i), {target: {value: 'Jane'}});
    fireEvent.change(screen.getByLabelText(/last name/i), {target: {value: 'Doe'}});
    fireEvent.click(screen.getByRole('button', {name: /save/i}));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Jane')
      }));
      expect(screen.getByText(/insert successful/i)).toBeInTheDocument();
    });
  });

  it('handles errors when PATCH request fails on PersonnelPage', async () => {
    render(<PersonnelPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponseOnce(JSON.stringify({message: 'Update failed'}), {status: 400});

    fireEvent.click(screen.getByRole('button', {name: /edit/i}));
    fireEvent.change(screen.getByLabelText(/last name/i), {target: {value: 'Smith'}});
    fireEvent.click(screen.getByRole('button', {name: /save/i}));

    await waitFor(() => {
      expect(screen.getByText(/update failed/i)).toBeInTheDocument();
    });
  });

  it('handles personnel deletion and confirmation on PersonnelPage', async () => {
    render(<PersonnelPage/>, {wrapper: mockContextProvider});
    fetchMock.mockResponseOnce(JSON.stringify({message: "Delete successful"}));

    fireEvent.click(screen.getByRole('button', {name: /delete/i}));
    // Assume confirmation dialog appears and user confirms
    fireEvent.click(screen.getByRole('button', {name: /confirm delete/i}));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        method: 'DELETE'
      }));
      expect(screen.getByText(/delete successful/i)).toBeInTheDocument();
    });
  });
  describe('QuadratsPage Integration Tests', () => {
    it('loads initial data and displays in grid', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({
        quadrats: [{
          id: 1,
          quadratID: 1,
          plotID: 1,
          quadratName: 'Sample Quadrat',
          dimensionX: 100,
          dimensionY: 100,
          area: 10000,
          quadratShape: 'Rectangle',
          personnel: []
        }],
        totalCount: 1
      }));

      render(<QuadratsPage/>, {wrapper: mockContextProvider});

      await waitFor(() => {
        expect(screen.getByText('Sample Quadrat')).toBeInTheDocument();
      });
      expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/quadrats?schema=testSchema&page=0&pageSize=10`, expect.anything());
    });

    it('allows adding a new quadrat and handles API response', async () => {
      render(<QuadratsPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify({message: "Insert successful"}));

      fireEvent.click(screen.getByRole('button', {name: /add new row/i}));
      fireEvent.change(screen.getByLabelText(/quadrat name/i), {target: {value: 'New Quadrat'}});
      fireEvent.click(screen.getByRole('button', {name: /save/i}));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/quadrats`, expect.objectContaining({
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            quadratName: 'New Quadrat',
            dimensionX: 0,
            dimensionY: 0,
            area: 0,
            quadratShape: '',
            personnel: []
          })
        }));
        expect(screen.getByText(/insert successful/i)).toBeInTheDocument();
      });
    });

    it('handles quadrat editing and updates', async () => {
      render(<QuadratsPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify({message: "Update successful"}));

      fireEvent.click(screen.getByRole('button', {name: /edit/i}));
      fireEvent.change(screen.getByLabelText(/dimension x/i), {target: {value: '200'}});
      fireEvent.click(screen.getByRole('button', {name: /save/i}));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/quadrats`, expect.objectContaining({
          method: 'PATCH',
          body: expect.any(String)  // Specific body content would be checked here
        }));
        expect(screen.getByText(/update successful/i)).toBeInTheDocument();
      });
    });

    it('deletes a quadrat after confirmation', async () => {
      render(<QuadratsPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify({message: "Delete successful"}));

      fireEvent.click(screen.getByRole('button', {name: /delete/i}));
      // Assume confirmation dialog appears and user confirms
      fireEvent.click(screen.getByRole('button', {name: /confirm delete/i}));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/quadrats`, expect.objectContaining({
          method: 'DELETE'
        }));
        expect(screen.getByText(/delete successful/i)).toBeInTheDocument();
      });
    });

    it('displays an error message on API failure', async () => {
      fetchMock.mockReject(new Error('API call failed'));
      render(<QuadratsPage/>, {wrapper: mockContextProvider});
      fireEvent.click(screen.getByRole('button', {name: /refresh/i}));

      await waitFor(() => {
        expect(screen.getByText(/error fetching data/i)).toBeInTheDocument();
      });
    });

    it('handles personnel assignment through autocomplete', async () => {
      render(<QuadratsPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify([{
        personnelID: 1,
        firstName: 'John',
        lastName: 'Doe',
        role: 'Researcher'
      }]));

      fireEvent.click(screen.getByRole('button', {name: /edit/i}));
      fireEvent.mouseDown(screen.getByRole('textbox', {name: /select personnel/i}));
      await waitFor(() => screen.getByText(/john, doe | researcher/i));
      fireEvent.click(screen.getByText(/john, doe | researcher/i));

      await waitFor(() => {
        expect(screen.getByDisplayValue(/john, doe | researcher/i)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/personnel?schema=testSchema&searchfor=`, expect.anything());
      });
    });

    describe('SpeciesPage Integration Tests', () => {
      it('loads initial species data and displays in grid', async () => {
        fetchMock.mockResponseOnce(JSON.stringify({
          species: [{
            id: 1,
            speciesID: 1,
            speciesName: 'Oak',
            speciesCode: 'OAK01',
            defaultDBHMin: 10,
            defaultDBHMax: 50,
            defaultHOMMin: 15,
            defaultHOMMax: 75,
            idLevel: 'Genus',
            authority: 'Linnaeus',
            fieldFamily: 'Fagaceae',
            description: 'Common oak species',
            referenceID: 100
          }],
          totalCount: 1
        }));

        render(<SpeciesPage/>, {wrapper: mockContextProvider});

        await waitFor(() => {
          expect(screen.getByText('Oak')).toBeInTheDocument();
        });
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/species?schema=testSchema&page=0&pageSize=10`, expect.anything());
      });

      it('allows adding a new species and handles API response', async () => {
        render(<SpeciesPage/>, {wrapper: mockContextProvider});
        fetchMock.mockResponseOnce(JSON.stringify({message: "Insert successful"}));

        fireEvent.click(screen.getByRole('button', {name: /add new row/i}));
        fireEvent.change(screen.getByLabelText(/species name/i), {target: {value: 'New Species'}});
        fireEvent.click(screen.getByRole('button', {name: /save/i}));

        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/species`, expect.objectContaining({
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(expect.any(Object))
          }));
          expect(screen.getByText(/insert successful/i)).toBeInTheDocument();
        });
      });

      it('handles species editing and updates', async () => {
        render(<SpeciesPage/>, {wrapper: mockContextProvider});
        fetchMock.mockResponseOnce(JSON.stringify({message: "Update successful"}));

        fireEvent.click(screen.getByRole('button', {name: /edit/i}));
        fireEvent.change(screen.getByLabelText(/species name/i), {target: {value: 'Updated Species'}});
        fireEvent.click(screen.getByRole('button', {name: /save/i}));

        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/species`, expect.objectContaining({
            method: 'PATCH',
            body: expect.any(String)
          }));
          expect(screen.getByText(/update successful/i)).toBeInTheDocument();
        });
      });

      it('deletes a species after confirmation', async () => {
        render(<SpeciesPage/>, {wrapper: mockContextProvider});
        fetchMock.mockResponseOnce(JSON.stringify({message: "Delete successful"}));

        fireEvent.click(screen.getByRole('button', {name: /delete/i}));
        // Assume confirmation dialog appears and user confirms
        fireEvent.click(screen.getByRole('button', {name: /confirm delete/i}));

        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/species`, expect.objectContaining({
            method: 'DELETE'
          }));
          expect(screen.getByText(/delete successful/i)).toBeInTheDocument();
        });
      });

      it('displays an error message on API failure', async () => {
        fetchMock.mockReject(new Error('API call failed'));
        render(<SpeciesPage/>, {wrapper: mockContextProvider});
        fireEvent.click(screen.getByRole('button', {name: /refresh/i}));

        await waitFor(() => {
          expect(screen.getByText(/error fetching data/i)).toBeInTheDocument();
        });
      });

      it('handles species updates with incomplete data', async () => {
        render(<SpeciesPage/>, {wrapper: mockContextProvider});
        fetchMock.mockResponseOnce(JSON.stringify({message: "Update failed"}), {status: 400});

        fireEvent.click(screen.getByRole('button', {name: /edit/i}));
        fireEvent.change(screen.getByLabelText(/species code/i), {target: {value: ''}});  // Clearing mandatory field
        fireEvent.click(screen.getByRole('button', {name: /save/i}));

        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/species`, expect.objectContaining({
            method: 'PATCH'
          }));
          expect(screen.getByText(/update failed/i)).toBeInTheDocument();
        });
      });
    });
  });
  describe('CensusPage Integration Tests', () => {
    it('loads initial census data and displays in grid', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({
        census: [{
          id: 1,
          censusID: 1,
          plotID: 1,
          plotCensusNumber: 101,
          startDate: new Date().toISOString(),
          endDate: new Date().toISOString(),
          description: 'Annual Census'
        }],
        totalCount: 1
      }));

      render(<CensusPage/>, {wrapper: mockContextProvider});

      await waitFor(() => {
        expect(screen.getByText('Annual Census')).toBeInTheDocument();
      });
      expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/census?schema=testSchema&page=0&pageSize=10`, expect.anything());
    });

    it('allows adding a new census and handles API response', async () => {
      render(<CensusPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify({message: "Insert successful"}));

      fireEvent.click(screen.getByRole('button', {name: /add new row/i}));
      fireEvent.change(screen.getByLabelText(/description/i), {target: {value: 'New Census'}});
      fireEvent.click(screen.getByRole('button', {name: /save/i}));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/census`, expect.objectContaining({
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(expect.any(Object))
        }));
        expect(screen.getByText(/insert successful/i)).toBeInTheDocument();
      });
    });

    it('handles census editing and updates', async () => {
      render(<CensusPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify({message: "Update successful"}));

      fireEvent.click(screen.getByRole('button', {name: /edit/i}));
      fireEvent.change(screen.getByLabelText(/description/i), {target: {value: 'Updated Census'}});
      fireEvent.click(screen.getByRole('button', {name: /save/i}));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/census`, expect.objectContaining({
          method: 'PATCH',
          body: expect.any(String)
        }));
        expect(screen.getByText(/update successful/i)).toBeInTheDocument();
      });
    });

    it('deletes a census after confirmation', async () => {
      render(<CensusPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify({message: "Delete successful"}));

      fireEvent.click(screen.getByRole('button', {name: /delete/i}));
      // Assume confirmation dialog appears and user confirms
      fireEvent.click(screen.getByRole('button', {name: /confirm delete/i}));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(`/api/fixeddata/census`, expect.objectContaining({
          method: 'DELETE'
        }));
        expect(screen.getByText(/delete successful/i)).toBeInTheDocument();
      });
    });

    it('displays an error message on API failure', async () => {
      fetchMock.mockReject(new Error('API call failed'));
      render(<CensusPage/>, {wrapper: mockContextProvider});
      fireEvent.click(screen.getByRole('button', {name: /refresh/i}));

      await waitFor(() => {
        expect(screen.getByText(/error fetching data/i)).toBeInTheDocument();
      });
    });

    it('validates end date before closing a census', async () => {
      render(<CensusPage/>, {wrapper: mockContextProvider});
      fetchMock.mockResponseOnce(JSON.stringify({message: "Update successful"}));

      // Simulate setting an invalid end date earlier than the start date
      fireEvent.click(screen.getByRole('button', {name: /close open census/i}));
      fireEvent.change(screen.getByRole('textbox', {name: /end date/i}), {
        target: {value: new Date(new Date().setDate(new Date().getDate() - 1))}
      });
      fireEvent.click(screen.getByRole('button', {name: /confirm/i}));

      await waitFor(() => {
        expect(screen.getByText(/end date must be after the start date/i)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
          method: 'PATCH'
        }));
      });
    });
  });
});
