/// <reference types="cypress" />

import { buildUploadedFile, mockUploadedFilesApi } from '../support/uploaded-files-helpers';

function openUploadedFiles() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('Uploaded Files');
  cy.contains('Uploaded CSV Files').should('be.visible');
}

describe('Upload File Management', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
  });

  it('loads the current uploaded-files table for the active census scope', () => {
    mockUploadedFilesApi({
      files: [
        buildUploadedFile({ name: 'measurements-2024-06-15.csv', user: 'Field Crew', formType: 'measurements' }),
        buildUploadedFile({ name: 'species-update-2024-06-16.csv', user: 'Lead Tech', formType: 'species' }),
        buildUploadedFile({ name: 'arcgis-review.xlsx', user: 'GIS Analyst', formType: 'arcgis_xlsx' })
      ]
    });

    openUploadedFiles();

    cy.wait('@fetchUploadedFiles').then(interception => {
      const url = new URL(interception.request.url);
      expect(url.searchParams.get('plotID')).to.equal('1');
      expect(url.searchParams.get('plotName')).to.equal('Luquillo Main Plot');
      expect(url.searchParams.get('census')).to.equal('5');
    });

    cy.contains('Accessing Container: plot1-census5').should('be.visible');
    cy.contains('File Count').should('be.visible');
    cy.contains('File Name').should('be.visible');
    cy.contains('measurements-2024-06-15.csv').should('be.visible');
    cy.contains('species-update-2024-06-16.csv').should('be.visible');
    cy.contains('arcgis-review.xlsx').should('be.visible');
  });

  it('refreshes the file list without losing the active page context', () => {
    const state = mockUploadedFilesApi({
      files: [buildUploadedFile({ name: 'measurements-2024-06-15.csv' })]
    });

    openUploadedFiles();
    cy.wait('@fetchUploadedFiles');
    cy.contains('measurements-2024-06-15.csv').should('be.visible');

    cy.then(() => {
      state.files = [...state.files, buildUploadedFile({ name: 'measurements-2024-06-16.csv', user: 'Second Crew' })];
    });

    cy.contains('button', 'Refresh Files').click();
    cy.wait('@fetchUploadedFiles');

    cy.contains('measurements-2024-06-16.csv').should('be.visible');
    cy.url().should('include', '/measurementshub/uploadedfiles');
  });

  it('downloads a file using the current id-based container name and legacy fallback', () => {
    mockUploadedFilesApi({
      files: [buildUploadedFile({ name: 'measurements-2024-06-15.csv' })],
      downloadUrlBuilder: () => '/measurementshub/uploadedfiles#download-complete'
    });

    openUploadedFiles();
    cy.wait('@fetchUploadedFiles');

    cy.contains('tr', 'measurements-2024-06-15.csv').within(() => {
      cy.get('button').eq(0).click({ force: true });
    });

    cy.wait('@downloadUploadedFile').then(interception => {
      const url = new URL(interception.request.url);
      expect(url.searchParams.get('schema')).to.equal('luquillo');
      expect(url.searchParams.get('plotID')).to.equal('1');
      expect(url.searchParams.get('plotName')).to.equal('Luquillo Main Plot');
      expect(url.searchParams.get('census')).to.equal('5');
      expect(url.searchParams.get('filename')).to.equal('measurements-2024-06-15.csv');
      expect(url.searchParams.get('container')).to.equal(null);
      expect(url.searchParams.get('legacyContainer')).to.equal(null);
    });

    cy.url().should('include', '#download-complete');
  });

  it('deletes a file and re-renders the updated file list', () => {
    mockUploadedFilesApi({
      files: [buildUploadedFile({ name: 'measurements-2024-06-15.csv' }), buildUploadedFile({ name: 'species-update-2024-06-16.csv' })]
    });

    openUploadedFiles();
    cy.wait('@fetchUploadedFiles');

    cy.contains('tr', 'measurements-2024-06-15.csv').within(() => {
      cy.get('button').eq(1).click({ force: true });
    });

    cy.wait('@deleteUploadedFile').then(interception => {
      const url = new URL(interception.request.url);
      expect(url.searchParams.get('schema')).to.equal('luquillo');
      expect(url.searchParams.get('plotID')).to.equal('1');
      expect(url.searchParams.get('plotName')).to.equal('Luquillo Main Plot');
      expect(url.searchParams.get('census')).to.equal('5');
      expect(url.searchParams.get('filename')).to.equal('measurements-2024-06-15.csv');
      expect(url.searchParams.get('container')).to.equal(null);
      expect(url.searchParams.get('legacyContainer')).to.equal(null);
    });
    cy.wait('@fetchUploadedFiles');

    cy.contains('measurements-2024-06-15.csv').should('not.exist');
    cy.contains('species-update-2024-06-16.csv').should('be.visible');
  });

  it('shows the empty-state row when no uploaded files are available', () => {
    mockUploadedFilesApi({
      files: []
    });

    openUploadedFiles();
    cy.wait('@fetchUploadedFiles');

    cy.contains('No data available').should('be.visible');
  });
});
