class DynamicQueryBuilder {
  private schema: string;
  private selectClause: string = 'SELECT SQL_CALC_FOUND_ROWS *';
  private fromClause: string = '';
  private whereConditions: string[] = [];
  private joins: string[] = [];
  private limit: string = '';
  private groupBy: string = '';
  private customSelects: string[] = [];

  constructor(schema: string) {
      this.schema = schema;
  }

  select(columns: string): this {
      this.selectClause = `SELECT SQL_CALC_FOUND_ROWS ${columns}`;
      return this;
  }

  from(table: string, alias?: string): this {
      this.fromClause = `FROM ${this.schema}.${table}` + (alias ? ` ${alias}` : '');
      return this;
  }

  where(condition: string, value?: string | number): this {
      if (value !== undefined) {
          this.whereConditions.push(`${condition} = ${value}`);
      }
      return this;
  }

  join(table: string, on: string, type: string = 'LEFT JOIN'): this {
      this.joins.push(`${type} ${this.schema}.${table} ON ${on}`);
      return this;
  }

  limitRows(offset: number, rowCount: number): this {
      this.limit = `LIMIT ${offset}, ${rowCount}`;
      return this;
  }

  groupByField(field: string): this {
      this.groupBy = `GROUP BY ${field}`;
      return this;
  }

  addCustomSelect(selectStatement: string): this {
      this.customSelects.push(selectStatement);
      return this;
  }

  build(): string {
      let query = `${this.selectClause}, ${this.customSelects.join(', ')} ${this.fromClause}`;
      if (this.joins.length > 0) {
          query += ' ' + this.joins.join(' ');
      }
      if (this.whereConditions.length > 0) {
          query += ' WHERE ' + this.whereConditions.join(' AND ');
      }
      if (this.groupBy) {
          query += ` GROUP BY ${this.groupBy}`;
      }
      query += ' ' + this.limit;
      return query;
  }
}

export default DynamicQueryBuilder;