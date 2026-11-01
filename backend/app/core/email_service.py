"""
Email service for sending transactional emails via SMTP.

Without SMTP configured, a mail is not sent and only its subject and the
recipient's domain are logged, so local dev and environments without email
credentials work without errors.
"""

import asyncio
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EmailService:
    """Send transactional emails using SMTP or log them when unconfigured."""

    def __init__(self):
        self._frontend_url = (settings.FRONTEND_URL or "").rstrip("/")

    def _build_message(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: str,
    ) -> MIMEMultipart:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to_email
        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        return msg

    def _send_smtp(self, to_email: str, msg: MIMEMultipart) -> None:
        context = ssl.create_default_context()
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM, to_email, msg.as_string())

    async def _send(self, to_email: str, subject: str, html_body: str, text_body: str) -> bool:
        msg = self._build_message(to_email, subject, html_body, text_body)
        # Bodies carry live reset and verification links, so the log gets the
        # recipient's domain and the subject, never the body or the mailbox.
        domain = to_email.rpartition("@")[2]
        if not settings.email_enabled:
            logger.info("SMTP not configured, email not sent: domain=%s subject=%s", domain, subject)
            return True
        try:
            await asyncio.to_thread(self._send_smtp, to_email, msg)
            logger.info("Email sent: domain=%s subject=%s", domain, subject)
            return True
        except Exception as exc:
            logger.error("Failed to send email: domain=%s error=%s", domain, type(exc).__name__)
            return False

    async def send_verification_email(self, to_email: str, token: str) -> bool:
        verify_url = f"{self._frontend_url}/auth/verify-email?token={token}&email={to_email}"
        subject = "Verify your Aspiro account"
        text_body = (
            f"Welcome to Aspiro!\n\n"
            f"Please verify your email address by visiting:\n{verify_url}\n\n"
            f"This link expires in 24 hours. If you did not create an account, "
            f"you can safely ignore this email."
        )
        html_body = f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#1a56db;">Verify your Aspiro account</h2>
  <p>Welcome to Aspiro! Click the button below to verify your email address.</p>
  <p style="margin:32px 0;">
    <a href="{verify_url}"
       style="background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;
              text-decoration:none;font-weight:600;">
      Verify Email
    </a>
  </p>
  <p style="color:#6b7280;font-size:14px;">
    This link expires in 24 hours. If you did not create an account, you can safely ignore this email.
  </p>
  <p style="color:#6b7280;font-size:12px;">
    Or copy this URL into your browser:<br>{verify_url}
  </p>
</body>
</html>"""
        return await self._send(to_email, subject, html_body, text_body)

    async def send_password_reset_email(self, to_email: str, token: str) -> bool:
        reset_url = f"{self._frontend_url}/auth/reset-password?token={token}"
        subject = "Reset your Aspiro password"
        text_body = (
            f"You requested a password reset for your Aspiro account.\n\n"
            f"Click the link below to set a new password:\n{reset_url}\n\n"
            f"This link expires in 1 hour. If you did not request a password reset, "
            f"you can safely ignore this email."
        )
        html_body = f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#1a56db;">Reset your Aspiro password</h2>
  <p>We received a request to reset the password for your account.</p>
  <p style="margin:32px 0;">
    <a href="{reset_url}"
       style="background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;
              text-decoration:none;font-weight:600;">
      Reset Password
    </a>
  </p>
  <p style="color:#6b7280;font-size:14px;">
    This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.
  </p>
  <p style="color:#6b7280;font-size:12px;">
    Or copy this URL into your browser:<br>{reset_url}
  </p>
</body>
</html>"""
        return await self._send(to_email, subject, html_body, text_body)


# Module-level singleton
_email_service: Optional[EmailService] = None


def get_email_service() -> EmailService:
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
