import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "../prisma/db.js";
import { loginRateLimiter, authLimiter, checkAccountLockout, recordFailedLogin, recordSuccessfulLogin } from "../middlewares/rateLimiter.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import { registerSchema, loginSchema, adminRegisterSchema, forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema, verifyEmailSchema, resendVerificationSchema } from "../validations/authValidation.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../utils/email.js";

const router = Router();

// ==========================================
// 1. REGISTER ENDPOINT (POST /api/register)
// ==========================================
router.post("/register", authLimiter, async (req, res, next) => {
  try {
    // 1. Input Validation with Zod
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      return res.status(400).json({
        success: false,
        message: issue ? `${issue.path.join(".")}: ${issue.message}` : "Validation error",
      });
    }

    const { firstName, lastName, email, schoolId, phone, password } = validation.data;
    const normalizedEmail = email.toLowerCase();

    // 2. Check if email already exists in Supabase
    const existingEmail = await db.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "An account with this email address already exists",
      });
    }

    // 3. Check if school ID already exists in Supabase
    const existingSchoolId = await db.user.findUnique({
      where: { schoolId },
    });
    if (existingSchoolId) {
      return res.status(409).json({
        success: false,
        message: "An account with this Student/Employee ID already exists",
      });
    }

    // 4. Determine accountType server-side based on validated schoolId pattern
    let accountType = "STUDENT";
    if (/^\d{2}-\d{4}$/.test(schoolId)) {
      accountType = "STUDENT";
    } else if (/^[A-Za-z]{2}-\d{7}$/.test(schoolId)) {
      accountType = "EMPLOYEE";
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid Student/Employee ID format",
      });
    }

    // 5. Secure Password Hashing
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 6. Save to Supabase PostgreSQL via Prisma 7 Client
    // Public registration ALWAYS gets USER role - never trust frontend role
    const newUser = await db.user.create({
      data: {
        firstName,
        lastName,
        email: normalizedEmail,
        schoolId,
        phone: phone || null,
        password: hashedPassword,
        role: "USER",
        accountType,
        accountStatus: "PendingVerification",
      },
    });

    // Delete any existing verification OTPs for this email
    await db.emailVerificationOtp.deleteMany({
      where: { email: normalizedEmail },
    });

    // Generate 6-digit OTP (valid for 15 minutes)
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.emailVerificationOtp.create({
      data: {
        email: normalizedEmail,
        otp,
        expiresAt,
      },
    });

    // Send verification email
    await sendVerificationEmail(normalizedEmail, otp, newUser.firstName);

    return res.status(201).json({
      success: true,
      message: "Registration successful! A 6-digit verification code has been sent to your email.",
      email: normalizedEmail,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2. LOGIN ENDPOINT (POST /api/login) - Rate Limited
// ==========================================
router.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    // 1. Input Validation with Zod
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      return res.status(400).json({
        success: false,
        message: issue ? `${issue.path.join(".")}: ${issue.message}` : "Validation error",
      });
    }

    const { identifier, password } = validation.data;
    const normalizedIdentifier = identifier.trim();

    // 2. Check Server-Side Account Lockout before processing
    const lockCheck = checkAccountLockout(normalizedIdentifier);
    if (lockCheck.isLocked) {
      return res.status(423).json({
        success: false,
        status: "Locked",
        lockUntil: lockCheck.lockUntil,
        remainingSeconds: lockCheck.remainingSeconds,
        message: "Too many failed login attempts for this account. Account locked for 15 minutes.",
      });
    }

    // 3. Support Dual Login: Email OR School ID
    let user = null;
    if (normalizedIdentifier.includes("@")) {
      user = await db.user.findUnique({
        where: { email: normalizedIdentifier.toLowerCase() },
      });
    } else {
      user = await db.user.findUnique({
        where: { schoolId: normalizedIdentifier },
      });
    }

    // Fallback: in case an ID was formatted or email didn't match
    if (!user) {
      user = await db.user.findUnique({
        where: { schoolId: normalizedIdentifier },
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email/school ID or password.",
      });
    }

    // Check database-backed lockout
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const remainingSeconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      return res.status(423).json({
        success: false,
        status: "Locked",
        lockUntil: user.lockedUntil.getTime(),
        remainingSeconds,
        message: "Too many failed login attempts for this account. Account locked for 15 minutes.",
      });
    }

    // If lockout has expired, reset failedAttempts and lockedUntil
    if (user.lockedUntil && user.lockedUntil <= now) {
      user = await db.user.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    }

    // 4. Verify Hashed Password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const newAttempts = user.failedAttempts + 1;
      let lockedUntil: Date | null = null;
      if (newAttempts >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await db.user.update({
          where: { id: user.id },
          data: { failedAttempts: newAttempts, lockedUntil },
        });
        const remainingSeconds = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
        return res.status(423).json({
          success: false,
          status: "Locked",
          lockUntil: lockedUntil.getTime(),
          remainingSeconds,
          message: "Too many failed login attempts for this account. Account locked for 15 minutes.",
        });
      } else {
        await db.user.update({
          where: { id: user.id },
          data: { failedAttempts: newAttempts },
        });
        const remainingAttempts = 5 - newAttempts;
        return res.status(401).json({
          success: false,
          remainingAttempts,
          message: `Invalid email/school ID or password. (${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining before 15-minute account lockout)`,
        });
      }
    }

    // 5. Check Account Status (Active, Suspended, Locked, PendingVerification) AFTER password verification
    if (user.accountStatus === "Suspended") {
      return res.status(403).json({
        success: false,
        status: "Suspended",
        message: "Your account has been suspended. Please submit an appeal for review.",
      });
    }

    if (user.accountStatus === "Locked") {
      return res.status(403).json({
        success: false,
        status: "Locked",
        message: "Your account is temporarily locked.",
      });
    }

    if (user.accountStatus === "PendingVerification") {
      return res.status(403).json({
        success: false,
        status: "PendingVerification",
        email: user.email,
        message: "Your account email is not yet verified. Please verify your email before logging in.",
      });
    }

    // Clear failed attempts and lockedUntil upon successful login
    await db.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    // 5. Generate Signed JWT Token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("JWT_SECRET missing in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        accountType: user.accountType,
        schoolId: user.schoolId,
      },
      jwtSecret,
      { expiresIn: "7d" }
    );

    // 6. Safe response (never return password)
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        schoolId: user.schoolId,
        phone: user.phone,
        role: user.role,
        accountType: user.accountType,
        accountStatus: user.accountStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 3. CURRENT USER (GET /api/me) - Protected
