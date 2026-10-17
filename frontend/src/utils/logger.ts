/**
 * Centralized logging utility for Aspiro frontend
 *
 * Environment Variables:
 * - NEXT_PUBLIC_DEBUG_LOGS=true|false - Enable/disable debug logs (default: false in production)
 * - NEXT_PUBLIC_COMPACT_LOGS=true|false - Use compact format (default: true)
 * - NEXT_PUBLIC_LOG_MODULES=auth,api,demo,session - Comma-separated list of modules to log
 *
 * Runtime Controls:
 * - window.toggleLogs(enabled) - Enable/disable all logs
 * - window.setLogModules(['auth', 'api']) - Set which modules to log
 */

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
  context?: string;
}

type LogModule = 'auth' | 'api' | 'demo' | 'session' | 'sync' | 'cache';

interface LogConfig {
  enabled: boolean;
  compact: boolean;
  modules: Set<LogModule>;
}

class Logger {
  private isDevelopment: boolean;
  private logLevel: LogLevel;
  private config: LogConfig;
  private runtimeEnabled: boolean | null = null;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.logLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;
    this.config = this.initConfig();

    // Expose runtime controls
    if (typeof window !== 'undefined') {
      (window as Window & { toggleLogs?: unknown; setLogModules?: unknown }).toggleLogs = this.toggleLogs.bind(this);
      (window as Window & { toggleLogs?: unknown; setLogModules?: unknown }).setLogModules = this.setLogModules.bind(this);
    }
  }

  private initConfig(): LogConfig {
    // In production, logs are disabled by default unless explicitly enabled
    const debugEnabled = process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true' ||
      (this.isDevelopment && process.env.NEXT_PUBLIC_DEBUG_LOGS !== 'false');
    const compactMode = process.env.NEXT_PUBLIC_COMPACT_LOGS !== 'false'; // Compact by default
    const modulesList = process.env.NEXT_PUBLIC_LOG_MODULES?.split(',').map(m => m.trim() as LogModule) ||
      ['auth', 'api', 'demo', 'session', 'sync', 'cache'] as LogModule[];

    return {
      enabled: debugEnabled,
      compact: compactMode,
      modules: new Set(modulesList)
    };
  }

  private isEnabled(): boolean {
    if (this.runtimeEnabled !== null) return this.runtimeEnabled;
    return this.config.enabled;
  }

  private shouldLogModule(module?: LogModule): boolean {
    if (!module) return true;
    return this.config.modules.has(module);
  }

  private compactifyData(data: unknown): unknown {
    if (!this.config.compact) return data;

    if (Array.isArray(data)) {
      return data.length > 5 ? { count: data.length, sample: data.slice(0, 2) } : data;
    }

    if (typeof data === 'object' && data !== null) {
      const dataObj = data as Record<string, unknown>;
      const keys = Object.keys(dataObj);
      if (keys.length > 4) {
        const compacted: Record<string, unknown> = {};
        keys.slice(0, 3).forEach(k => compacted[k] = dataObj[k]);
        compacted['...'] = `+${keys.length - 3} more`;
        return compacted;
      }
    }

    return data;
  }

  private getEmoji(context?: string): string {
    if (!context) return '📝';

    const emojiMap: Record<string, string> = {
      auth: '🔐',
      api: '🌐',
      demo: '🎮',
      session: '👤',
      sync: '🔄',
      cache: '💾',
      perf: '⚡',
      user: '👆',
    };

    return emojiMap[context.toLowerCase()] || '📝';
  }

  // Runtime controls
  public toggleLogs(enabled: boolean): void {
    this.runtimeEnabled = enabled;
    console.log(`🔧 Debug logs ${enabled ? 'enabled' : 'disabled'}`);
  }

  public setLogModules(modules: LogModule[]): void {
    this.config.modules = new Set(modules);
    console.log(`🔧 Log modules set to:`, Array.from(this.config.modules));
  }

  private formatMessage(level: LogLevel, message: string, context?: string): string {
    if (this.config.compact) {
      const emoji = this.getEmoji(context);
      const contextStr = context ? `${context}` : '';
      return `${emoji} ${contextStr}: ${message}`;
    }

    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level].padEnd(5);
    const contextStr = context ? `[${context}] ` : '';
    return `${timestamp} ${levelStr} ${contextStr}${message}`;
  }

  private shouldLog(level: LogLevel, module?: LogModule): boolean {
    if (!this.isEnabled()) return false;
    if (!this.shouldLogModule(module)) return false;
    return level >= this.logLevel;
  }

  private createLogEntry(level: LogLevel, message: string, data?: unknown, context?: string): LogEntry {
    return {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
      context,
    };
  }

  debug(message: string, data?: unknown, context?: string): void {
    const logModule = context?.toLowerCase() as LogModule | undefined;
    if (!this.shouldLog(LogLevel.DEBUG, logModule)) return;

    const formattedMessage = this.formatMessage(LogLevel.DEBUG, message, context);
    const compactData = data ? this.compactifyData(data) : undefined;

    if (compactData !== undefined) {
      console.debug(formattedMessage, compactData);
    } else {
      console.debug(formattedMessage);
    }
  }

  info(message: string, data?: unknown, context?: string): void {
    const logModule = context?.toLowerCase() as LogModule | undefined;
    if (!this.shouldLog(LogLevel.INFO, logModule)) return;

    const formattedMessage = this.formatMessage(LogLevel.INFO, message, context);
    const compactData = data ? this.compactifyData(data) : undefined;

    if (compactData !== undefined) {
      console.info(formattedMessage, compactData);
    } else {
      console.info(formattedMessage);
    }
  }

  warn(message: string, data?: unknown, context?: string): void {
    const logModule = context?.toLowerCase() as LogModule | undefined;
    if (!this.shouldLog(LogLevel.WARN, logModule)) return;

    const formattedMessage = this.formatMessage(LogLevel.WARN, message, context);
    const compactData = data ? this.compactifyData(data) : undefined;

    if (compactData !== undefined) {
      console.warn(formattedMessage, compactData);
    } else {
      console.warn(formattedMessage);
    }
  }

  error(message: string, error?: Error | unknown, context?: string): void {
    // Errors always log (but still respect module filtering)
    const logModule = context?.toLowerCase() as LogModule | undefined;
    if (!this.shouldLogModule(logModule)) return;

    const formattedMessage = this.formatMessage(LogLevel.ERROR, message, context);
    if (error) {
      console.error(formattedMessage, error);
    } else {
      console.error(formattedMessage);
    }
  }

  // API request/response logging
  apiRequest(method: string, url: string, data?: unknown): void {
    this.debug(`API Request: ${method.toUpperCase()} ${url}`, data, 'API');
  }

  apiResponse(method: string, url: string, status: number, data?: unknown): void {
    const level = status >= 400 ? LogLevel.WARN : LogLevel.DEBUG;
    const message = `API Response: ${method.toUpperCase()} ${url} - ${status}`;

    if (level === LogLevel.WARN) {
      this.warn(message, data, 'API');
    } else {
      this.debug(message, data, 'API');
    }
  }

  apiError(method: string, url: string, error: Error | unknown): void {
    this.error(`API Error: ${method.toUpperCase()} ${url}`, error, 'API');
  }

  // Performance logging
  performance(operation: string, duration: number, data?: unknown): void {
    const level = duration > 1000 ? LogLevel.WARN : LogLevel.DEBUG;
    const message = `Performance: ${operation} took ${duration}ms`;

    if (level === LogLevel.WARN) {
      this.warn(message, data, 'PERF');
    } else {
      this.debug(message, data, 'PERF');
    }
  }

  // User action logging
  userAction(action: string, data?: unknown): void {
    this.info(`User Action: ${action}`, data, 'USER');
  }

  // Data sync logging
  dataSync(operation: string, success: boolean, data?: unknown): void {
    if (success) {
      this.debug(`Data Sync: ${operation} completed`, data, 'SYNC');
    } else {
      this.warn(`Data Sync: ${operation} failed`, data, 'SYNC');
    }
  }
}

// Create singleton instance
export const logger = new Logger();

// Export convenience functions for backward compatibility
export const log = {
  debug: (message: string, data?: unknown, context?: string) => logger.debug(message, data, context),
  info: (message: string, data?: unknown, context?: string) => logger.info(message, data, context),
  warn: (message: string, data?: unknown, context?: string) => logger.warn(message, data, context),
  error: (message: string, error?: Error | unknown, context?: string) => logger.error(message, error, context),
  apiRequest: (method: string, url: string, data?: unknown) => logger.apiRequest(method, url, data),
  apiResponse: (method: string, url: string, status: number, data?: unknown) => logger.apiResponse(method, url, status, data),
  apiError: (method: string, url: string, error: Error | unknown) => logger.apiError(method, url, error),
  performance: (operation: string, duration: number, data?: unknown) => logger.performance(operation, duration, data),
  userAction: (action: string, data?: unknown) => logger.userAction(action, data),
  dataSync: (operation: string, success: boolean, data?: unknown) => logger.dataSync(operation, success, data),
};