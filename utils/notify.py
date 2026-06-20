"""
Email notifications for pipeline scripts (SMTP).

Configure in `.env` or GitHub Actions secrets:
  NOTIFY_EMAIL, SMTP_USER, SMTP_PASSWORD
Optional: SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 587), SMTP_FROM
"""
from __future__ import annotations

import os
import smtplib
import traceback
from email.message import EmailMessage
from typing import Literal

NotifyLevel = Literal["info", "success", "error"]


def _email_configured() -> bool:
    return bool(
        os.environ.get("NOTIFY_EMAIL")
        and os.environ.get("SMTP_USER")
        and os.environ.get("SMTP_PASSWORD")
    )


def send_email(subject: str, body: str) -> bool:
    """Send email via SMTP. Returns False if skipped or failed; never raises."""
    to_addr = os.environ.get("NOTIFY_EMAIL", "").strip()
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_pass = os.environ.get("SMTP_PASSWORD", "").strip()
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip()
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    from_addr = os.environ.get("SMTP_FROM", smtp_user).strip()

    if not all([to_addr, smtp_user, smtp_pass]):
        print("[notify] Email skipped — set NOTIFY_EMAIL, SMTP_USER, SMTP_PASSWORD in .env")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.set_content(body.strip())

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(smtp_user, smtp_pass)
            smtp.send_message(msg)
        print(f"[notify] Email sent to {to_addr}")
        return True
    except Exception as e:
        print(f"[notify] Email failed: {e}")
        return False


def notify(title: str, detail: str = "", *, level: NotifyLevel = "info") -> bool:
    prefix = {"info": "Guamap", "success": "Guamap OK", "error": "Guamap FAIL"}[level]
    subject = f"{prefix}: {title}"
    lines = [title]
    if detail.strip():
        lines.append("")
        lines.append(detail.strip())
    return send_email(subject, "\n".join(lines))


def notify_exception(title: str, exc: BaseException) -> bool:
    tb = "".join(traceback.format_exception_only(type(exc), exc)).strip()
    return notify(title, tb, level="error")
