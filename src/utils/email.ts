import nodemailer from "nodemailer";
import crypto from "crypto";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

// Create a transporter using environment variables
// For development, you can use a test account from Ethereal
// For production, configure with real SMTP settings
const createTransporter = () => {
  // Check if we have SMTP configuration
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Default: Log to console for development (or use ethereal for testing)
  // For production without SMTP config, emails will fail silently
  // You should configure SMTP settings in .env for real email delivery
  console.warn("SMTP configuration not found. Email sending is disabled.");
  return null;
};

const transporter = createTransporter();

/**
 * Send password reset OTP email
 * @param email - Recipient email address
 * @param otp - 6-digit OTP code
 * @param firstName - User's first name for personalization
 */
export async function sendPasswordResetEmail(
  email: string,
  otp: string,
  firstName: string
): Promise<boolean> {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #0053CC, #2563eb); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; }
        .otp-box { background: #f8fafc; border: 2px dashed #0053CC; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
        .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0053CC; font-family: monospace; }
        .warning { color: #64748b; font-size: 12px; margin-top: 20px; }
        .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-radius: 0 0 12px 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="color: white; margin: 0;">SmartPark</h1>
          <p style="color: #bfdbfe; margin: 10px 0 0 0;">QCU Parking Management System</p>
        </div>
        <div class="content">
          <p>Hi ${firstName},</p>
          <p>You requested a password reset for your SmartPark account. Please use the following verification code:</p>
          
          <div class="otp-box">
            <p style="margin: 0 0 10px 0; color: #64748b; font-size: 14px;">Your verification code:</p>
            <div class="otp-code">${otp}</div>
          </div>
          
          <p>This code will expire in <strong>15 minutes</strong>.</p>
          
          <p class="warning">
            If you didn't request this password reset, please ignore this email or contact support if you have concerns.
          </p>
        </div>
        <div class="footer">
          <p style="margin: 0;">© ${new Date().getFullYear()} SmartPark - Quezon City University</p>
          <p style="margin: 5px 0 0 0;">This is an automated message, please do not reply directly to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
Hi ${firstName},

You requested a password reset for your SmartPark account.

Your verification code is: ${otp}

This code will expire in 15 minutes.

If you didn't request this password reset, please ignore this email.

© ${new Date().getFullYear()} SmartPark - Quezon City University
  `;

  if (!transporter) {
    console.log(`[DEV MODE] Password reset OTP for ${email}: ${otp}`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "SmartPark <noreply@smartpark.com>",
      to: email,
      subject: "SmartPark Password Reset Verification Code",
      text: textContent,
      html: htmlContent,
    });
    console.log(`Password reset email sent to ${email}`);
    return true;
  } catch (error) {
    console.error("Failed to send password reset email:", error);
    return false;
  }
}

/**
 * Generate a random 6-digit OTP
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Validate password strength requirements
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  message: string;
} {
  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters long" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number" };
  }
  return { valid: true, message: "Password meets strength requirements" };
}