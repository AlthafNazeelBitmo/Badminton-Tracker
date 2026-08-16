import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application errors carry a stable machine-readable `code` alongside the HTTP status,
 * so clients can branch on the cause without string-matching prose.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string; code?: string }>,
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundError extends AppException {
  constructor(entity: string) {
    super(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${entity} not found.`);
  }
}

export class ValidationError extends AppException {
  constructor(
    message: string,
    details?: Array<{ path: string; message: string; code?: string }>,
  ) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, details);
  }
}

export class ConflictError extends AppException {
  constructor(message: string) {
    super(HttpStatus.CONFLICT, 'CONFLICT', message);
  }
}

export class UnauthorizedError extends AppException {
  constructor(message = 'Authentication is required.') {
    super(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppException {
  constructor(message = 'You do not have access to this resource.') {
    super(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }
}

export class RateLimitError extends AppException {
  constructor(retryAfterSeconds: number) {
    super(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
    );
  }
}

/**
 * Deliberately identical message for "no such account" and "wrong password".
 * Distinguishing them turns the login form into an account-enumeration oracle.
 */
export class InvalidCredentialsError extends AppException {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
}
