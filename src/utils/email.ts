import nodemailer from "nodemailer";
import crypto from "crypto";
import path from "path";
import fs from "fs";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

const createTransporter = () => {
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

  console.warn("SMTP configuration not found. Email sending is disabled.");
  return null;
};

const transporter = createTransporter();

// Resolve logo path for CID attachment
const LOGO_PATH = path.resolve(
  "C:/Users/Andrea Marcelo/SmartPark/SmartPark-Frontend/src/assets/smartpark-logo.svg",
);

function getLogoAttachment() {
  if (fs.existsSync(LOGO_PATH)) {
    return [
      {
        filename: "smartpark-logo.svg",
        path: LOGO_PATH,
        cid: "smartpark-logo",
      },
    ];
  }
  return [];
}

/**
 * Clean light-mode utility layout with large logo & bold code block
 */
function buildEmailLayout(bodyHtml: string): string {
  const hasLogo = fs.existsSync(LOGO_PATH);
  const year = new Date().getFullYear();

  const headerLogo = hasLogo
    ? `<img src="cid:smartpark-logo" alt="SmartPark" height="56" style="display: block; border: 0; height: 56px; width: auto;" />`
    : `<span style="font-size: 30px; font-weight: 800; color: #0053CC; letter-spacing: -0.5px;">SmartPark</span>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-top: 4px solid #0053CC; padding: 36px 36px 28px 36px; text-align: left;">
          
          <!-- Large Logo Header -->
          <tr>
            <td style="padding-bottom: 28px;">
              ${headerLogo}
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="font-size: 14px; line-height: 1.6; color: #334155;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; border-top: 1px solid #e2e8f0; font-size: 12px; line-height: 1.5; color: #64748b;">
              <p style="margin: 0;">SmartPark &mdash; Quezon City University Parking Management System (${year})</p>
              <p style="margin: 4px 0 0 0;">This is an automated message. Please do not reply directly to this email.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Send password reset OTP email
 */
export async function sendPasswordResetEmail(
  email: string,
  otp: string,
  firstName: string,
): Promise<boolean> {
  const htmlContent = buildEmailLayout(`
    <h1 style="margin: 0 0 18px 0; font-size: 26px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px;">
      Hi ${firstName},
    </h1>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Here is the SmartPark verification code you need to reset your account password:
    </p>

    <div style="background-color: #f1f5f9; padding: 26px 24px; text-align: center; margin-bottom: 24px;">
      <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #0053CC;">
        ${otp}
      </span>
    </div>

    <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This email was generated because of a password reset request for your SmartPark account. This verification code will expire in <strong style="color: #0f172a;">15 minutes</strong>.
    </p>

    <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      The verification code is required to complete the password reset. <strong style="color: #0f172a;">No one can reset your password without also accessing this email.</strong>
    </p>

    <p style="margin: 0 0 28px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      <strong style="color: #0f172a;">If you are not requesting a password reset</strong> then please ignore this email, and consider changing your password if you notice any unauthorized activity.
    </p>
  `);

  const textContent = `Hi ${firstName},

Here is the SmartPark verification code you need to reset your account password:

${otp}

This verification code will expire in 15 minutes. No one can reset your password without also accessing this email.

If you are not requesting a password reset, please ignore this email.

SmartPark - Quezon City University`;

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
      attachments: getLogoAttachment(),
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
    return {
      valid: false,
      message: "Password must be at least 8 characters long",
    };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one uppercase letter",
    };
  }
  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one lowercase letter",
    };
  }
  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one number",
    };
  }
  return { valid: true, message: "Password meets strength requirements" };
}

/**
 * Send email verification OTP
 */
export async function sendVerificationEmail(
  email: string,
  otp: string,
  firstName: string,
): Promise<boolean> {
  const htmlContent = buildEmailLayout(`
    <h1 style="margin: 0 0 18px 0; font-size: 26px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px;">
      Hi ${firstName},
    </h1>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Here is the SmartPark verification code you need to verify your email address:
    </p>

    <div style="background-color: #f1f5f9; padding: 26px 24px; text-align: center; margin-bottom: 24px;">
      <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #0053CC;">
        ${otp}
      </span>
    </div>

    <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This email was generated because a SmartPark account was registered using this email address. This code will expire in <strong style="color: #0f172a;">15 minutes</strong>.
    </p>

    <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      The verification code is required to activate your account. <strong style="color: #0f172a;">No one can verify this account without also accessing this email.</strong>
    </p>

    <p style="margin: 0 0 28px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      <strong style="color: #0f172a;">If you did not register this account</strong> then please ignore this email.
    </p>
  `);

  const textContent = `Hi ${firstName},

Here is the SmartPark verification code you need to verify your email address:

${otp}

This code will expire in 15 minutes. No one can verify this account without also accessing this email.

If you did not register this account, please ignore this email.

SmartPark - Quezon City University`;

  if (!transporter) {
    console.log(`[DEV MODE] Email verification OTP for ${email}: ${otp}`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "SmartPark <noreply@smartpark.com>",
      to: email,
      subject: "Verify Your SmartPark Account",
      text: textContent,
      html: htmlContent,
      attachments: getLogoAttachment(),
    });
    console.log(`Email verification OTP sent to ${email}`);
    return true;
  } catch (error) {
    console.error("Failed to send verification email:", error);
    return false;
  }
}

/**
 * Send account activation email for newly created Admin or Guard accounts
 */
export async function sendAccountActivationEmail(
  email: string,
  firstName: string,
  role: string,
  activationToken: string,
): Promise<boolean> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const activationLink = `${frontendUrl}/activate-account?token=${encodeURIComponent(activationToken)}`;

  const roleDisplay =
    role.toUpperCase() === "SUPER_ADMIN"
      ? "Super Administrator"
      : role.toUpperCase() === "ADMIN"
        ? "Administrator"
        : role.toUpperCase() === "GUARD"
          ? "Security Guard"
          : role;

  const htmlContent = buildEmailLayout(`
    <h1 style="margin: 0 0 18px 0; font-size: 26px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px;">
      Hi ${firstName},
    </h1>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      An official <strong style="color: #0f172a;">${roleDisplay}</strong> personnel account has been created for you on QCU SmartPark. Click the button below to verify your email and activate your account:
    </p>

    <div style="background-color: #f1f5f9; padding: 24px; text-align: center; margin-bottom: 24px;">
      <a href="${activationLink}" style="display: inline-block; background-color: #0053CC; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 28px; border-radius: 4px;">
        Activate Account
      </a>
    </div>

    <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This email was generated for personnel account onboarding. This activation link is valid for <strong style="color: #0f172a;">3 days (72 hours)</strong>.
    </p>

    <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      If the button above does not work, copy and paste this link into your browser:<br />
      <a href="${activationLink}" style="color: #0053CC; word-break: break-all;">${activationLink}</a>
    </p>

    <p style="margin: 0 0 28px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      <strong style="color: #0f172a;">If you were not expecting this invitation</strong> then please contact your system administrator.
    </p>
  `);

  const textContent = `Hi ${firstName},

An official ${roleDisplay} personnel account has been created for you on QCU SmartPark.

Activate your account within 3 days using this link:
${activationLink}

If you were not expecting this invitation, please contact your system administrator.

SmartPark - Quezon City University`;

  if (!transporter) {
    console.log(`[DEV MODE] Activation email for ${email} (${roleDisplay}):`);
    console.log(`[DEV MODE] Activation Link: ${activationLink}`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "SmartPark <noreply@smartpark.com>",
      to: email,
      subject: `Activate Your SmartPark ${roleDisplay} Account`,
      text: textContent,
      html: htmlContent,
      attachments: getLogoAttachment(),
    });
    console.log(`Activation email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error("Failed to send activation email:", error);
    return false;
  }
}
