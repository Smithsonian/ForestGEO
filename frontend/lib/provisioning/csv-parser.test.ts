import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseQuadratCsv } from './csv-parser';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/provisioning');

describe('parseQuadratCsv', () => {
  it('parses a valid grid CSV', () => {
    const content = readFileSync(path.join(FIXTURES, 'quadrats-valid-grid.csv'), 'utf-8');
    const { rows, errors } = parseQuadratCsv(content);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(25); // 5x5 grid of 20x20 in 100x100 plot
    expect(rows[0]).toEqual({ quadratName: 'Q0001', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 });
    expect(rows[24]).toEqual({ quadratName: 'Q0025', startX: 80, startY: 80, dimensionX: 20, dimensionY: 20 });
  });

  it('returns all rows in row-major order for valid grid', () => {
    const content = readFileSync(path.join(FIXTURES, 'quadrats-valid-grid.csv'), 'utf-8');
    const { rows } = parseQuadratCsv(content);
    // Row 0: y=0, x increases 0,20,40,60,80
    expect(rows[0].startY).toBe(0);
    expect(rows[4].startX).toBe(80);
    // Row 1: y=20
    expect(rows[5].startY).toBe(20);
    expect(rows[5].startX).toBe(0);
  });

  it('parses overlapping rows without flagging them (parser does not check overlap; that is the caller responsibility)', () => {
    const content = readFileSync(path.join(FIXTURES, 'quadrats-overlapping.csv'), 'utf-8');
    const { rows, errors } = parseQuadratCsv(content);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ quadratName: 'A', startX: 0, startY: 0, dimensionX: 30, dimensionY: 30 });
    expect(rows[1]).toEqual({ quadratName: 'B', startX: 20, startY: 20, dimensionX: 30, dimensionY: 30 });
  });

  it('parses out-of-bounds rows without flagging them (caller handles bounds checking)', () => {
    const content = readFileSync(path.join(FIXTURES, 'quadrats-out-of-bounds.csv'), 'utf-8');
    const { rows, errors } = parseQuadratCsv(content);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ quadratName: 'A', startX: 90, startY: 0, dimensionX: 20, dimensionY: 20 });
  });

  it('rejects CSV with fewer than 2 lines as empty', () => {
    const { rows, errors } = parseQuadratCsv('quadratname,startx,starty,dimensionx,dimensiony');
    expect(rows).toEqual([]);
    expect(errors[0].rowNumber).toBe(1);
    expect(errors[0].message).toMatch(/empty or missing data rows/);
  });

  it('rejects an entirely blank CSV', () => {
    const { rows, errors } = parseQuadratCsv('');
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/empty or missing data rows/);
  });

  it('parses a quoted comma in the quadrat name', () => {
    const csv = `quadratname,startx,starty,dimensionx,dimensiony\n"NW, A1",0,0,20,20`;
    const result = parseQuadratCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].quadratName).toBe('NW, A1');
  });

  it('strips a UTF-8 BOM from the header line', () => {
    const csv = `﻿quadratname,startx,starty,dimensionx,dimensiony\nQ001,0,0,20,20`;
    const result = parseQuadratCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].quadratName).toBe('Q001');
  });

  it('reports row 1 for missing header on empty input', () => {
    const result = parseQuadratCsv('');
    expect(result.errors[0].rowNumber).toBe(1);
  });

  it('handles CRLF line endings', () => {
    const csv = 'quadratname,startx,starty,dimensionx,dimensiony\r\nA,0,0,20,20\r\nB,20,0,20,20\r\n';
    const { rows, errors } = parseQuadratCsv(csv);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(2);
    expect(rows[0].quadratName).toBe('A');
    expect(rows[1].quadratName).toBe('B');
  });

  it('skips blank lines without shifting reported row numbers for valid rows', () => {
    const csv = ['quadratname,startx,starty,dimensionx,dimensiony', 'A,0,0,20,20', '', 'B,20,0,20,20'].join('\n');
    const { rows, errors } = parseQuadratCsv(csv);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(2);
    expect(rows[0].quadratName).toBe('A');
    expect(rows[1].quadratName).toBe('B');
  });

  it('rejects a CSV missing the dimensionx column', () => {
    const content = 'quadratname,startx,starty,dimensiony\nA,0,0,20';
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows).toEqual([]);
    expect(errors[0].rowNumber).toBe(1);
    expect(errors[0].message).toMatch(/Missing required column: dimensionx/);
  });

  it('rejects a CSV missing the startx column', () => {
    const content = 'quadratname,starty,dimensionx,dimensiony\nA,0,20,20';
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/Missing required column: startx/);
  });

  it('reports non-numeric startx with exact row number', () => {
    const content = 'quadratname,startx,starty,dimensionx,dimensiony\nA,abc,0,20,20';
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ rowNumber: 2, message: 'Non-numeric value in coordinate or dimension field' }]);
  });

  it('reports non-numeric dimensionY with exact row number', () => {
    const content = 'quadratname,startx,starty,dimensionx,dimensiony\nA,0,0,20,bad';
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ rowNumber: 2, message: 'Non-numeric value in coordinate or dimension field' }]);
  });

  it('reports missing quadratName on the correct row', () => {
    const content = 'quadratname,startx,starty,dimensionx,dimensiony\n,0,0,20,20';
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows).toEqual([]);
    expect(errors[0].rowNumber).toBe(2);
    expect(errors[0].message).toMatch(/Missing quadratName/);
  });

  it('reports zero dimension as invalid', () => {
    const content = 'quadratname,startx,starty,dimensionx,dimensiony\nA,0,0,0,20';
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/Dimension must be positive/);
  });

  it('reports negative dimension as invalid', () => {
    const content = 'quadratname,startx,starty,dimensionx,dimensiony\nA,0,0,20,-5';
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/Dimension must be positive/);
  });

  it('collects errors from multiple bad rows, continuing past each one', () => {
    const content = [
      'quadratname,startx,starty,dimensionx,dimensiony',
      'A,0,0,20,20', // row 2 — valid
      ',0,0,20,20', // row 3 — missing name
      'C,bad,0,20,20', // row 4 — non-numeric
      'D,0,0,20,20' // row 5 — valid
    ].join('\n');
    const { rows, errors } = parseQuadratCsv(content);
    expect(rows.length).toBe(2);
    expect(errors.length).toBe(2);
    expect(errors[0].rowNumber).toBe(3);
    expect(errors[1].rowNumber).toBe(4);
  });

  it('is case-insensitive for header names', () => {
    const content = 'QuadratName,StartX,StartY,DimensionX,DimensionY\nA,0,0,20,20';
    const { rows, errors } = parseQuadratCsv(content);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(1);
    expect(rows[0].quadratName).toBe('A');
  });

  it('trims whitespace from cells', () => {
    const content = 'quadratname,startx,starty,dimensionx,dimensiony\n A , 10 , 20 , 30 , 40 ';
    const { rows, errors } = parseQuadratCsv(content);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ quadratName: 'A', startX: 10, startY: 20, dimensionX: 30, dimensionY: 40 });
  });
});
