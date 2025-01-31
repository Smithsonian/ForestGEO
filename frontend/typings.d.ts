import 'moment';

declare module 'moment' {
  interface Duration {
    format: (template?: string, precision?: number, settings?: any) => string;
  }
}
