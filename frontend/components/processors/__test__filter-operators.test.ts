import { describe, expect, it } from 'vitest';

function buildCondition(column: string, operator: string, value: string | number): string {
  switch (operator) {
    case '>':
    case '>=':
    case '<':
    case '<=':
      return `${column} ${operator} ${value}`;
    case 'startsWith':
      return `${column} LIKE '${value}%'`;
    case 'endsWith':
      return `${column} LIKE '%${value}'`;
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

describe('filter operator SQL generation', () => {
  it('uses comparison operators instead of equality for numeric filters', () => {
    expect(buildCondition('DBH', '>', 10)).toBe('DBH > 10');
    expect(buildCondition('DBH', '>=', 10)).toBe('DBH >= 10');
    expect(buildCondition('HOM', '<', 1.5)).toBe('HOM < 1.5');
    expect(buildCondition('HOM', '<=', 1.5)).toBe('HOM <= 1.5');
  });

  it('places LIKE wildcards on the correct side for string filters', () => {
    expect(buildCondition('SpeciesCode', 'startsWith', 'ACE')).toBe("SpeciesCode LIKE 'ACE%'");
    expect(buildCondition('SpeciesCode', 'endsWith', 'RUB')).toBe("SpeciesCode LIKE '%RUB'");
  });
});
