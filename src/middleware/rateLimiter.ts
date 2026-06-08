import rateLimit from 'express-rate-limit';

const apiMax = Number(process.env.RATE_LIMIT_API) || 300;
const aiMax = Number(process.env.RATE_LIMIT_AI) || 20;
const jiraMax = Number(process.env.RATE_LIMIT_JIRA) || 60;

// Skip rate limiting entirely in test environments (MOCK_CLAUDE=1)
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
  message: { error: { code: 'RATE_LIMITED', message: 'Too many AI requests, please wait.' } },
  skip: skipInTest,
});

export const jiraLimiter = rateLimit({
  windowMs: 60_000,
  max: jiraMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});
