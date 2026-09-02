import nodemailer from "nodemailer";

/**
 * The mail transport seam.
 *
 * The outbox worker (Task 23) depends only on this `Transport` interface, so
 * tests inject a fake that records calls and production injects
 * `nodemailerTransport()`. Nothing else in `notify/` imports `nodemailer`.
 *
 * `nodemailer` is a plain npm package (not `@prisma/client`), so the value
 * import is fine under the `src/server/**` eslint boundary.
 */

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface Transport {
  send(msg: OutgoingMail): Promise<void>;
}

/**
 * The real transport: one SMTP connection from `SMTP_URL` (Mailpit on
 * `localhost:1025` in local dev). Constructed lazily by the worker — never at
 * module load — so importing this file never opens a socket.
 */
export function nodemailerTransport(): Transport {
  const url = process.env.SMTP_URL;
  if (!url) throw new Error("SMTP_URL is not set");

  const transporter = nodemailer.createTransport(url);
  const from = process.env.MAIL_FROM ?? "Keel <no-reply@keel.local>";

  return {
    async send(msg) {
      await transporter.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    },
  };
}
