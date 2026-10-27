import rateLimit from "express-rate-limit";

// Rate limiter for authentication routes to prevent brute-force attacks
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    message: "Too many login/registration attempts. Please try again after 15 minutes.",
  },
});

// Dedicated rate limiter for login endpoint
// - 5 failed attempts per 15 minutes
// - Does not count successful logins
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 failed login attempts
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
  message: {
    success: false,
    message: "Too many failed login attempts. Please try again after 15 minutes.",
  },
});
