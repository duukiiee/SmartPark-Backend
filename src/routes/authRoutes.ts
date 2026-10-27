import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "../prisma/db.js";
import { loginRateLimiter, authLimiter } from "../middlewares/rateLimiter.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import { registerSchema, loginSchema, adminRegisterSchema, forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema } from "../validations/authValidation.js";
import { sendPasswordResetEmail } from "../utils/email.js";

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
        accountStatus: "Active",
      },
    });

    // 7. Generate JWT Token
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
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        accountType: newUser.accountType,
        schoolId: newUser.schoolId,
      },
      jwtSecret,
      { expiresIn: "7d" }
    );

    // 8. Safe response (never return password)
    return res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: {
        id: newUser.id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        schoolId: newUser.schoolId,
        phone: newUser.phone,
        role: newUser.role,
        accountType: newUser.accountType,
        accountStatus: newUser.accountStatus,
      },
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

    // 2. Support Dual Login: Email OR School ID
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
        message: "Invalid email/school ID or password",
      });
    }

    // 3. Check Account Status (Active, Suspended, Locked)
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

    // 4. Verify Hashed Password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email/school ID or password",
      });
    }

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
router.post("/admin-register", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
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

    // Save OTP to database with 15-minute expiry
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.passwordResetOtp.create({
      data: {
        email: normalizedEmail,
        otp,
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

    // Find valid OTP record
    const otpRecord = await db.passwordResetOtp.findFirst({
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

    // OTP is valid - delete it (one-time use)
    await db.passwordResetOtp.delete({
      where: { id: otpRecord.id },
    });

    return res.status(200).json({
      success: true,
      message: "Verification code accepted",
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
        message: "Invalid input",
      });
    }

    const { email, otp, password } = validation.data;
    const normalizedEmail = email.toLowerCase();

    // Find valid OTP record
    const otpRecord = await db.passwordResetOtp.findFirst({
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

    // Update password
    await db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // Delete used OTP
    await db.passwordResetOtp.delete({
      where: { id: otpRecord.id },
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successful. You can now log in with your new password.",
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 8. LOGOUT (POST /api/logout)
// ==========================================
router.post("/logout", async (req, res, next) => {
  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

export default router;
