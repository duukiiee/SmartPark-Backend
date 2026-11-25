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
 * Clean, minimal official layout with large centered logo
 */
function buildEmailLayout(bodyHtml: string): string {
  const hasLogo = fs.existsSync(LOGO_PATH);
  const year = new Date().getFullYear();

  const headerLogo = hasLogo
    ? `<img src="cid:smartpark-logo" alt="SmartPark" height="84" style="display: block; margin: 0 auto; border: 0; height: 84px; width: auto;" />`
    : `<span style="font-size: 34px; font-weight: 800; color: #0053CC; letter-spacing: -0.5px;">SmartPark</span>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f6f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 40px 36px 32px 36px; text-align: left;">
          
          <!-- Centered Large Logo Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px; border-bottom: 1px solid #e2e8f0;">
              ${headerLogo}
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="padding-top: 28px; font-size: 14px; line-height: 1.65; color: #334155;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 28px; border-top: 1px solid #e2e8f0; font-size: 12px; line-height: 1.5; color: #64748b; text-align: center;">
              <p style="margin: 0;">SmartPark &bull; Quezon City University Parking Management System (${year})</p>
              <p style="margin: 4px 0 0 0;">This is an automated system message. Please do not reply to this email.</p>
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
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
      Hi ${firstName},
    </h1>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Here is the SmartPark verification code you need to reset your account password:
    </p>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 24px; text-align: center; margin-bottom: 24px;">
      <span style="font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #0053CC;">
        ${otp}
      </span>
    </div>

    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This code will expire in <strong style="color: #0f172a;">15 minutes</strong>. No one can reset your password without accessing this email.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      If you did not request a password reset, you can safely ignore this email.
    </p>
  `);

  const textContent = `Hi ${firstName},

Here is the SmartPark verification code you need to reset your account password:

${otp}

This verification code will expire in 15 minutes. No one can reset your password without accessing this email.

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
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
      Hi ${firstName},
    </h1>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Here is the SmartPark verification code you need to verify your email address:
    </p>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 24px; text-align: center; margin-bottom: 24px;">
      <span style="font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #0053CC;">
        ${otp}
      </span>
    </div>

    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This code will expire in <strong style="color: #0f172a;">15 minutes</strong> and is required to activate your account.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      If you did not register a SmartPark account, please ignore this email.
    </p>
  `);

  const textContent = `Hi ${firstName},

Here is the SmartPark verification code you need to verify your email address:

${otp}

This code will expire in 15 minutes. No one can verify this account without accessing this email.

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
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
      Hi ${firstName},
    </h1>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      An official <strong style="color: #0f172a;">${roleDisplay}</strong> account has been created for you on QCU SmartPark. Click the button below to verify your email and activate your account:
    </p>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${activationLink}" style="display: inline-block; background-color: #0053CC; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 13px 28px; border-radius: 5px;">
        Activate Account
      </a>
    </div>

    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This activation link is valid for <strong style="color: #0f172a;">3 days (72 hours)</strong>. If the button does not work, copy and paste this link into your browser:
    </p>

    <p style="margin: 0 0 20px 0; font-size: 13px; line-height: 1.5; word-break: break-all;">
      <a href="${activationLink}" style="color: #0053CC;">${activationLink}</a>
    </p>

    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      If you were not expecting this invitation, please contact your system administrator.
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

/**
 * Send account suspension notification email (Clean, formal, no AI clutter)
 */
export async function sendAccountSuspensionEmail(
  email: string,
  firstName: string,
  reason: string,
  suspendedUntil?: Date | string | null,
  durationText?: string,
): Promise<boolean> {
  const endDate = suspendedUntil ? new Date(suspendedUntil) : null;
  const isEndDateValid = endDate && !isNaN(endDate.getTime());

  let durationDisplay = durationText || "Temporarily Suspended";
  let endDateDisplay = "Until further notice / Pending review";

  if (isEndDateValid && endDate) {
    endDateDisplay = endDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (!durationText) {
      const diffMs = endDate.getTime() - Date.now();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays > 365 * 10) {
        durationDisplay = "Permanent / Indefinite";
      } else if (diffDays > 0) {
        durationDisplay = `${diffDays} Day${diffDays > 1 ? "s" : ""}`;
      } else {
        durationDisplay = "Immediate / Pending Review";
      }
    }
  }

  const htmlContent = buildEmailLayout(`
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
      Notice of Account Suspension
    </h1>
    <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Hi ${firstName},
    </p>
    <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      Please be informed that your <strong style="color: #0f172a;">SmartPark</strong> account has been suspended by the campus administration. Below are the details of this action:
    </p>

    <!-- Clean Summary Table -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 24px; font-size: 14px;">
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; width: 36%; border-bottom: 1px solid #e2e8f0;">Status</td>
        <td style="padding: 12px 16px; color: #b91c1c; font-weight: 700; border-bottom: 1px solid #e2e8f0;">Suspended</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Reason</td>
        <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${reason || "Violation of campus parking regulations"}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Duration</td>
        <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${durationDisplay}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600;">Suspended Until</td>
        <td style="padding: 12px 16px; color: #0f172a;">${endDateDisplay}</td>
      </tr>
    </table>

    <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #0f172a;">
      What this means for your account:
    </p>
    <ul style="margin: 0 0 22px 0; padding-left: 20px; font-size: 14px; color: #475569; line-height: 1.65;">
      <li style="margin-bottom: 4px;">Portal login access is disabled while the suspension is active.</li>
      <li style="margin-bottom: 4px;">Campus parking privileges for vehicles linked to your account are temporarily halted.</li>
      <li>Your access will automatically resume once the suspension period ends.</li>
    </ul>

    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      If you believe this was issued in error or wish to file an appeal, please visit the <strong style="color: #0f172a;">Campus Security and Administration Office</strong>.
    </p>
  `);

  const textContent = `Notice of Account Suspension - SmartPark

