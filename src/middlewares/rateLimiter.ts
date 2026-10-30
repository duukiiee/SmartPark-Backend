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

// Dedicated IP-level rate limiter for login endpoint
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 20, // 20 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    status: "Locked",
    message: "Too many login attempts from this network. Please try again after 15 minutes.",
  },
});

// ==========================================
// SERVER-SIDE PER-ACCOUNT LOCKOUT MANAGER
// ==========================================
interface LockoutEntry {
  attempts: number;
  lockUntil: number | null; // epoch ms
}

const lockoutStore = new Map<string, LockoutEntry>();

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function checkAccountLockout(identifier: string): {
  isLocked: boolean;
  remainingSeconds: number;
  lockUntil: number | null;
} {
  const key = identifier.toLowerCase().trim();
  const entry = lockoutStore.get(key);
  if (!entry) return { isLocked: false, remainingSeconds: 0, lockUntil: null };

  if (entry.lockUntil) {
    const remainingMs = entry.lockUntil - Date.now();
    if (remainingMs > 0) {
      return {
        isLocked: true,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        lockUntil: entry.lockUntil,
      };
    }
    // Expired lockout
    lockoutStore.delete(key);
    return { isLocked: false, remainingSeconds: 0, lockUntil: null };
  }

  return { isLocked: false, remainingSeconds: 0, lockUntil: null };
}

export function recordFailedLogin(identifier: string): {
  isLocked: boolean;
  remainingAttempts: number;
  remainingSeconds: number;
  lockUntil: number | null;
} {
  const key = identifier.toLowerCase().trim();
  const now = Date.now();
  const entry = lockoutStore.get(key) || { attempts: 0, lockUntil: null };

  // If already locked
  if (entry.lockUntil && entry.lockUntil > now) {
    const remainingMs = entry.lockUntil - now;
    return {
      isLocked: true,
      remainingAttempts: 0,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      lockUntil: entry.lockUntil,
    };
  }

  entry.attempts += 1;

  if (entry.attempts >= MAX_ATTEMPTS) {
    const lockUntil = now + LOCKOUT_DURATION_MS;
    entry.lockUntil = lockUntil;
    lockoutStore.set(key, entry);
    return {
      isLocked: true,
      remainingAttempts: 0,
      remainingSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000),
      lockUntil,
    };
  }

  lockoutStore.set(key, entry);
  return {
    isLocked: false,
    remainingAttempts: MAX_ATTEMPTS - entry.attempts,
    remainingSeconds: 0,
    lockUntil: null,
  };
}

export function recordSuccessfulLogin(identifier: string) {
  const key = identifier.toLowerCase().trim();
  lockoutStore.delete(key);
}
