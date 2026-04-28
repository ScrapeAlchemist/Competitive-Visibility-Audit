// =====================================================
// SMTP email wrapper - reads SMTP config from env at send time
// so missing creds don't block dev/build.
// =====================================================

import nodemailer from 'nodemailer';

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function readConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  if (!host || !user || !pass || !from) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user,
    pass,
    from,
  };
}

export function isEmailConfigured(): boolean {
  return readConfig() !== null;
}

export interface SendReportArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendReport(args: SendReportArgs): Promise<void> {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error(
      'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in .env.local'
    );
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transporter.sendMail({
    from: cfg.from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
}
