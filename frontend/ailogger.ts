// ailogger.ts
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { getAppInsights } from './applicationinsights';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface LogContext {
  [key: string]: any;
}

const levelToSeverityCode: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.WARN]: 3,
  [LogLevel.ERROR]: 4,
  [LogLevel.CRITICAL]: 5
};

/**
 * Core logger that emits to Application Insights and also falls back to console
 */
class Logger {
  private readonly ai: ApplicationInsights | null = null;

  constructor() {
    this.ai = getAppInsights();
  }

  debug(message: string, context?: LogContext) {
    this.trackTrace(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext) {
    this.trackTrace(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext) {
    this.trackTrace(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: LogContext) {
    const mergedContext = { ...context, stack: error?.stack, name: error?.name };
    if (this.ai) {
      this.ai.trackException(
        {
          exception: error ?? new Error(message),
          severityLevel: levelToSeverityCode[LogLevel.ERROR]
        },
        this.normalizeProps(mergedContext)
      );
    }
    this.trackTrace(LogLevel.ERROR, message, mergedContext);
  }

  critical(message: string, error?: Error, context?: LogContext) {
    const mergedContext = { ...context, stack: error?.stack, name: error?.name };
    if (this.ai) {
      this.ai.trackException(
        {
          exception: error ?? new Error(message),
          severityLevel: levelToSeverityCode[LogLevel.CRITICAL]
        },
        this.normalizeProps(mergedContext)
      );
    }
    this.trackTrace(LogLevel.CRITICAL, message, mergedContext);
  }

  event(name: string, properties?: LogContext) {
    if (this.ai) {
      this.ai.trackEvent({ name }, this.normalizeProps(properties));
    }
    console.log(`[EVENT] ${name}`, this.normalizeProps(properties));
  }

  metric(name: string, value: number, properties?: LogContext) {
    if (this.ai) {
      this.ai.trackMetric({ name, average: value }, this.normalizeProps(properties));
    }
    console.log(`[METRIC] ${name}=${value}`, this.normalizeProps(properties));
  }

  private normalizeProps(props?: LogContext) {
    return {
      ...props,
      timestamp: new Date().toISOString(),
      logger: 'client' // you can customize per environment
    };
  }

  private trackTrace(level: LogLevel, message: string, context?: LogContext) {
    const normalized = this.normalizeProps(context);
    if (this.ai) {
      this.ai.trackTrace(
        {
          message,
          severityLevel: levelToSeverityCode[level]
        },
        normalized
      );
    }

    // Fallback to console (respecting level)
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`[DEBUG] ${message}`, normalized);
        break;
      case LogLevel.INFO:
        console.info(`[INFO] ${message}`, normalized);
        break;
      case LogLevel.WARN:
        console.warn(`[WARN] ${message}`, normalized);
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(`[${level.toUpperCase()}] ${message}`, normalized);
        break;
    }
  }
}

const ailogger = new Logger();
export default ailogger;
