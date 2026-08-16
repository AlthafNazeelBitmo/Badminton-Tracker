import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@badminton/contracts';

/**
 * The single exit point for every error the API produces.
 *
 * Two guarantees:
 *  - **Shape.** Every error response is an `ApiErrorBody`, so clients need one branch.
 *  - **Containment.** Stack traces, SQL, Prisma internals and secrets never leave the
 *    process. Unexpected errors are logged in full server-side and reduced to a generic
 *    message plus a request id the user can quote in a support request.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const requestId = (request as Request & { id?: string }).id ?? 'unknown';

    const { status, code, message, details, logAsError } = this.describe(exception);

    if (logAsError) {
      this.logger.error({
        message: 'Unhandled exception',
        requestId,
        method: request.method,
        path: request.url,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else if (status >= HttpStatus.BAD_REQUEST) {
      this.logger.warn({
        message: 'Request failed',
        requestId,
        method: request.method,
        path: request.url,
        status,
        code,
      });
    }

    const body: ApiErrorBody = {
      statusCode: status,
      code,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      ...(details && details.length > 0 ? { details } : {}),
    };

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: ApiErrorBody['details'];
    logAsError: boolean;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        return {
          status,
          code: typeof record.code === 'string' ? record.code : defaultCodeFor(status),
          message:
            typeof record.message === 'string' ? record.message : exception.message,
          details: Array.isArray(record.details)
            ? (record.details as ApiErrorBody['details'])
            : undefined,
          // 5xx from an HttpException is still a bug worth a stack trace.
          logAsError: status >= HttpStatus.INTERNAL_SERVER_ERROR,
        };
      }

      return {
        status,
        code: defaultCodeFor(status),
        message: exception.message,
        logAsError: status >= HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return { ...translatePrismaError(exception), logAsError: false };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // The message contains the query shape, so it is logged but never returned.
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: 'The request could not be processed.',
        logAsError: true,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      logAsError: true,
    };
  }
}

/**
 * Maps Prisma's constraint errors onto meaningful HTTP responses without echoing the
 * database's own wording (which leaks table and column names).
 */
function translatePrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        code: 'DUPLICATE',
        message: 'A record with these details already exists.',
      };
    case 'P2003':
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'INVALID_REFERENCE',
        message: 'A referenced record does not exist.',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'The requested record was not found.',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'DATABASE_ERROR',
        message: 'Something went wrong. Please try again.',
      };
  }
}

function defaultCodeFor(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    422: 'VALIDATION_FAILED',
    429: 'RATE_LIMITED',
  };
  return map[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
}
