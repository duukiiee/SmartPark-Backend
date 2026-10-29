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

// Dedicated rate limiter for login endpoint - per account lockout
// - 5 failed attempts per 15 minutes
// - Does not count successful logins
// - Per-account lockout (identifier-specific, not just IP)
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes lockout window
  max: 5, // Limit to 5 failed login attempts per identifier
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
  
  // Per-account lockout: scope to IP + identifier
  keyGenerator: (req) => {
    const identifier = (req.body?.identifier || "").toLowerCase().trim();
    return `${req.ip}_${identifier}`;
  },
  
  message: {
    success: false,
    status: "Locked",
    message: "Too many failed login attempts for this account. Please try again after 15 minutes.",
  },
});
