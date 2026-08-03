import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const CanvasPositionSchema = z
  .object({
    col: z.number().int().min(0).openapi({ description: 'Column index' }),
    row: z.number().int().min(0).openapi({ description: 'Row index' }),
  })
  .openapi('CanvasPosition');

export const CanvasLayoutSchema = z
  .object({
    positions: z
      .record(z.string(), CanvasPositionSchema)
      .openapi({ description: 'Doc filename → grid position' }),
  })
  .openapi('CanvasLayout');
