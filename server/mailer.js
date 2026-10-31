// SMTP is configured only through env; without it the mailer reports itself
// unconfigured so callers fail loudly instead of pretending a code was sent.
export function createMailer(env = process.env) {
  const host = env.RESUME_PROTOCOL_SMTP_HOST;
  const user = env.RESUME_PROTOCOL_SMTP_USER;
  const pass = env.RESUME_PROTOCOL_SMTP_PASS;
  if (!host || !user || !pass) return { configured: false, async send() { throw mailError("邮件服务未配置，暂时无法发送验证码。", 503); } };
  const port = Number(env.RESUME_PROTOCOL_SMTP_PORT || 465);
  // nodemailer loads only when a code is actually sent, keeping it off app startup.
  let transport;
  const connect = async () => transport ??= (await import("nodemailer")).default.createTransport({
    host, port,
    secure: env.RESUME_PROTOCOL_SMTP_SECURE ? env.RESUME_PROTOCOL_SMTP_SECURE === "true" : port === 465,
    auth: { user, pass },
  });
  const from = env.RESUME_PROTOCOL_SMTP_FROM || `Loomi <${user}>`;
  return {
    configured: true,
    async send({ to, subject, text }) {
      try {
        await (await connect()).sendMail({ from, to, subject, text });
      } catch {
        throw mailError("验证码邮件发送失败，请稍后再试。", 502);
      }
    },
  };
}

export function passwordResetEmail(code, minutes) {
  return {
    subject: `Loomi 重置密码验证码：${code}`,
    text: `你的重置密码验证码是 ${code}，${minutes} 分钟内有效。\n\n如果不是你本人操作，请忽略这封邮件，你的密码不会改变。`,
  };
}

function mailError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}
