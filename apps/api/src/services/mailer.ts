/**
 * Optional email infrastructure.
 *
 * SMTP is NOT required for the current authentication flow. Google OIDC establishes
 * identity without sending mail, so this module is disabled unless SMTP is explicitly
 * configured through environment variables.
 *
 * It exists so future features (password reset, email verification, magic links,
 * product notifications) can be added without coupling authentication to one provider.
 */

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
};

export function getMailConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER?.trim() || null,
    // Never log or return this value.
    password: process.env.SMTP_PASSWORD ?? null,
    from,
  };
}

export function isEmailEnabled(): boolean {
  return getMailConfig() !== null;
}

/**
 * Sends mail when SMTP is configured. Returns a result instead of throwing so callers
 * can degrade gracefully when email infrastructure is intentionally absent.
 */
export async function sendMail(mail: OutboundMail): Promise<{ sent: boolean; reason?: string }> {
  const config = getMailConfig();
  if (!config) return { sent: false, reason: "email_disabled" };
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    });
    await transport.sendMail({ from: config.from, to: mail.to, subject: mail.subject, text: mail.text });
    return { sent: true };
  } catch (error) {
    // Log the failure reason only; never the credentials or message body.
    console.error("Email delivery failed:", error instanceof Error ? error.message : "unknown error");
    return { sent: false, reason: "send_failed" };
  }
}
