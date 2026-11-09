import { z } from "zod";

// Student/Employee ID validation pattern: XX-XXXX or AA-XXXXXXX
const schoolIdSchema = z
  .string()
  .trim()
  .min(1, "Student/Employee ID is required")
  .regex(/^(\d{2}-\d{4}|[A-Za-z]{2}-\d{7})$/, {
    message: "ID must be in format XX-XXXX (e.g., 24-1474) or AA-XXXXXXX (e.g., AB-1234567)",
  });

// Philippine mobile number validation
// Valid formats: 09XXXXXXXXX (11 digits) or +639XXXXXXXXX (12 digits after +63)
const philippinePhoneSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      if (!val || val.trim() === "") return true; // Optional field
      const clean = val.replace(/[\s-]/g, "");
      return /^(09|\+639)\d{9}$/.test(clean);
    },
    {
      message: "Phone number must be a valid Philippine mobile number (e.g., 09123456789 or +639123456789)",
    }
  )
  .nullable()
  .optional();

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Invalid email format"),
  schoolId: schoolIdSchema,
  phone: philippinePhoneSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter (A-Z)")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter (a-z)")
    .regex(/[0-9]/, "Password must contain at least one number (0-9)"),
  declaration: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms and declare information is correct.",
  }),
});

export const verifyEmailSchema = z.object({
  email: z.string().trim().email("Invalid email format"),
  otp: z.string().length(6, "OTP must be exactly 6 digits"),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email("Invalid email format"),
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
  phone: philippinePhoneSchema,
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
  resetToken: z.string().min(1, "Reset token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter (A-Z)")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter (a-z)")
    .regex(/[0-9]/, "Password must contain at least one number (0-9)"),
});
