import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../prisma/db.js";
import { authLimiter } from "../middlewares/rateLimiter.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { registerSchema, loginSchema } from "../validations/authValidation.js";

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

    const { firstName, lastName, email, schoolId, phone, password, role } = validation.data;
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

    // 4. Secure Password Hashing
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 5. Save to Supabase PostgreSQL via Prisma 7 Client
    const newUser = await db.user.create({
      data: {
        firstName,
        lastName,
        email: normalizedEmail,
        schoolId,
        phone: phone || null,
        password: hashedPassword,
        role: role || "STUDENT",
        accountStatus: "Active",
      },
    });

    // 6. Generate JWT Token
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
        schoolId: newUser.schoolId,
      },
      jwtSecret,
      { expiresIn: "7d" }
    );

    // 7. Safe response (never return password)
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
        accountStatus: newUser.accountStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2. LOGIN ENDPOINT (POST /api/login)
// ==========================================
router.post("/login", authLimiter, async (req, res, next) => {
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

export default router;
