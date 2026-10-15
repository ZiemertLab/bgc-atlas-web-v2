import nodemailer from 'nodemailer';

/** Null when mail is not configured, so callers skip sending rather than fail the request. */
export const buildMailTransport = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.FROM_EMAIL;

  if (!host || !port || !from) return null;

  const secure = port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    // Optional: production relays through a loopback msmtpd that holds the credential itself.
    ...(user && pass ? { auth: { user, pass } } : {}),
    // A local relay usually presents a self-signed cert, which nodemailer rejects on
    // STARTTLS. Skip TLS for the loopback hop only; the relay encrypts its onward hop.
    ...(host === '127.0.0.1' || host === 'localhost' ? { ignoreTLS: true } : {}),
  });

  return { transporter, from };
};