Hi ${firstName},

Please be informed that your SmartPark account has been suspended by the campus administration.

Suspension Details:
- Status: Suspended
- Reason: ${reason || "Violation of campus parking regulations"}
- Duration: ${durationDisplay}
- Suspended Until: ${endDateDisplay}

During this period:
- Portal login access is disabled while the suspension is active.
- Campus parking privileges for vehicles linked to your account are temporarily halted.
- Your access will automatically resume once the suspension period ends.

If you believe this was issued in error or wish to file an appeal, please visit the Campus Security and Administration Office.

SmartPark - Quezon City University`;

  if (!transporter) {
    console.log(`[DEV MODE] Account suspension email for ${email}:`);
    console.log(
      `[DEV MODE] Reason: ${reason}, Duration: ${durationDisplay}, Until: ${endDateDisplay}`,
    );
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "SmartPark <noreply@smartpark.com>",
      to: email,
      subject: "Notice of Account Suspension - SmartPark",
      text: textContent,
      html: htmlContent,
      attachments: getLogoAttachment(),
    });
    console.log(`Suspension email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error("Failed to send suspension email:", error);
    return false;
  }
}

/**
 * Send account deactivation notification email (Clean, formal, no AI clutter)
 */
export async function sendAccountDeactivationEmail(
  email: string,
  firstName: string,
  reason?: string | null,
): Promise<boolean> {
  const currentDateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const htmlContent = buildEmailLayout(`
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
      Notice of Account Deactivation
    </h1>
    <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Hi ${firstName},
    </p>
    <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This is an official notice to inform you that your <strong style="color: #0f172a;">SmartPark</strong> account has been permanently deactivated by the campus administration.
    </p>

    <!-- Clean Summary Table -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 24px; font-size: 14px;">
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; width: 36%; border-bottom: 1px solid #e2e8f0;">Status</td>
        <td style="padding: 12px 16px; color: #0f172a; font-weight: 700; border-bottom: 1px solid #e2e8f0;">Permanently Deactivated</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; ${reason ? "border-bottom: 1px solid #e2e8f0;" : ""}">Effective Date</td>
        <td style="padding: 12px 16px; color: #0f172a; ${reason ? "border-bottom: 1px solid #e2e8f0;" : ""}">${currentDateStr}</td>
      </tr>
      ${
        reason
          ? `<tr>
              <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600;">Reason</td>
              <td style="padding: 12px 16px; color: #0f172a;">${reason}</td>
            </tr>`
          : ""
      }
    </table>

    <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #0f172a;">
      What this means for your account:
    </p>
    <ul style="margin: 0 0 22px 0; padding-left: 20px; font-size: 14px; color: #475569; line-height: 1.65;">
      <li style="margin-bottom: 4px;">Login access to the SmartPark system is permanently disabled.</li>
      <li style="margin-bottom: 4px;">All vehicle parking permits and QR passes under this account are voided.</li>
      <li>Campus parking privileges have been revoked.</li>
    </ul>

    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      If you have questions or believe this action was taken in error, please contact the <strong style="color: #0f172a;">Quezon City University SmartPark Administration Office</strong>.
    </p>
  `);

  const textContent = `Notice of Account Deactivation - SmartPark

Hi ${firstName},

This is an official notice to inform you that your SmartPark account has been permanently deactivated by the campus administration on ${currentDateStr}.
${reason ? `\nReason: ${reason}` : ""}

What this means:
- Login access to the SmartPark system is permanently disabled.
- All vehicle parking permits and QR passes under this account are voided.
- Campus parking privileges have been revoked.

If you have questions or believe this action was taken in error, please contact the Quezon City University SmartPark Administration Office.

SmartPark - Quezon City University`;

  if (!transporter) {
    console.log(`[DEV MODE] Account deactivation email for ${email}:`);
    console.log(`[DEV MODE] Reason: ${reason || "N/A"}`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "SmartPark <noreply@smartpark.com>",
      to: email,
      subject: "Notice of Account Deactivation - SmartPark",
      text: textContent,
      html: htmlContent,
      attachments: getLogoAttachment(),
    });
    console.log(`Deactivation email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error("Failed to send deactivation email:", error);
    return false;
  }
}

export interface IncidentNoticeDetails {
  referenceId: string;
  reportType: string;
  vehicleType: string;
  plateNumber: string;
  model?: string | null;
  color?: string | null;
  description: string;
  createdAt?: Date | string;
}

/**
 * Send incident report advisory notice to the registered vehicle owner
 */
export async function sendIncidentReportNoticeEmail(
  email: string,
  firstName: string,
  incident: IncidentNoticeDetails,
): Promise<boolean> {
  const incidentDate = incident.createdAt
    ? new Date(incident.createdAt)
    : new Date();
  const formattedDate = incidentDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const vehicleSummary = `${incident.plateNumber} (${[incident.color, incident.model].filter((x) => x && x !== "--").join(" ") || incident.vehicleType})`;

  const htmlContent = buildEmailLayout(`
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
      Notice of Parking Incident Report
    </h1>
    <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Hi ${firstName},
    </p>
    <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      This is an official notice to inform you that a parking incident report has been filed on campus regarding a vehicle registered under your name in the <strong style="color: #0f172a;">SmartPark</strong> system.
    </p>

    <!-- Clean Summary Table -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 24px; font-size: 14px;">
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; width: 36%; border-bottom: 1px solid #e2e8f0;">Reference ID</td>
        <td style="padding: 12px 16px; color: #0053CC; font-weight: 700; border-bottom: 1px solid #e2e8f0;">${incident.referenceId}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Report Type</td>
        <td style="padding: 12px 16px; color: #0f172a; font-weight: 600; border-bottom: 1px solid #e2e8f0;">${incident.reportType}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Vehicle Involved</td>
        <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${vehicleSummary}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Date Reported</td>
        <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${formattedDate}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; vertical-align: top;">Report Details</td>
        <td style="padding: 12px 16px; color: #334155; line-height: 1.5;">${incident.description || "No additional description provided."}</td>
      </tr>
    </table>

    <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #0f172a;">
      Important Advisory:
    </p>
    <ul style="margin: 0 0 22px 0; padding-left: 20px; font-size: 14px; color: #475569; line-height: 1.65;">
      <li style="margin-bottom: 4px;">If your vehicle is currently parked in an obstructive slot, driveway, or unauthorized zone, please check and reposition it immediately.</li>
      <li style="margin-bottom: 4px;">Unaddressed parking violations may lead to temporary account or campus parking suspension.</li>
      <li>If you believe this report was filed in error or require clarification, please visit the <strong style="color: #0f172a;">Campus Security or Administration Office</strong>.</li>
    </ul>

    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      Thank you for your prompt attention to this matter.
    </p>
  `);

  const textContent = `Notice of Parking Incident Report - SmartPark

Hi ${firstName},

An incident report has been filed regarding a vehicle registered under your account in SmartPark.

Report Details:
- Reference ID: ${incident.referenceId}
- Report Type: ${incident.reportType}
- Vehicle: ${vehicleSummary}
- Date Reported: ${formattedDate}
- Details: ${incident.description || "N/A"}

Advisory:
- If your vehicle is currently parked in an obstructive slot, driveway, or unauthorized zone, please check and reposition it immediately.
- Unaddressed parking violations may lead to temporary account or campus parking suspension.
- If you believe this report was filed in error or require clarification, please visit the Campus Security or Administration Office.

SmartPark - Quezon City University`;

  if (!transporter) {
    console.log(
      `[DEV MODE] Incident notice email for ${email} (${incident.referenceId}):`,
    );
    console.log(
      `[DEV MODE] Vehicle: ${vehicleSummary}, Type: ${incident.reportType}`,
    );
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "SmartPark <noreply@smartpark.com>",
      to: email,
      subject: `Notice of Parking Incident Report (${incident.referenceId}) - SmartPark`,
      text: textContent,
      html: htmlContent,
      attachments: getLogoAttachment(),
    });
    console.log(
      `Incident notice email sent successfully to ${email} for Ref: ${incident.referenceId}`,
    );
    return true;
  } catch (error) {
    console.error("Failed to send incident notice email:", error);
    return false;
  }
}

export interface IncidentRejectionDetails {
  referenceId: string;
  reportType: string;
  vehicleType: string;
  plateNumber: string;
  rejectionReason: string;
  reviewedBy?: string | null;
  reviewedAt?: Date | string;
  createdAt?: Date | string;
}

/**
 * Send incident rejection / disapproval notice to the reporter
 */
export async function sendIncidentReportRejectionEmail(
  email: string,
  firstName: string,
  details: IncidentRejectionDetails,
): Promise<boolean> {
  const reviewDate = details.reviewedAt
    ? new Date(details.reviewedAt)
    : new Date();
  const formattedReviewDate = reviewDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const htmlContent = buildEmailLayout(`
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
      Notice of Incident Report Disapproval
    </h1>
    <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Hi ${firstName},
    </p>
    <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      Thank you for submitting an incident report to <strong style="color: #0f172a;">SmartPark</strong>. After reviewing your submission, the campus administration could not validate or proceed with the report. Below are the review details:
    </p>

    <!-- Clean Summary Table -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 24px; font-size: 14px;">
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; width: 36%; border-bottom: 1px solid #e2e8f0;">Reference ID</td>
        <td style="padding: 12px 16px; color: #0053CC; font-weight: 700; border-bottom: 1px solid #e2e8f0;">${details.referenceId}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Status</td>
        <td style="padding: 12px 16px; color: #b91c1c; font-weight: 700; border-bottom: 1px solid #e2e8f0;">Disapproved</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Report Type</td>
        <td style="padding: 12px 16px; color: #0f172a; font-weight: 600; border-bottom: 1px solid #e2e8f0;">${details.reportType}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Vehicle Involved</td>
        <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${details.plateNumber} (${details.vehicleType})</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Date Reviewed</td>
        <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${formattedReviewDate}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; background-color: #f8fafc; color: #64748b; font-weight: 600; vertical-align: top;">Reason</td>
        <td style="padding: 12px 16px; color: #0f172a; line-height: 1.5;">${details.rejectionReason}</td>
      </tr>
    </table>

    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      If you have additional photo evidence or further details to support your report, you may submit a new report through the portal or visit the <strong style="color: #0f172a;">Campus Security or Administration Office</strong>.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
      Thank you for helping keep Quezon City University parking safe and orderly.
    </p>
  `);

  const textContent = `Notice of Incident Report Disapproval - SmartPark

Hi ${firstName},

Thank you for submitting an incident report to SmartPark. After reviewing your submission, the campus administration could not validate or proceed with the report.

Report Details:
- Reference ID: ${details.referenceId}
- Status: Disapproved
- Report Type: ${details.reportType}
- Vehicle: ${details.plateNumber} (${details.vehicleType})
- Date Reviewed: ${formattedReviewDate}
- Reason: ${details.rejectionReason}

If you have additional photo evidence or further details, you may submit a new report or contact the Campus Security or Administration Office.

SmartPark - Quezon City University`;

  if (!transporter) {
    console.log(
      `[DEV MODE] Incident rejection email for ${email} (${details.referenceId}): Reason: ${details.rejectionReason}`,
    );
    return true;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "SmartPark <noreply@smartpark.com>",
      to: email,
      subject: `Notice of Incident Report Disapproval (${details.referenceId}) - SmartPark`,
      text: textContent,
      html: htmlContent,
      attachments: getLogoAttachment(),
    });
    console.log(
      `Incident rejection email sent successfully to ${email} for Ref: ${details.referenceId}`,
    );
    return true;
  } catch (error) {
    console.error("Failed to send incident rejection email:", error);
    return false;
  }
}
