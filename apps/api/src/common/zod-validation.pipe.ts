import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodIssue, type ZodTypeAny } from 'zod';
import { ValidationError } from './errors';

/**
 * Validates a request payload against a zod schema from `@badminton/contracts`.
 *
 * The same schema object validates the request here and drives the form on the web
 * client, so a rule can never be enforced on one side and forgotten on the other.
 * The pipe returns the *parsed* value, meaning downstream code receives coerced types
 * (real `Date`s, numbers from query strings) rather than raw strings.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      const issues = zodIssuesOf(error);
      if (issues) {
        throw new ValidationError('The submitted data is not valid.', formatZodIssues(issues));
      }
      throw error;
    }
  }
}

/**
 * Extracts issues from a zod error.
 *
 * Identity is checked structurally rather than with `instanceof` alone. The schemas come
 * from a CommonJS package while this file may be loaded as ESM, so the two sides can end
 * up holding *different* `ZodError` classes — the dual-package hazard. When that happens
 * `instanceof` silently returns false and a clean 422 becomes a 500. Matching on the
 * shape works whichever copy threw.
 */
function zodIssuesOf(error: unknown): ZodIssue[] | null {
  if (error instanceof ZodError) return error.issues;

  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  ) {
    return (error as { issues: ZodIssue[] }).issues;
  }

  return null;
}

export function formatZodIssues(issues: readonly ZodIssue[]): Array<{
  path: string;
  message: string;
  code: string;
}> {
  return issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/** Convenience factory so controllers read as `@Body(zodBody(createMatchSchema))`. */
export function zodBody(schema: ZodTypeAny): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}

/** Query strings arrive as strings; the schemas coerce them. */
export function zodQuery(schema: ZodTypeAny): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
