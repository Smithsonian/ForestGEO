/**
 * Comprehensive Upload System Test
 * Tests the enhanced CSV processing functionality with real data samples
 */

import React from 'react';
import { mount } from 'cypress/react18';
import UploadFireSQL from '@/components/uploadsystem/segments/uploadfiresql';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FormType } from '@/config/macros/formdetails';

// Mock data samples based on actual CSV files
const cocoliCsvData = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
000001,1,protte,0000,3.00,0.90,171.0,,2.60,1994-11-02
000002,1,coccpa,0000,0.10,0.60,13.0,,1.30,1994-11-02
000003,1,eugepr,0000,1.30,2.30,26.0,M,1.20,1994-11-02
000003,2,eugepr,0000,1.30,2.30,14.0,,1.30,1994-11-02
000004,1,protte,0000,2.20,3.40,10.0,,1.30,1994-11-02
000005,1,clavme,0000,3.50,3.70,14.0,M;L,1.30,1994-11-02
000005,2,clavme,0000,3.50,3.70,12.0,,1.30,1994-11-02
000006,1,protte,0000,4.30,4.70,12.0,,1.20,1994-11-02
000007,1,poutca,0000,3.70,7.00,15.0,M,1.30,1994-11-02
000007,2,poutca,0000,3.70,7.00,14.0,,1.30,1994-11-02`;

const sercCsvData = `quadrat,tag,stemtag,spcode,lx,ly,dbh,hom,date,codes
1011,100001,1,FAGR,202,104.5,3.5,1.30,2010-03-17,LI
1011,100002,1,LIST2,201.60001,101.1,59.6,1.30,2010-03-17,LI
1011,100003,1,CACA18,203.5,102,6,1.30,2010-03-17,LI
1011,100004,1,LITU,204.5,104,105,1.30,2010-03-17,LI
1011,100005,1,NYSY,206,105.5,7.6,1.30,2010-03-17,LI
1011,100006,1,CACA18,206.5,105,3,1.30,2010-03-17,LI
1011,100007,1,CACA18,204.5,105.5,3.9,1.30,2010-03-17,LI
1011,100008,1,FAGR,206.39999,101.3,3.6,1.30,2010-03-17,LI
1011,100009,1,FAGR,202.5,104.5,4.8,1.30,2010-03-17,LI
121,10001,1,FRPE,14.1,5.2,12.5,1.30,2009-10-15,LI`;

// Test data with various date formats to test our enhanced parsing
const mixedDateFormatData = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
001,1,TEST,0001,1.0,1.0,10.0,,1.3,1994-11-02
002,1,TEST,0001,2.0,2.0,11.0,,1.3,11/02/1994
003,1,TEST,0001,3.0,3.0,12.0,,1.3,02/11/1994
004,1,TEST,0001,4.0,4.0,13.0,,1.3,November 2, 1994
005,1,TEST,0001,5.0,5.0,14.0,,1.3,Nov 2, 1994
006,1,TEST,0001,6.0,6.0,15.0,,1.3,1994-11-02 14:30:00
007,1,TEST,0001,7.0,7.0,16.0,,1.3,2 Nov 1994`;

