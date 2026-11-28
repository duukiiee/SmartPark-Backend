import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Rate limiter for authentication routes to prevent brute-force attacks
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    message:
      "Too many login/registration attempts. Please try again after 15 minutes.",
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
    message:
      "Too many login attempts from this network. Please try again after 15 minutes.",
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

// ==========================================
// GUARD-SPECIFIC RATE LIMITERS
// ==========================================
// Rate limit for guard scanning, manual entry/exit, and registration (30 req/min)
export const guardScanRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many scan/record requests. Please try again after a moment.",
  },
  keyGenerator: (req) => {
    const ip = req.ip ? ipKeyGenerator(req.ip) : "unknown";
    const userId = (req.user as any)?.id || "unknown";
    return `${ip}:${userId}`;
  },
});

// Rate limit for general guard queries (dashboard, monitoring, vehicles list)
export const guardGeneralRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 120, // 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Rate limit exceeded for guard requests. Please wait a moment.",
  },
});

// Rate limit for reports/CSV exports (10 exports per minute)
export const guardExportRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Export rate limit reached. Please wait a minute before exporting again.",
  },
});

// Idempotency key store (in-memory, max 10000 entries)
interface IdempotencyEntry {
  response: any;
  timestamp: number;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function checkIdempotency(
  key: string,
): { found: boolean; response: any } | null {
  const entry = idempotencyStore.get(key);
  if (!entry) return null;

  // Check if expired
  if (Date.now() - entry.timestamp > IDEMPOTENCY_TTL_MS) {
    idempotencyStore.delete(key);
    return null;
  }

  return { found: true, response: entry.response };
}

export function setIdempotency(key: string, response: any): void {
  // Clean up old entries if store is too large
  if (idempotencyStore.size >= 10000) {
    // Remove oldest 10% of entries
    const entries = Array.from(idempotencyStore.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, Math.floor(entries.length * 0.1));
    toRemove.forEach(([k]) => idempotencyStore.delete(k));
  }

  idempotencyStore.set(key, { response, timestamp: Date.now() });
}

export function generateIdempotencyKey(
  action: string,
  vehicleId: number,
  guardId: number,
): string {
  // Format: guard:action:vehicleId:guardId:timestamp(rounded to second)
  // This ensures the same action by the same guard on the same vehicle in the same second gets the same key
  const roundedTime = Math.floor(Date.now() / 1000);
  return `guard:${action}:v${vehicleId}:g${guardId}:${roundedTime}`;
}
