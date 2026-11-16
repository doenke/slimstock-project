import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodType, type z } from 'zod';

/**
 * An error with a stable code. The web app translates `error` (errors.<code>); `message` is for logs and
 * API users only.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const notFound = () => new ApiError(404, 'not_found');
export const forbidden = () => new ApiError(403, 'forbidden');

export function parse<S extends ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw result.error;
  return result.data;
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError) {
    return reply.code(error.status).send({ error: error.code, message: error.message, ...error.details });
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return reply.code(400).send({ error: 'validation', message: 'Invalid input', issues });
  }
  const status = (error as FastifyError).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: 'bad_request', message: error.message });
  request.log.error(error);
  return reply.code(500).send({ error: 'internal', message: 'Internal error' });
}
