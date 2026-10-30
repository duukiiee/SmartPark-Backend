import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../prisma/db.js";

export interface TokenPayload {
  id: number;
  email: string;
  role: string;
  schoolId: string;
}

// Extend Express Request type to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authorization token required",
    });
  }

  const parts = authHeader.split(" ");
  const token = parts[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Malformed authorization header",
    });
  }

  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error("JWT_SECRET is not configured in environment variables");
    return res.status(500).json({
      success: false,
      message: "Server configuration error",
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as unknown as TokenPayload;

    // Stateful check: verify user still exists and account is Active in database
    const user = await db.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        accountStatus: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists",
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

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

// Role-based authorization middleware
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    next();
  };
}
