import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * Structured logger.
 *
 * In production it emits one JSON object per line, which is what every log
 * aggregator (Cloud Logging, Datadog, Loki) wants. In development it keeps Nest's
 * readable console output. No provider SDK is hardwired: shipping logs is the
 * platform's job, and stdout is the portable interface to it.
 */
export class StructuredLogger extends ConsoleLogger {
  constructor(
    context: string,
    private readonly json: boolean,
    levels: LogLevel[],
  ) {
    super(context, { logLevels: levels });
  }

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
  ): void {
    if (!this.json) {
      super.printMessages(messages, context, logLevel);
      return;
    }

    for (const message of messages) {
      const line = {
        timestamp: new Date().toISOString(),
        level: logLevel,
        context: context || this.context,
        ...normalise(message),
      };
      process.stdout.write(`${JSON.stringify(line)}\n`);
    }
  }
}

function normalise(message: unknown): Record<string, unknown> {
  if (typeof message === 'string') return { message };
  if (message instanceof Error) {
    return { message: message.message, error: message.name, stack: message.stack };
  }
  if (message && typeof message === 'object') return message as Record<string, unknown>;
  return { message: String(message) };
}

export function levelsFor(level: LogLevel): LogLevel[] {
  const order: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const index = order.indexOf(level);
  return order.slice(0, index === -1 ? 3 : index + 1);
}
