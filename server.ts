import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from './src/config/env.js';
import { applyMiddleware } from './src/app/middleware.js';
import { buildContext } from './src/app/context.js';
import { registerRoutes } from './src/app/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
applyMiddleware(app, __dirname);
const ctx = await buildContext(__dirname);
registerRoutes(app, ctx, __dirname);

export { app };

if (process.argv[1] === __filename) {
  app.listen(config.PORT, () => ctx.runStartup(config.PORT));
}
