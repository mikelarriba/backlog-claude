import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const apiMax = config.RATE_LIMIT_API;
const aiMax = config.RATE_LIMIT_AI;
const jiraMax = config.RATE_LIMIT_JIRA;

// Skip rate limiting in test environments — read MOCK_CLAUDE dynamically so
// test setup that sets it in before() hooks is picked up at request time.
const skipInTest = () => !!process.env.MOCK_CLAUDE;

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: apiMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

export const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: aiMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests, please wait.', code: 'RATE_LIMITED' },
  skip: skipInTest,
});

export const jiraLimiter = rateLimit({
  windowMs: 60_000,
  max: jiraMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});
