import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { sendError } from './routeHelpers.js';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request body', result.error.flatten());
      return;
    }
    req.body = result.data;
    next();
  };
}
