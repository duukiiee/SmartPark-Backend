import { z } from "zod";

// Student/Employee ID validation pattern: XX-XXXX or AA-XXXXXXX
const schoolIdSchema = z
  .string()
  .trim()
  .min(1, "Student/Employee ID is required")
  .regex(/^(\d{2}-\d{4}|[A-Za-z]{2}-\d{7})$/, {
    message: "ID must be in format XX-XXXX (e.g., 24-1474) or AA-XXXXXXX (e.g., AB-1234567)",
  });

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Invalid email address"),
  schoolId: schoolIdSchema,
  phone: z.string().trim().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Email or School ID is required"),
  password: z.string().min(1, "Password is required"),
});

// Admin-only registration schema (for privileged account provisioning)
export const adminRegisterSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Invalid email address"),
  schoolId: schoolIdSchema,
  phone: z.string().trim().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["GUARD", "ADMIN"]),
});

// Password reset schemas
export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
});

export const verifyOtpSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
  otp: z.string().length(6, "OTP must be exactly 6 digits"),
});

export const resetPasswordSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
  otp: z.string().length(6, "OTP must be exactly 6 digits"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