// Test data with coordinate precision issues
const precisionTestData = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
001,1,TEST,0001,1.0000001,2.9999999,10.123456789,,1.3,1994-11-02
002,1,TEST,0001,3.000000123,4.000000789,11.987654321,,1.3,1994-11-02
003,1,TEST,0001,5.123456789,6.987654321,12.555555555,,1.3,1994-11-02`;

// Helper function to create mock File objects
function createMockFile(content: string, filename: string): File {
  const blob = new Blob([content], { type: 'text/csv' });
  return new File([blob], filename, { type: 'text/csv' });
}

// Mock contexts and dependencies
const mockPlotContext = {
  plotID: 1,
  plotName: 'Test Plot',
  usesSubquadrats: false
};

const mockCensusContext = {
  dateRanges: [{ censusID: 1, startDate: '2020-01-01', endDate: '2020-12-31' }]
};

const mockSession = {
  user: { name: 'Test User' }
};

// Mock API responses
const setupApiMocks = () => {
  // Mock user lookup
  cy.intercept('GET', '/api/catalog/Test/User', { fixture: 'test-user.json' }).as('getUserID');

  // Mock bulk processor setup
  cy.intercept('GET', '/api/setupbulkprocessor/*', {
    statusCode: 200,
    body: { message: 'Processor setup successful' }
  }).as('setupProcessor');

  // Mock SQL packet load (chunk upload)
  cy.intercept('POST', '/api/sqlpacketload', {
    statusCode: 200,
    body: {
      responseMessage: 'Bulk insert to SQL completed',
      insertedCount: 10,
      batchID: 'test-batch-123'
    }
  }).as('uploadChunk');

  // Mock bulk procedure execution
  cy.intercept('GET', '/api/setupbulkprocedure/*', {
    statusCode: 200,
    body: {
      attemptsNeeded: 1,
      batchFailedButHandled: false
    }
  }).as('processBatch');

  // Mock bulk collapser
  cy.intercept('GET', '/api/setupbulkcollapser/*', {
    statusCode: 200,
    body: { message: 'Collapser completed successfully' }
  }).as('collapser');
};

describe('Enhanced Upload System Tests', () => {
  beforeEach(() => {
    setupApiMocks();

    // Mock React contexts
    cy.window().then(win => {
      win.React = React;
    });
  });

  it('should handle cocoli1b.csv format (original failing file)', () => {
    const mockFile = createMockFile(cocoliCsvData, 'cocoli1b.csv');

    // Create enhanced console spy to capture our logging
    let headerMappingLogs: string[] = [];
    let dateParsingLogs: string[] = [];
    let processingLogs: string[] = [];

    cy.window().then(win => {
      const originalLog = win.console.log;
      const originalInfo = win.console.info;

      win.console.log = (...args) => {
        const message = args.join(' ');
        if (message.includes('Header mapping:')) {
          headerMappingLogs.push(message);
        }
        if (message.includes('Date') && message.includes('parsed')) {
          dateParsingLogs.push(message);
        }
        if (message.includes('Enhanced CSV processing completed')) {
          processingLogs.push(message);
        }
        originalLog.apply(win.console, args);
      };

      win.console.info = (...args) => {
        const message = args.join(' ');
        if (message.includes('Header mapping:')) {
          headerMappingLogs.push(message);
        }
        if (message.includes('Enhanced CSV processing')) {
          processingLogs.push(message);
        }
        originalInfo.apply(win.console, args);
      };
    });

    mount(
      <div data-testid="upload-container">
        <UploadFireSQL
          personnelRecording={false}
          acceptedFiles={[mockFile as any]}
          uploadForm={FormType.measurements}
          setIsDataUnsaved={() => {}}
          schema="test_schema"
          setUploadError={() => {}}
          setReviewState={() => {}}
          setAllRowToCMID={() => {}}
          selectedDelimiters={{ 'cocoli1b.csv': ',' }}
        />
      </div>
    );

    // Test should complete processing
    cy.get('[data-testid="upload-container"]').should('exist');

    // Verify API calls were made correctly
    cy.wait('@getUserID');
    cy.wait('@setupProcessor');

    // Allow processing to complete
    cy.wait(5000);

    // Verify header mapping worked
    cy.then(() => {
      expect(headerMappingLogs.length).to.be.greaterThan(0);
      expect(headerMappingLogs.some(log => log.includes('"tag" -> "tag"') || log.includes('"spcode" -> "spcode"') || log.includes('"quadrat" -> "quadrat"'))).to
        .be.true;
    });

    // Verify date parsing worked
    cy.then(() => {
      expect(dateParsingLogs.some(log => log.includes('1994-11-02') && log.includes('YYYY-MM-DD'))).to.be.true;
    });
  });

  it('should handle SERC_census1_2025.csv format (original working file)', () => {
    const mockFile = createMockFile(sercCsvData, 'SERC_census1_2025.csv');

    let headerMappingLogs: string[] = [];
    let coordinateLogs: string[] = [];

    cy.window().then(win => {
      const originalInfo = win.console.info;

      win.console.info = (...args) => {
        const message = args.join(' ');
        if (message.includes('Header mapping:')) {
          headerMappingLogs.push(message);
        }
        if (message.includes('Coordinate') && message.includes('rounded')) {
          coordinateLogs.push(message);
        }
        originalInfo.apply(win.console, args);
      };
    });

    mount(
      <div data-testid="upload-container">
        <UploadFireSQL
          personnelRecording={false}
          acceptedFiles={[mockFile as any]}
          uploadForm={FormType.measurements}
          setIsDataUnsaved={() => {}}
          schema="test_schema"
          setUploadError={() => {}}
          setReviewState={() => {}}
          setAllRowToCMID={() => {}}
          selectedDelimiters={{ 'SERC_census1_2025.csv': ',' }}
        />
      </div>
    );

    cy.get('[data-testid="upload-container"]').should('exist');

    // Verify API calls
    cy.wait('@getUserID');
    cy.wait('@setupProcessor');

    cy.wait(5000);

    // Verify different column order is handled correctly
    cy.then(() => {
      expect(headerMappingLogs.some(log => log.includes('"quadrat" -> "quadrat"') || log.includes('"tag" -> "tag"'))).to.be.true;
    });

    // Verify coordinate precision handling
    cy.then(() => {
      expect(coordinateLogs.some(log => log.includes('201.60001') || log.includes('206.39999'))).to.be.true;
    });
  });

  it('should handle multiple date formats correctly', () => {
    const mockFile = createMockFile(mixedDateFormatData, 'mixed-dates.csv');

    let dateParsingLogs: string[] = [];

    cy.window().then(win => {
      const originalInfo = win.console.info;

      win.console.info = (...args) => {
        const message = args.join(' ');
        if (message.includes('Date') && message.includes('parsed')) {
          dateParsingLogs.push(message);
        }
        originalInfo.apply(win.console, args);
      };
    });

    mount(
      <div data-testid="upload-container">
        <UploadFireSQL
          personnelRecording={false}
          acceptedFiles={[mockFile as any]}
          uploadForm={FormType.measurements}
          setIsDataUnsaved={() => {}}
          schema="test_schema"
          setUploadError={() => {}}
          setReviewState={() => {}}
          setAllRowToCMID={() => {}}
          selectedDelimiters={{ 'mixed-dates.csv': ',' }}
        />
      </div>
    );

    cy.get('[data-testid="upload-container"]').should('exist');

    cy.wait(5000);

    // Verify multiple date formats were parsed
    cy.then(() => {
      expect(dateParsingLogs.some(log => log.includes('YYYY-MM-DD'))).to.be.true;
      expect(dateParsingLogs.some(log => log.includes('MM/DD/YYYY'))).to.be.true;
      expect(dateParsingLogs.some(log => log.includes('DD/MM/YYYY'))).to.be.true;
      expect(dateParsingLogs.some(log => log.includes('MMMM DD, YYYY'))).to.be.true;
    });
  });

  it('should handle coordinate precision correctly', () => {
    const mockFile = createMockFile(precisionTestData, 'precision-test.csv');

    let coordinateLogs: string[] = [];

    cy.window().then(win => {
      const originalInfo = win.console.info;

      win.console.info = (...args) => {
        const message = args.join(' ');
        if (message.includes('Coordinate') && message.includes('rounded')) {
          coordinateLogs.push(message);
        }
        originalInfo.apply(win.console, args);
      };
    });

    mount(
      <div data-testid="upload-container">
        <UploadFireSQL
          personnelRecording={false}
          acceptedFiles={[mockFile as any]}
          uploadForm={FormType.measurements}
          setIsDataUnsaved={() => {}}
          schema="test_schema"
          setUploadError={() => {}}
          setReviewState={() => {}}
          setAllRowToCMID={() => {}}
          selectedDelimiters={{ 'precision-test.csv': ',' }}
        />
      </div>
    );

    cy.get('[data-testid="upload-container"]').should('exist');

    cy.wait(5000);

    // Verify coordinate precision was handled
    cy.then(() => {
      expect(coordinateLogs.some(log => log.includes('1.0000001') && log.includes('1.000000'))).to.be.true;
      expect(coordinateLogs.some(log => log.includes('2.9999999') && log.includes('3.000000'))).to.be.true;
    });
  });

  it('should provide comprehensive processing summary', () => {
    const mockFile = createMockFile(cocoliCsvData, 'cocoli1b.csv');

    let summaryLogs: string[] = [];

    cy.window().then(win => {
      const originalInfo = win.console.info;

      win.console.info = (...args) => {
        const message = args.join(' ');
        if (
          message.includes('Enhanced CSV processing completed') ||
          message.includes('Total rows processed') ||
          message.includes('Header mapping: Enhanced') ||
          message.includes('Date format support: Multi-format') ||
          message.includes('Coordinate precision: Auto-normalized')
        ) {
          summaryLogs.push(message);
        }
        originalInfo.apply(win.console, args);
      };
    });

    mount(
      <div data-testid="upload-container">
        <UploadFireSQL
          personnelRecording={false}
          acceptedFiles={[mockFile as any]}
          uploadForm={FormType.measurements}
          setIsDataUnsaved={() => {}}
          schema="test_schema"
          setUploadError={() => {}}
          setReviewState={() => {}}
          setAllRowToCMID={() => {}}
          selectedDelimiters={{ 'cocoli1b.csv': ',' }}
        />
      </div>
    );

    cy.get('[data-testid="upload-container"]').should('exist');

    cy.wait(8000); // Wait longer for processing to complete

    // Verify comprehensive summary was logged
    cy.then(() => {
      expect(summaryLogs.some(log => log.includes('Enhanced CSV processing completed'))).to.be.true;
      expect(summaryLogs.some(log => log.includes('Total rows processed'))).to.be.true;
      expect(summaryLogs.some(log => log.includes('Header mapping: Enhanced (order-independent)'))).to.be.true;
      expect(summaryLogs.some(log => log.includes('Date format support: Multi-format enabled'))).to.be.true;
      expect(summaryLogs.some(log => log.includes('Coordinate precision: Auto-normalized'))).to.be.true;
    });
  });

  it('should handle API calls with enhanced data correctly', () => {
    const mockFile = createMockFile(cocoliCsvData, 'cocoli1b.csv');

    // Capture API call data
    let uploadPayloads: any[] = [];

    cy.intercept('POST', '/api/sqlpacketload', req => {
      uploadPayloads.push(req.body);
      req.reply({
        statusCode: 200,
        body: {
          responseMessage: 'Bulk insert to SQL completed',
          insertedCount: 10,
          batchID: 'test-batch-123'
        }
      });
    }).as('captureUpload');

    mount(
      <div data-testid="upload-container">
        <UploadFireSQL
          personnelRecording={false}
          acceptedFiles={[mockFile as any]}
          uploadForm={FormType.measurements}
          setIsDataUnsaved={() => {}}
          schema="test_schema"
          setUploadError={() => {}}
          setReviewState={() => {}}
          setAllRowToCMID={() => {}}
          selectedDelimiters={{ 'cocoli1b.csv': ',' }}
        />
      </div>
    );

    cy.wait('@captureUpload');

    // Verify the uploaded data structure is correct
    cy.then(() => {
      expect(uploadPayloads.length).to.be.greaterThan(0);
      const payload = uploadPayloads[0];

      expect(payload.schema).to.equal('test_schema');
      expect(payload.formType).to.equal('measurements');
      expect(payload.fileName).to.equal('cocoli1b.csv');

      // Verify fileRowSet contains properly mapped data
      const fileRowSet = payload.fileRowSet;
      const rowKeys = Object.keys(fileRowSet);
      expect(rowKeys.length).to.be.greaterThan(0);

      const firstRow = fileRowSet[rowKeys[0]];
      expect(firstRow).to.have.property('tag');
      expect(firstRow).to.have.property('spcode');
      expect(firstRow).to.have.property('quadrat');
      expect(firstRow).to.have.property('lx');
      expect(firstRow).to.have.property('ly');
      expect(firstRow).to.have.property('date');

      // Verify data values are correctly transformed
      expect(firstRow.tag).to.equal('000001');
      expect(firstRow.spcode).to.equal('protte');
      expect(firstRow.quadrat).to.equal('0000');
      expect(firstRow.lx).to.equal(3.0);
      expect(firstRow.ly).to.equal(0.9);
    });
  });
});