// ==========================================
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.user!.id },
    });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.accountStatus === "Suspended") {
      return res.status(403).json({
        success: false,
        status: "Suspended",
        message: "Your account has been suspended. Please submit an appeal for review.",
      });
    }

    if (user.accountStatus === "Locked") {
      return res.status(403).json({
        success: false,
        status: "Locked",
        message: "Your account is temporarily locked.",
      });
    }

    if (user.accountStatus !== "Active") {
      return res.status(403).json({
        success: false,
        message: "Account is not active. Access denied.",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        schoolId: user.schoolId,
        phone: user.phone,
        role: user.role,
        accountStatus: user.accountStatus,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 4. ADMIN-ONLY REGISTER (POST /api/admin-register)
// ==========================================
router.post("/admin-register", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res, next) => {
  try {
    const validation = adminRegisterSchema.safeParse(req.body);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      return res.status(400).json({
        success: false,
        message: issue ? `${issue.path.join(".")}: ${issue.message}` : "Validation error",
      });
    }

    const { firstName, lastName, email, schoolId, phone, password, role } = validation.data;
    const normalizedEmail = email.toLowerCase();
    const callerRole = req.user?.role?.toUpperCase();
    const targetRole = role.toUpperCase();

    if (targetRole === "ADMIN" && callerRole !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Access Denied: Only Super Admins can create new Admin accounts.",
      });
    }

    const existingEmail = await db.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "An account with this email address already exists",
      });
    }

    const existingSchoolId = await db.user.findUnique({
      where: { schoolId },
    });
    if (existingSchoolId) {
      return res.status(409).json({
        success: false,
        message: "An account with this Student/Employee ID already exists",
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await db.user.create({
      data: {
        firstName,
        lastName,
        email: normalizedEmail,
        schoolId,
        phone: phone || null,
        password: hashedPassword,
        role: role,
        accountStatus: "Active",
      },
    });

    return res.status(201).json({
      success: true,
      message: `${role} account created successfully`,
      user: {
        id: newUser.id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        schoolId: newUser.schoolId,
        phone: newUser.phone,
        role: newUser.role,
        accountStatus: newUser.accountStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 5. FORGOT PASSWORD - SEND OTP (POST /api/forgot-password)
// ==========================================
router.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    // Validate email input
    const validation = forgotPasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    const { email } = validation.data;
    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Always return success even if email doesn't exist (prevent email enumeration)
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, a verification code has been sent",
      });
    }

    // Delete any existing OTP for this email
    await db.passwordResetOtp.deleteMany({
      where: { email: normalizedEmail },
    });

    // Generate new 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Hash OTP using SHA-256 before saving to database
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    // Save hashed OTP to database with 15-minute expiry and attempts counter
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.passwordResetOtp.create({
      data: {
        email: normalizedEmail,
        otp: hashedOtp,
        attempts: 0,
        expiresAt,
      },
    });

    // Send OTP via email
    const emailSent = await sendPasswordResetEmail(
      normalizedEmail,
      otp,
      user.firstName
    );

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to send verification code. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Verification code sent to your email",
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 6. VERIFY OTP (POST /api/verify-otp)
// ==========================================
router.post("/verify-otp", authLimiter, async (req, res, next) => {
  try {
    const validation = verifyOtpSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid input",
      });
    }

    const { email, otp } = validation.data;
    const normalizedEmail = email.toLowerCase();

    // Hash incoming plain OTP with SHA-256
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    // Find valid OTP record for this email with hashed OTP
    const otpRecord = await db.passwordResetOtp.findFirst({
      where: {
        email: normalizedEmail,
        otp: hashedOtp,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      // OTP not found or expired - check if there's an existing record for this email to increment attempts
      const existingRecord = await db.passwordResetOtp.findFirst({
        where: {
          email: normalizedEmail,
          expiresAt: { gt: new Date() },
        },
      });

      if (existingRecord) {
        // Increment attempts counter
        const newAttempts = existingRecord.attempts + 1;
        if (newAttempts >= 5) {
          // Too many invalid attempts - invalidate the code
          await db.passwordResetOtp.delete({
            where: { id: existingRecord.id },
          });
          return res.status(400).json({
            success: false,
            message: "Too many invalid attempts. This verification code has been invalidated. Please request a new one.",
          });
        } else {
          await db.passwordResetOtp.update({
            where: { id: existingRecord.id },
            data: { attempts: newAttempts },
          });
          return res.status(400).json({
            success: false,
            message: `Invalid verification code. (${5 - newAttempts} attempts remaining)`,
          });
        }
      }

      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    // OTP is valid - delete it (single-use)
    await db.passwordResetOtp.delete({
      where: { id: otpRecord.id },
    });

    // Generate a short-lived resetToken (valid for 15 minutes)
    const resetToken = jwt.sign(
      { email: normalizedEmail, purpose: "password_reset" },
      process.env.JWT_SECRET!,
      { expiresIn: "15m" }
    );

    return res.status(200).json({
      success: true,
      message: "Verification code accepted",
      resetToken,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 7. RESET PASSWORD (POST /api/reset-password)
// ==========================================
router.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const validation = resetPasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.issues[0]?.message || "Invalid input",
      });
    }

    const { resetToken, password } = validation.data;

    // Verify and decode resetToken
    let decoded: { email: string; purpose: string; exp?: number } | null = null;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET!) as { email: string; purpose: string };
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Reset session expired. Please request a new verification code.",
      });
    }

    if (!decoded || decoded.purpose !== "password_reset") {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token. Please request a new verification code.",
      });
    }

    const normalizedEmail = decoded.email.toLowerCase();

    // Check if token has been revoked
    const isRevoked = await db.revokedToken.findUnique({
      where: { token: resetToken },
    });

    if (isRevoked) {
      return res.status(400).json({
        success: false,
        message: "This reset token has already been used. Please request a new verification code.",
      });
    }

    // Verify user exists
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Update password and reset lockout
    await db.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    // Blacklist the used resetToken
    const tokenExp = decoded.exp || Math.floor(Date.now() / 1000) + 15 * 60;
    await db.revokedToken.create({
      data: {
        token: resetToken,
        expiresAt: new Date(tokenExp * 1000),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successful! You may now sign in.",
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 8. CHANGE PASSWORD (POST /api/change-password) - Protected
// ==========================================
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long",
      });
    }

    const user = await db.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Incorrect current password. Please try again.",
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 9. LOGOUT (POST /api/logout)
// ==========================================
router.post("/logout", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const jwtSecret = process.env.JWT_SECRET || "";
          const decoded = jwt.verify(token, jwtSecret) as { exp?: number };
          const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 1000);
          const existing = await db.revokedToken.findUnique({ where: { token } });
          if (!existing) {
            await db.revokedToken.create({
              data: { token, expiresAt },
            });
          }
        } catch (e) {
          try {
            const existing = await db.revokedToken.findUnique({ where: { token } });
            if (!existing) {
              await db.revokedToken.create({
                data: { token, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 1000) },
              });
            }
          } catch (dbErr) {
            // ignore
          }
        }
      }
    }
    return res.status(200).json({
      success: true,
      message: "Logged out and token revoked successfully",
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 10. VERIFY EMAIL (POST /api/verify-email)
// ==========================================
router.post("/verify-email", authLimiter, async (req, res, next) => {
  try {
    const validation = verifyEmailSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid input. Please provide email and 6-digit OTP.",
      });
    }

    const { email, otp } = validation.data;
    const normalizedEmail = email.toLowerCase();

    // Find valid OTP record
    const otpRecord = await db.emailVerificationOtp.findFirst({
      where: {
        email: normalizedEmail,
        otp: otp,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    // Find user
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update accountStatus to Active
    await db.user.update({
      where: { id: user.id },
      data: { accountStatus: "Active" },
    });

    // Delete used OTP
    await db.emailVerificationOtp.delete({
      where: { id: otpRecord.id },
    });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully! You may now sign in.",
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 11. RESEND VERIFICATION OTP (POST /api/resend-verification-otp)
// ==========================================
router.post("/resend-verification-otp", authLimiter, async (req, res, next) => {
  try {
    const validation = resendVerificationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    const { email } = validation.data;
    const normalizedEmail = email.toLowerCase();

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an unverified account with this email exists, a new verification code has been sent.",
      });
    }

    if (user.accountStatus !== "PendingVerification") {
      return res.status(400).json({
        success: false,
        message: "This account is already verified or active.",
      });
    }

    // Delete existing OTPs for this email
    await db.emailVerificationOtp.deleteMany({
      where: { email: normalizedEmail },
    });

    // Generate new 6-digit OTP (15 min expiry)
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.emailVerificationOtp.create({
      data: {
        email: normalizedEmail,
        otp,
        expiresAt,
      },
    });

    await sendVerificationEmail(normalizedEmail, otp, user.firstName);

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email.",
    });
  } catch (error) {
    next(error);
  }
});

export default router;
