"""
LINE Bot service layer.

Handles:
  - Incoming webhook event routing
  - /link  — issue a linking token and send the connect URL
  - /add   — record a shared expense and split equally among group members
  - /balance — compute and display net balances per member
  - /settle  — mark a debt as settled
  - /help    — command reference
  - Account linking confirmation (called from the REST API)
"""

import hashlib
import hmac
import base64
import json
import logging
import random
import re
import time as _time
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from uuid import UUID

import httpx
from sqlalchemy import func as sqlfunc, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import async_session
from app.modules.line_bot.models import (
    LineGroup,
    LineGroupMember,
    LineUserLink,
    SharedExpense,
)
from app.modules.line_bot.quick_log import FALLBACK_CATEGORY, guess_category_name, parse_quick_entry
from app.modules.line_bot.repositories import (
    LineAccountRepository,
    LineGroupRepository,
    SharedExpenseRepository,
)
from app.modules.line_bot.schemas import (
    BalanceEntry,
    ExpenseCreateRequest,
    ExpenseOut,
    ExpenseUpdateRequest,
    GroupBalanceResponse,
    GroupOut,
    LiffSessionResponse,
    LineEvent,
    LinkConfirmResponse,
    LinkPreviewResponse,
    LinkStatusResponse,
    MemberOut,
    SettleRequest,
    SettleResponse,
    SplitInput,
    SplitOut,
)
from app.modules.goals.models import Goal, GoalStatus
from app.modules.portfolio.models import Portfolio, PortfolioHolding
from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
    TransactionType,
    TransactionWalletType,
    PaymentMethod,
)
from app.modules.transactions.repositories import (
    TransactionRepository,
)
from app.modules.users.models import UserStatus
from app.modules.users.security import jwt_manager
from app.utils.exchange_rate_service import ExchangeRateService
from app.utils.datetime_helpers import business_day_of, business_now, business_today

logger = logging.getLogger(__name__)
settings = get_settings()

LINK_TOKEN_TTL_MINUTES = 15
LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------


def verify_line_signature(body: bytes, signature: str) -> bool:
    """Return True if the X-Line-Signature header matches the body."""
    if not settings.LINE_CHANNEL_SECRET:
        return False
    mac = hmac.new(
        settings.LINE_CHANNEL_SECRET.encode("utf-8"), body, hashlib.sha256
    ).digest()
    expected = base64.b64encode(mac).decode("utf-8")
    return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# LINE Messaging API helper
# ---------------------------------------------------------------------------


_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    """Shared httpx client for all LINE API calls.

    Reuses one connection pool (keep-alive) instead of opening a fresh TLS
    connection on every push/reply/profile lookup. Safe to share across
    coroutines; per-request timeouts are passed at the call site. The client
    lives for the process lifetime — no explicit close needed.
    """
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=10.0)
    return _http_client


async def _send(reply_token: str, messages: list[dict]) -> None:
    if not settings.LINE_CHANNEL_ACCESS_TOKEN:
        logger.warning("LINE_CHANNEL_ACCESS_TOKEN not set — skipping reply")
        return
    try:
        resp = await _get_http_client().post(
            LINE_REPLY_URL,
            json={"replyToken": reply_token, "messages": messages},
            headers={"Authorization": f"Bearer {settings.LINE_CHANNEL_ACCESS_TOKEN}"},
        )
        if resp.status_code != 200:
            logger.error("LINE reply failed: %s %s", resp.status_code, resp.text)
    except Exception as exc:
        logger.error("LINE reply error: %s", exc)


async def _reply(reply_token: str, text: str, quick_replies: list[dict] | None = None) -> None:
    msg: dict = {"type": "text", "text": text}
    if quick_replies:
        msg["quickReply"] = {"items": quick_replies}
    await _send(reply_token, [msg])


async def _reply_flex(reply_token: str, alt_text: str, contents: dict, quick_replies: list[dict] | None = None) -> None:
    msg: dict = {"type": "flex", "altText": alt_text, "contents": contents}
    if quick_replies:
        msg["quickReply"] = {"items": quick_replies}
    await _send(reply_token, [msg])


# ---------------------------------------------------------------------------
# Quick reply builders
# ---------------------------------------------------------------------------


def _qr_message(label: str, text: str) -> dict:
    return {"type": "action", "action": {"type": "message", "label": label, "text": text}}


def _qr_postback(label: str, data: str, display_text: str) -> dict:
    return {"type": "action", "action": {"type": "postback", "label": label, "data": data, "displayText": display_text}}


GROUP_QR = [
    _qr_postback("📋 Menu", "cmd=menu", "Menu"),
    _qr_postback("💰 Add", "cmd=add_start", "Add expense"),
    _qr_postback("⚖️ Balance", "cmd=balance", "Check balance"),
    _qr_postback("📜 History", "cmd=history", "Show history"),
]

DM_QR = [
    _qr_postback("📋 Menu", "cmd=menu", "Menu"),
    _qr_postback("📊 Balance", "cmd=balance", "Check balance"),
    _qr_postback("🎯 Goals", "cmd=goals", "View goals"),
    _qr_postback("📈 Portfolio", "cmd=portfolio", "Portfolio"),
    _qr_postback("💱 Rates", "cmd=rate", "Exchange rates"),
]


# ---------------------------------------------------------------------------
# Flex message builders
# ---------------------------------------------------------------------------


def _flex_expense_confirm(
    description: str,
    amount: Decimal,
    currency: str,
    payer_name: str,
    split_desc: str,
) -> dict:
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#06C755",
            "contents": [
                {"type": "text", "text": "Expense Added", "color": "#ffffff", "weight": "bold", "size": "md"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [
                {"type": "text", "text": description, "weight": "bold", "size": "xl", "wrap": True},
                {
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "md",
                    "contents": [
                        {"type": "text", "text": "Amount", "size": "sm", "color": "#888888", "flex": 2},
                        {"type": "text", "text": f"{currency} {amount:,.0f}", "size": "sm", "weight": "bold", "flex": 3, "align": "end"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Paid by", "size": "sm", "color": "#888888", "flex": 2},
                        {"type": "text", "text": payer_name, "size": "sm", "flex": 3, "align": "end"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Split", "size": "sm", "color": "#888888", "flex": 2},
                        {"type": "text", "text": split_desc, "size": "sm", "flex": 3, "align": "end", "wrap": True},
                    ],
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "Balance", "data": "cmd=balance", "displayText": "Check balance"},
                    "style": "primary",
                    "color": "#06C755",
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


def _flex_balance(
    balances: list[BalanceEntry],
    currency: str,
    names: dict,
) -> dict:
    if not balances:
        rows = [{"type": "text", "text": "All settled up! 🎉", "align": "center", "color": "#06C755", "weight": "bold"}]
    else:
        rows = []
        for b in balances:
            owed_by = names.get(str(b.owed_by), str(b.owed_by)[:8])
            owed_to = names.get(str(b.owed_to), str(b.owed_to)[:8])
            rows.append({
                "type": "box",
                "layout": "horizontal",
                "margin": "sm",
                "contents": [
                    {
                        "type": "box",
                        "layout": "vertical",
                        "flex": 5,
                        "contents": [
                            {"type": "text", "text": owed_by, "size": "sm", "weight": "bold"},
                            {"type": "text", "text": f"→ {owed_to}", "size": "xs", "color": "#888888"},
                        ],
                    },
                    {
                        "type": "text",
                        "text": f"{currency} {b.amount:,.0f}",
                        "size": "sm",
                        "weight": "bold",
                        "color": "#E53E3E",
                        "align": "end",
                        "flex": 3,
                        "gravity": "center",
                    },
                ],
            })

    settle_footer: list[dict] = []
    if balances:
        settle_footer = [{
            "type": "button",
            "action": {"type": "postback", "label": "Settle up", "data": "cmd=settle_start", "displayText": "Settle up"},
            "style": "primary",
            "color": "#06C755",
            "height": "sm",
        }]

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "contents": [
                {"type": "text", "text": "Group Balances", "color": "#ffffff", "weight": "bold", "size": "md"},
            ],
        },
        "body": {"type": "box", "layout": "vertical", "spacing": "none", "contents": rows},
        **({"footer": {"type": "box", "layout": "vertical", "contents": settle_footer}} if settle_footer else {}),
    }


# Category → accent colour used in flex cards and progress bars
_CAT_COLORS: dict[str, str] = {
    "food": "#FF6B6B",
    "food & dining": "#FF6B6B",
    "transport": "#4ECDC4",
    "transportation": "#4ECDC4",
    "shopping": "#F9CA24",
    "entertainment": "#A29BFE",
    "health": "#FD79A8",
    "healthcare": "#FD79A8",
    "housing": "#6C5CE7",
    "utilities": "#FDCB6E",
    "salary": "#00B894",
    "freelance": "#00CEC9",
    "other": "#74B9FF",
}

# Category → emoji icon shown in flex cards
_CAT_ICONS: dict[str, str] = {
    "food": "🍽️",
    "food & dining": "🍽️",
    "transport": "🚗",
    "transportation": "🚗",
    "shopping": "🛍️",
    "entertainment": "🎬",
    "health": "🏥",
    "healthcare": "🏥",
    "housing": "🏠",
    "utilities": "💡",
    "salary": "💼",
    "freelance": "💻",
    "other": "📦",
}


def _cat_color(category: str) -> str:
    return _CAT_COLORS.get(category.lower(), "#888888")


def _cat_icon(category: str) -> str:
    return _CAT_ICONS.get(category.lower(), "💰")


def _category_pie_url(rows: list[dict]) -> str:
    """
    Build a QuickChart.io URL that renders a doughnut chart of category spending.
    Returns an HTTPS PNG URL suitable for a LINE image message.

    Keeps the Chart.js config minimal so the encoded URL stays well under
    LINE's 2000-character image URL limit.
    """
    labels = [r["category_name"] for r in rows]
    data = [round(float(r["total_amount"])) for r in rows]
    colors = [_cat_color(name) for name in labels]

    cfg = {
        "type": "doughnut",
        "data": {
            "labels": labels,
            "datasets": [{"data": data, "backgroundColor": colors, "borderWidth": 2, "borderColor": "#fff"}],
        },
        "options": {
            "cutoutPercentage": 55,
            "legend": {"position": "right", "labels": {"fontSize": 11, "padding": 10}},
            "plugins": {"datalabels": {"display": False}},
        },
    }
    return f"{settings.QUICKCHART_URL}?c={quote(json.dumps(cfg, separators=(',', ':')))}&w=420&h=240&bkg=%23ffffff&f=png"


def _flex_not_linked(context: str = "dm") -> dict:
    """Consistent 'account not linked' nudge card."""
    return {
        "type": "bubble",
        "size": "kilo",
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "paddingAll": "20px",
            "contents": [
                {"type": "text", "text": "🔗", "size": "xxl", "align": "center"},
                {"type": "text", "text": "Account Not Linked", "weight": "bold", "size": "lg", "align": "center", "margin": "sm"},
                {
                    "type": "text",
                    "text": "Connect your Aspiro account to unlock spending tracking, monthly summaries, and group expense splitting.",
                    "size": "sm",
                    "color": "#666666",
                    "wrap": True,
                    "align": "center",
                    "margin": "sm",
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "🔗 Link Account", "data": "cmd=link", "displayText": "Link account"},
                    "style": "primary",
                    "color": "#06C755",
                    "height": "sm",
                },
            ],
        },
    }


def _flex_link_prompt(link_url: str, ttl_minutes: int) -> dict:
    """Flex card for /link — big tap-to-connect button."""
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#06C755",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "🔗", "size": "xxl", "align": "center"},
                {"type": "text", "text": "Connect Aspiro", "color": "#ffffff", "weight": "bold", "size": "lg", "align": "center", "margin": "sm"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "16px",
            "contents": [
                {
                    "type": "text",
                    "text": "Tap the button below to securely link your Aspiro account.",
                    "size": "sm",
                    "color": "#555555",
                    "wrap": True,
                    "align": "center",
                },
                {
                    "type": "text",
                    "text": f"⏱  Link expires in {ttl_minutes} minutes",
                    "size": "xs",
                    "color": "#E53E3E",
                    "align": "center",
                    "margin": "md",
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "uri", "label": "Open Aspiro & Connect", "uri": link_url},
                    "style": "primary",
                    "color": "#06C755",
                    "height": "md",
                },
            ],
        },
    }


def _flex_settle_confirm(target_name: str, currency: str, total: Decimal) -> dict:
    """Flex confirmation after /settle."""
    return {
        "type": "bubble",
        "size": "kilo",
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "paddingAll": "20px",
            "contents": [
                {"type": "text", "text": "✅", "size": "xxl", "align": "center"},
                {"type": "text", "text": "Settled Up!", "weight": "bold", "size": "xl", "align": "center", "color": "#06C755"},
                {
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "lg",
                    "contents": [
                        {"type": "text", "text": "Paid to", "size": "sm", "color": "#888888", "flex": 3},
                        {"type": "text", "text": f"@{target_name}", "size": "sm", "weight": "bold", "flex": 5, "align": "end"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Amount", "size": "sm", "color": "#888888", "flex": 3},
                        {"type": "text", "text": f"{currency} {total:,.0f}", "size": "sm", "weight": "bold", "color": "#06C755", "flex": 5, "align": "end"},
                    ],
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "⚖️ Balance", "data": "cmd=balance", "displayText": "Check balance"},
                    "style": "primary",
                    "color": "#06C755",
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "📜 History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


def _money_text(amount: Decimal) -> str:
    """1200 → "1,200", 12.50 → "12.5": grouped, but never rounded away from
    what was stored."""
    return format(amount.normalize(), ",f")


def _flex_undo_confirm(description: str, currency: str, amount: Decimal) -> dict:
    """Flex confirmation after /undo."""
    return {
        "type": "bubble",
        "size": "kilo",
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "paddingAll": "20px",
            "contents": [
                {"type": "text", "text": "🗑️", "size": "xxl", "align": "center"},
                {"type": "text", "text": "Expense Removed", "weight": "bold", "size": "lg", "align": "center", "margin": "sm"},
                {
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "lg",
                    "contents": [
                        {"type": "text", "text": "Description", "size": "sm", "color": "#888888", "flex": 3},
                        {"type": "text", "text": description, "size": "sm", "weight": "bold", "flex": 5, "align": "end", "wrap": True},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Amount", "size": "sm", "color": "#888888", "flex": 3},
                        {"type": "text", "text": f"{currency} {_money_text(amount)}", "size": "sm", "weight": "bold", "color": "#E53E3E", "flex": 5, "align": "end"},
                    ],
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "📜 History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "⚖️ Balance", "data": "cmd=balance", "displayText": "Check balance"},
                    "style": "primary",
                    "color": "#2D3748",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


def _flex_all_settled() -> dict:
    """Celebration card when /balance shows nothing owed."""
    return {
        "type": "bubble",
        "size": "kilo",
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "paddingAll": "24px",
            "contents": [
                {"type": "text", "text": "🎉", "size": "5xl", "align": "center"},
                {"type": "text", "text": "All Settled Up!", "weight": "bold", "size": "xl", "align": "center", "color": "#06C755", "margin": "sm"},
                {
                    "type": "text",
                    "text": "No outstanding balances in this group.",
                    "size": "sm",
                    "color": "#888888",
                    "align": "center",
                    "wrap": True,
                    "margin": "sm",
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "💰 Add Expense", "data": "cmd=add_start", "displayText": "Add expense"},
                    "style": "primary",
                    "color": "#06C755",
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "📜 History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


def _flex_welcome_new(link_url: str, ttl_minutes: int) -> dict:
    """Welcome card for first-time DM users — prompts to link."""
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "paddingAll": "20px",
            "contents": [
                {"type": "text", "text": "👋", "size": "3xl", "align": "center"},
                {"type": "text", "text": "Hi! I'm Aspiro", "color": "#ffffff", "weight": "bold", "size": "xl", "align": "center", "margin": "sm"},
                {"type": "text", "text": "Your personal finance assistant", "color": "#aaaaaa", "size": "xs", "align": "center"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "What I can do for you:", "size": "sm", "weight": "bold", "margin": "sm"},
                {"type": "text", "text": "📊  Monthly spending overview", "size": "sm", "color": "#555555"},
                {"type": "text", "text": "💳  Log expenses on the go", "size": "sm", "color": "#555555"},
                {"type": "text", "text": "📈  Track savings goals", "size": "sm", "color": "#555555"},
                {"type": "text", "text": "👥  Split bills with friends", "size": "sm", "color": "#555555"},
                {
                    "type": "text",
                    "text": f"⏱  Link expires in {ttl_minutes} min",
                    "size": "xs",
                    "color": "#E53E3E",
                    "margin": "lg",
                    "align": "center",
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "uri", "label": "🔗 Connect My Account", "uri": link_url},
                    "style": "primary",
                    "color": "#06C755",
                    "height": "md",
                },
            ],
        },
    }


def _flex_welcome_back(name: str) -> dict:
    """Welcome-back card for already-linked DM users."""
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": f"Welcome back, {name}! 👋", "color": "#ffffff", "weight": "bold", "size": "lg"},
                {"type": "text", "text": "Your Aspiro assistant is ready", "color": "#aaaaaa", "size": "xs", "margin": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "Quick actions:", "size": "sm", "weight": "bold"},
                {
                    "type": "box", "layout": "horizontal", "margin": "sm",
                    "contents": [
                        {"type": "text", "text": "📊", "size": "sm", "flex": 0},
                        {"type": "text", "text": " /balance — monthly overview", "size": "sm", "color": "#333333"},
                    ],
                },
                {
                    "type": "box", "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "💳", "size": "sm", "flex": 0},
                        {"type": "text", "text": " /txn 150 food coffee", "size": "sm", "color": "#333333"},
                    ],
                },
                {
                    "type": "box", "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "🎯", "size": "sm", "flex": 0},
                        {"type": "text", "text": " /goals — track your goals", "size": "sm", "color": "#333333"},
                    ],
                },
                {
                    "type": "box", "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "📈", "size": "sm", "flex": 0},
                        {"type": "text", "text": " /portfolio — investment snapshot", "size": "sm", "color": "#333333"},
                    ],
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {"type": "button", "action": {"type": "postback", "label": "📊 Balance", "data": "cmd=balance", "displayText": "Check balance"}, "style": "primary", "color": "#06C755", "height": "sm", "flex": 1},
                {"type": "button", "action": {"type": "postback", "label": "❓ Help", "data": "cmd=help", "displayText": "Help"}, "style": "secondary", "height": "sm", "flex": 1},
            ],
        },
    }


def _liff_url(gid: Optional[str] = None) -> Optional[str]:
    """Deep link that opens the Aspiro in-LINE (LIFF) app, or None if LIFF isn't
    configured. `gid` optionally targets a specific Aspiro group."""
    if not settings.LIFF_ID:
        return None
    url = f"https://liff.line.me/{settings.LIFF_ID}"
    if gid:
        url += f"?gid={gid}"
    return url


def _flex_group_join_liff(liff_url: str) -> dict:
    """Minimal group-join card: a single tap opens the LIFF app, keeping the group
    chat clean instead of posting walls of command cards."""
    return {
        "type": "bubble",
        "header": {
            "type": "box", "layout": "vertical", "backgroundColor": "#06C755", "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "👋 Hi! I'm Aspiro", "color": "#ffffff", "weight": "bold", "size": "lg"},
                {"type": "text", "text": "Split group expenses with friends", "color": "#e0ffe0", "size": "xs", "margin": "xs"},
            ],
        },
        "body": {
            "type": "box", "layout": "vertical", "spacing": "sm", "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "Tap below to open Aspiro and manage balances, expenses and settle-ups — no chat clutter.", "size": "sm", "color": "#333333", "wrap": True},
                {"type": "text", "text": "New here? Type /link first to connect your account.", "size": "xs", "color": "#888888", "wrap": True, "margin": "md"},
            ],
        },
        "footer": {
            "type": "box", "layout": "vertical", "contents": [
                {"type": "button", "style": "primary", "color": "#06C755", "height": "sm",
                 "action": {"type": "uri", "label": "📲 Open Aspiro", "uri": liff_url}},
            ],
        },
    }


def _flex_group_join_welcome() -> dict:
    """Welcome card sent on bot join — each member must /link individually for their own token."""
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#06C755",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "👋 Hi! I'm Aspiro", "color": "#ffffff", "weight": "bold", "size": "lg"},
                {"type": "text", "text": "Your group expense tracker", "color": "#e0ffe0", "size": "xs", "margin": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "Get started in 4 steps:", "size": "sm", "weight": "bold"},
                {"type": "text", "text": "1️⃣  Each member types /link to connect their Aspiro account", "size": "sm", "color": "#333333", "margin": "sm", "wrap": True},
                {"type": "text", "text": "2️⃣  /add 150 coffee — log a shared expense", "size": "sm", "color": "#333333"},
                {"type": "text", "text": "3️⃣  /balance — see who owes who", "size": "sm", "color": "#333333"},
                {"type": "text", "text": "4️⃣  /settle @name — mark as paid", "size": "sm", "color": "#333333"},
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "🔗 Link My Account", "data": "cmd=link", "displayText": "Link account"},
                    "style": "primary",
                    "color": "#06C755",
                    "height": "sm",
                },
            ],
        },
    }


def _flex_goals(goals: list, currency: str = "TWD") -> dict:
    """Flex bubble listing active goals with progress bars."""
    if not goals:
        return {
            "type": "bubble",
            "size": "kilo",
            "body": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "24px",
                "contents": [
                    {"type": "text", "text": "🎯", "size": "xxl", "align": "center"},
                    {"type": "text", "text": "No Active Goals", "weight": "bold", "size": "lg", "align": "center", "margin": "sm"},
                    {"type": "text", "text": "Set financial goals in the Aspiro app to track them here.", "size": "sm", "color": "#888888", "wrap": True, "align": "center", "margin": "sm"},
                ],
            },
        }

    rows: list[dict] = []
    for g in goals[:4]:  # show max 4 to avoid overflow
        name = g.get("name", "Goal")
        current = float(g.get("current_amount", 0))
        target = float(g.get("target_amount", 1))
        pct = min(100, int(current / target * 100)) if target > 0 else 0
        bar_filled = max(1, min(99, pct))
        days_left = g.get("days_left")
        days_txt = (
            "Overdue" if days_left is not None and days_left < 0
            else f"{days_left}d left" if days_left is not None
            else "No deadline"
        )
        status_color = "#06C755" if pct >= 100 else ("#F9CA24" if pct >= 50 else "#888888")

        rows.append({
            "type": "box",
            "layout": "vertical",
            "margin": "md",
            "contents": [
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": name, "size": "sm", "weight": "bold", "flex": 5, "wrap": True},
                        {"type": "text", "text": f"{pct}%", "size": "sm", "weight": "bold", "color": status_color, "flex": 2, "align": "end"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "xs",
                    "contents": [
                        {"type": "text", "text": f"{currency} {current:,.0f} / {target:,.0f}", "size": "xs", "color": "#888888", "flex": 5},
                        {"type": "text", "text": days_txt, "size": "xs", "color": "#888888", "flex": 2, "align": "end"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "height": "6px",
                    "margin": "xs",
                    "contents": [
                        {"type": "box", "layout": "vertical", "backgroundColor": status_color, "flex": bar_filled, "contents": [{"type": "filler"}]},
                        {"type": "box", "layout": "vertical", "backgroundColor": "#EEEEEE", "flex": 100 - bar_filled, "contents": [{"type": "filler"}]},
                    ],
                },
            ],
        })

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#2D3748",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "🎯 Financial Goals", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": f"{len(goals)} active goal{'s' if len(goals) != 1 else ''}", "color": "#aaaaaa", "size": "xs"},
            ],
        },
        "body": {"type": "box", "layout": "vertical", "spacing": "none", "paddingAll": "16px", "contents": rows},
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {"type": "button", "action": {"type": "postback", "label": "💳 Log Spend", "data": "cmd=txn_start", "displayText": "Log a spend"}, "style": "secondary", "height": "sm", "flex": 1},
                {"type": "button", "action": {"type": "postback", "label": "📊 Balance", "data": "cmd=balance", "displayText": "Check balance"}, "style": "primary", "color": "#2D3748", "height": "sm", "flex": 1},
            ],
        },
    }


def _flex_portfolio(holdings: list, total_value: float, total_gain_pct: float, currency: str = "TWD") -> dict:
    """Flex bubble for /portfolio snapshot."""
    gain_color = "#06C755" if total_gain_pct >= 0 else "#E53E3E"
    gain_sign = "+" if total_gain_pct >= 0 else ""

    rows: list[dict] = []
    for h in holdings[:5]:
        symbol = h.get("symbol", "")
        name = h.get("name", symbol)[:16]
        value = float(h.get("total_value", 0))
        # Each holding is stored in its own currency (TWD for 0050, USD for VT, …),
        # and the bot does not FX-convert — so label each row with its native
        # currency rather than a single account-wide one.
        row_currency = h.get("currency", currency)
        gain_pct = float(h.get("gain_loss_percentage", 0))
        g_color = "#06C755" if gain_pct >= 0 else "#E53E3E"
        g_sign = "+" if gain_pct >= 0 else ""
        rows.append({
            "type": "box",
            "layout": "horizontal",
            "margin": "sm",
            "contents": [
                {
                    "type": "box",
                    "layout": "vertical",
                    "flex": 5,
                    "contents": [
                        {"type": "text", "text": symbol, "size": "sm", "weight": "bold"},
                        {"type": "text", "text": name, "size": "xs", "color": "#888888"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "flex": 4,
                    "contents": [
                        {"type": "text", "text": f"{row_currency} {value:,.0f}", "size": "sm", "weight": "bold", "align": "end"},
                        {"type": "text", "text": f"{g_sign}{gain_pct:.1f}%", "size": "xs", "color": g_color, "align": "end"},
                    ],
                },
            ],
        })

    if not rows:
        rows = [{"type": "text", "text": "No holdings yet.", "size": "sm", "color": "#888888", "align": "center"}]

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "📈 Portfolio", "color": "#aaaaaa", "size": "xs"},
                {"type": "text", "text": f"{currency} {total_value:,.0f}", "color": "#ffffff", "weight": "bold", "size": "xxl"},
                {"type": "text", "text": f"Total return  {gain_sign}{total_gain_pct:.2f}%", "color": gain_color, "size": "sm", "margin": "xs"},
            ],
        },
        "body": {"type": "box", "layout": "vertical", "spacing": "none", "paddingAll": "16px", "contents": rows},
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {"type": "button", "action": {"type": "postback", "label": "📊 Balance", "data": "cmd=balance", "displayText": "Check balance"}, "style": "secondary", "height": "sm", "flex": 1},
                {"type": "button", "action": {"type": "postback", "label": "🎯 Goals", "data": "cmd=goals", "displayText": "View goals"}, "style": "primary", "color": "#1A1A2E", "height": "sm", "flex": 1},
            ],
        },
    }


def _flex_txn_confirm(
    description: str,
    amount: Decimal,
    currency: str,
    category: str,
) -> dict:
    """Flex bubble confirming a personal /txn entry."""
    icon = _cat_icon(category)
    color = _cat_color(category)
    return {
        "type": "bubble",
        "size": "kilo",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": color,
            "paddingAll": "16px",
            "contents": [
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": icon, "size": "xl", "flex": 0},
                        {
                            "type": "text",
                            "text": "Expense Recorded",
                            "color": "#ffffff",
                            "weight": "bold",
                            "size": "md",
                            "margin": "sm",
                            "gravity": "center",
                        },
                    ],
                },
                {
                    "type": "text",
                    "text": f"{currency} {_money_text(amount)}",
                    "color": "#ffffff",
                    "size": "xxl",
                    "weight": "bold",
                    "margin": "sm",
                },
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "16px",
            "contents": [
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Description", "size": "sm", "color": "#888888", "flex": 3},
                        {"type": "text", "text": description, "size": "sm", "weight": "bold", "flex": 5, "align": "end", "wrap": True},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Category", "size": "sm", "color": "#888888", "flex": 3},
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "flex": 5,
                            "justifyContent": "flex-end",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": f"{icon} {category.title()}",
                                    "size": "sm",
                                    "weight": "bold",
                                    "align": "end",
                                },
                            ],
                        },
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Wallet", "size": "sm", "color": "#888888", "flex": 3},
                        {"type": "text", "text": "Life Wallet", "size": "sm", "flex": 5, "align": "end"},
                    ],
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "Add Another", "data": "cmd=txn_start", "displayText": "Add another"},
                    "style": "primary",
                    "color": color,
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


def _flex_help(is_group: bool = False) -> dict:
    """Flex carousel for /help — one bubble per command group."""
    def _cmd_row(cmd: str, desc: str) -> dict:
        return {
            "type": "box",
            "layout": "horizontal",
            "margin": "sm",
            "contents": [
                {"type": "text", "text": cmd, "size": "sm", "weight": "bold", "color": "#1A1A2E", "flex": 3, "wrap": True},
                {"type": "text", "text": desc, "size": "xs", "color": "#555555", "flex": 5, "wrap": True, "gravity": "center"},
            ],
        }

    def _bubble(header_color: str, icon: str, title: str, rows: list[dict], btn_label: str, btn_data: str, btn_display: str) -> dict:
        return {
            "type": "bubble",
            "size": "kilo",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": header_color,
                "paddingAll": "16px",
                "contents": [
                    {"type": "text", "text": icon, "size": "xl"},
                    {"type": "text", "text": title, "color": "#ffffff", "weight": "bold", "size": "md", "margin": "xs"},
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "none",
                "paddingAll": "14px",
                "contents": rows,
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "button",
                        "action": {"type": "postback", "label": btn_label, "data": btn_data, "displayText": btn_display},
                        "style": "primary",
                        "color": header_color,
                        "height": "sm",
                    },
                ],
            },
        }

    if is_group:
        bubbles = [
            _bubble(
                "#1A1A2E", "🔗", "Setup",
                [
                    _cmd_row("/link", "Connect your Aspiro account"),
                    {"type": "text", "text": "Each member must link once before adding expenses.", "size": "xs", "color": "#888888", "margin": "md", "wrap": True},
                ],
                "Link Account", "cmd=link", "Link account",
            ),
            _bubble(
                "#06C755", "💰", "Add Expenses",
                [
                    _cmd_row("/add 150 coffee", "Split equally"),
                    _cmd_row("/add 150 coffee paid:@name", "Specific payer"),
                    _cmd_row("/add 150 coffee 60:40", "Custom split ratio"),
                    {"type": "separator", "margin": "sm"},
                    _cmd_row("/balance", "See who owes who"),
                ],
                "Add Expense", "cmd=add_start", "Add expense",
            ),
            _bubble(
                "#4ECDC4", "✅", "Settle & Review",
                [
                    _cmd_row("/settle @name", "Mark debts as paid"),
                    _cmd_row("/history", "Last 5 group expenses"),
                    _cmd_row("/summary", "This month's totals"),
                    _cmd_row("/undo", "Remove your last entry"),
                ],
                "Check Balance", "cmd=balance", "Check balance",
            ),
        ]
    else:
        bubbles = [
            _bubble(
                "#1A1A2E", "🔗", "Account",
                [
                    _cmd_row("/link", "Connect your Aspiro account"),
                    {"type": "text", "text": "Link once to enable transaction tracking and monthly summaries.", "size": "xs", "color": "#888888", "margin": "md", "wrap": True},
                ],
                "Link Account", "cmd=link", "Link account",
            ),
            _bubble(
                "#06C755", "💳", "Track Spending",
                [
                    _cmd_row("午餐 120", "Just type it — logged"),
                    _cmd_row("+50000 薪水", "A + makes it income"),
                    _cmd_row("/txn 1200 transport taxi", "Pick the category"),
                    {"type": "separator", "margin": "sm"},
                    _cmd_row("/balance", "Monthly income & expenses"),
                    _cmd_row("/summary", "Breakdown by category"),
                    _cmd_row("/history", "Last 5 transactions"),
                ],
                "Log a Spend", "cmd=txn_start", "Add another",
            ),
            _bubble(
                "#A29BFE", "👥", "Group & Insights",
                [
                    {"type": "text", "text": "Add me to a LINE group to split shared expenses with friends.", "size": "sm", "wrap": True, "color": "#333333"},
                    {"type": "separator", "margin": "md"},
                    _cmd_row("/add", "Log group expense"),
                    _cmd_row("/balance", "See who owes who"),
                    _cmd_row("/settle", "Mark as paid"),
                ],
                "Full Group Help", "cmd=help", "Help",
            ),
            _bubble(
                "#16213E", "💱", "Finance Tools",
                [
                    _cmd_row("/rate", "Live exchange rates"),
                    _cmd_row("/goals", "View savings goals"),
                    _cmd_row("/portfolio", "Portfolio snapshot"),
                    {"type": "separator", "margin": "sm"},
                    {"type": "text", "text": "These commands work in DM only.", "size": "xs", "color": "#888888", "wrap": True},
                ],
                "Exchange Rates", "cmd=rate", "Exchange rates",
            ),
        ]

    return {"type": "carousel", "contents": bubbles}


def _flex_group_summary(month: str, currency: str, total: Decimal, expense_count: int, paid_by: dict, names: dict) -> dict:
    """Flex bubble for group monthly summary (/summary in group context)."""
    rows: list[dict] = []
    for uid, amt in sorted(paid_by.items(), key=lambda x: -x[1]):
        name = names.get(uid, "?")
        share_pct = int(float(amt) / float(total) * 100) if total > 0 else 0
        bar_filled = max(1, min(99, share_pct))
        rows.append({
            "type": "box",
            "layout": "vertical",
            "margin": "md",
            "contents": [
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": f"👤 {name}", "size": "sm", "weight": "bold", "flex": 5},
                        {"type": "text", "text": f"{currency} {amt:,.0f}", "size": "sm", "weight": "bold", "color": "#E53E3E", "flex": 4, "align": "end"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "height": "5px",
                    "margin": "xs",
                    "contents": [
                        {"type": "box", "layout": "vertical", "backgroundColor": "#06C755", "flex": bar_filled, "contents": [{"type": "filler"}]},
                        {"type": "box", "layout": "vertical", "backgroundColor": "#EEEEEE", "flex": 100 - bar_filled, "contents": [{"type": "filler"}]},
                    ],
                },
            ],
        })

    rows.append({"type": "separator", "margin": "lg"})
    rows.append({
        "type": "box",
        "layout": "horizontal",
        "margin": "md",
        "contents": [
            {"type": "text", "text": "Total", "size": "sm", "weight": "bold", "flex": 5},
            {"type": "text", "text": f"{currency} {total:,.0f}", "size": "sm", "weight": "bold", "flex": 4, "align": "end"},
        ],
    })
    rows.append({"type": "text", "text": f"{expense_count} expenses this month", "size": "xs", "color": "#888888", "margin": "sm"})

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#2D3748",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "📊 Group Summary", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": month, "color": "#aaaaaa", "size": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "none",
            "paddingAll": "16px",
            "contents": rows,
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "⚖️ Balance", "data": "cmd=balance", "displayText": "Check balance"},
                    "style": "primary",
                    "color": "#2D3748",
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "📜 History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


async def _push_messages(line_user_id: str, messages: list[dict]) -> None:
    """Push up to 5 messages at once to a LINE user (no reply token needed)."""
    if not settings.LINE_CHANNEL_ACCESS_TOKEN:
        return
    try:
        resp = await _get_http_client().post(
            LINE_PUSH_URL,
            json={"to": line_user_id, "messages": messages},
            headers={"Authorization": f"Bearer {settings.LINE_CHANNEL_ACCESS_TOKEN}"},
        )
        if resp.status_code != 200:
            logger.error("LINE push_messages failed: %s %s", resp.status_code, resp.text)
    except Exception as exc:
        logger.error("LINE push_messages error: %s", exc)


def _flex_main_menu(is_group: bool = False) -> dict:
    """
    Visual command menu shown on bot add, /menu, and non-command fallback.
    Renders as a 2-column icon-button grid organised by feature area.
    """

    def _btn(icon: str, label: str, cmd: str, bg: str = "#F8FAFC") -> dict:
        return {
            "type": "box",
            "layout": "vertical",
            "flex": 1,
            "backgroundColor": bg,
            "cornerRadius": "12px",
            "paddingAll": "10px",
            "spacing": "xs",
            "alignItems": "center",
            "action": {"type": "postback", "label": label[:20], "data": cmd, "displayText": label},
            "contents": [
                {"type": "text", "text": icon, "size": "xl", "align": "center"},
                {
                    "type": "text",
                    "text": label,
                    "size": "xs",
                    "weight": "bold",
                    "align": "center",
                    "wrap": True,
                    "color": "#333333",
                },
            ],
        }

    def _row(b1: dict, b2: dict | None = None) -> dict:
        return {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [b1, b2 if b2 else {"type": "filler", "flex": 1}],
        }

    def _section(label: str) -> dict:
        return {
            "type": "text",
            "text": label,
            "size": "xs",
            "weight": "bold",
            "color": "#888888",
            "margin": "md",
        }

    if is_group:
        body = [
            _section("SPLIT EXPENSES"),
            _row(
                _btn("💰", "Add Expense", "cmd=add_start", "#E8F5E9"),
                _btn("⚖️", "Balance", "cmd=balance", "#E3F2FD"),
            ),
            _row(
                _btn("✅", "Settle Up", "cmd=settle_start", "#E8F5E9"),
                _btn("📜", "History", "cmd=history", "#FFF8E1"),
            ),
            _row(
                _btn("📊", "Summary", "cmd=summary", "#F3E5F5"),
                _btn("🗑️", "Undo Last", "cmd=undo", "#FCE4EC"),
            ),
            _section("ACCOUNT"),
            _row(
                _btn("🔗", "Link Account", "cmd=link", "#E0F2F1"),
                _btn("❓", "Help", "cmd=help", "#F5F5F5"),
            ),
        ]
        header_color = "#06C755"
        header_icon = "👥"
        header_title = "Group Expense Menu"
        header_sub_color = "#e0ffe0"
    else:
        body = [
            _section("PERSONAL FINANCE"),
            _row(
                _btn("📊", "Balance", "cmd=balance", "#E3F2FD"),
                _btn("📈", "Summary", "cmd=summary", "#F3E5F5"),
            ),
            _row(
                _btn("💳", "Log Spend", "cmd=txn_start", "#E8F5E9"),
                _btn("📜", "History", "cmd=history", "#FFF8E1"),
            ),
            _row(
                _btn("🎯", "Goals", "cmd=goals", "#FFF3E0"),
                _btn("📈", "Portfolio", "cmd=portfolio", "#E8EAF6"),
            ),
            _row(
                _btn("💱", "Rates", "cmd=rate", "#E0F7FA"),
                _btn("❓", "Help", "cmd=help", "#F5F5F5"),
            ),
            _section("ACCOUNT"),
            _row(
                _btn("🔗", "Link Account", "cmd=link", "#E0F2F1"),
            ),
        ]
        header_color = "#1A1A2E"
        header_icon = "🤖"
        header_title = "Aspiro Menu"
        header_sub_color = "#aaaaaa"

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": header_color,
            "paddingAll": "16px",
            "contents": [
                {
                    "type": "box",
                    "layout": "horizontal",
                    "alignItems": "center",
                    "contents": [
                        {"type": "text", "text": header_icon, "size": "xl", "flex": 0},
                        {
                            "type": "text",
                            "text": header_title,
                            "color": "#ffffff",
                            "weight": "bold",
                            "size": "lg",
                            "margin": "sm",
                            "gravity": "center",
                        },
                    ],
                },
                {
                    "type": "text",
                    "text": "Tap any button to get started",
                    "color": header_sub_color,
                    "size": "xs",
                    "margin": "xs",
                },
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "12px",
            "contents": body,
        },
    }


LINE_RICH_MENU_URL = "https://api.line.me/v2/bot/richmenu"


async def setup_rich_menu(image_url: str | None = None) -> dict:
    """
    Create and activate the Aspiro rich menu for all users.
    Call once from POST /line-bot/rich-menu/setup.
    The menu has 6 tap areas sending slash commands.
    If image_url is provided it will be linked; otherwise callers must
    upload an image separately via LINE's upload endpoint.
    """
    if not settings.LINE_CHANNEL_ACCESS_TOKEN:
        raise ValueError("LINE_CHANNEL_ACCESS_TOKEN not set")

    menu_body = {
        "size": {"width": 2500, "height": 843},
        "selected": True,
        "name": "Aspiro Bot Menu",
        "chatBarText": "Aspiro Menu",
        "areas": [
            # Row 1
            {"bounds": {"x": 0,    "y": 0, "width": 833, "height": 421}, "action": {"type": "postback", "data": "cmd=add_start", "displayText": "Add expense"}},
            {"bounds": {"x": 833,  "y": 0, "width": 834, "height": 421}, "action": {"type": "message", "text": "/balance"}},
            {"bounds": {"x": 1667, "y": 0, "width": 833, "height": 421}, "action": {"type": "message", "text": "/history"}},
            # Row 2
            {"bounds": {"x": 0,    "y": 421, "width": 833, "height": 422}, "action": {"type": "message", "text": "/summary"}},
            {"bounds": {"x": 833,  "y": 421, "width": 834, "height": 422}, "action": {"type": "postback", "data": "cmd=txn_start", "displayText": "Log a spend"}},
            {"bounds": {"x": 1667, "y": 421, "width": 833, "height": 422}, "action": {"type": "message", "text": "/help"}},
        ],
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        headers = {"Authorization": f"Bearer {settings.LINE_CHANNEL_ACCESS_TOKEN}", "Content-Type": "application/json"}

        # Create menu
        res = await client.post(LINE_RICH_MENU_URL, json=menu_body, headers=headers)
        if res.status_code != 200:
            raise ValueError(f"Rich menu creation failed: {res.text}")

        rich_menu_id = res.json()["richMenuId"]

        # Set as default for all users
        await client.post(
            f"https://api.line.me/v2/bot/user/all/richmenu/{rich_menu_id}",
            headers={"Authorization": f"Bearer {settings.LINE_CHANNEL_ACCESS_TOKEN}"},
        )

        return {"rich_menu_id": rich_menu_id, "image_upload_url": f"https://api-data.line.me/v2/bot/richmenu/{rich_menu_id}/content"}


# ---------------------------------------------------------------------------
# Command parsing
# ---------------------------------------------------------------------------


class AddCommand:
    amount: Decimal
    description: str
    paid_by: Optional[str]   # display name of payer if not the sender
    ratios: Optional[list[Decimal]]  # custom ratios e.g. [60, 40]

    def __init__(
        self,
        amount: Decimal,
        description: str,
        paid_by: Optional[str] = None,
        ratios: Optional[list[Decimal]] = None,
    ):
        self.amount = amount
        self.description = description
        self.paid_by = paid_by
        self.ratios = ratios


def _parse_add(text: str) -> Optional[AddCommand]:
    """
    Parse '/add' command with optional modifiers.

    Formats:
      /add 150 coffee
      /add 1200 dinner with friends
      /add 150 coffee paid:@jane          → jane paid
      /add 150 coffee 60:40               → sender paid, custom ratio
      /add 150 coffee paid:@jane 60:40    → jane paid, custom ratio
    """
    # Strip the command and extract tokens after amount+description
    m = re.match(r"^/add\s+(\d+(?:\.\d+)?)\s+(.+)$", text.strip(), re.IGNORECASE)
    if not m:
        return None
    try:
        amount = Decimal(m.group(1))
    except Exception:
        return None

    rest = m.group(2).strip()

    # Extract optional paid:@name
    paid_by: Optional[str] = None
    paid_match = re.search(r"\bpaid:@(\S+)", rest, re.IGNORECASE)
    if paid_match:
        paid_by = paid_match.group(1)
        rest = rest[:paid_match.start()].strip() + " " + rest[paid_match.end():].strip()
        rest = rest.strip()

    # Extract optional ratio like 60:40
    ratios: Optional[list[Decimal]] = None
    ratio_match = re.search(r"\b(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)\s*$", rest)
    if ratio_match:
        r1, r2 = Decimal(ratio_match.group(1)), Decimal(ratio_match.group(2))
        if r1 + r2 > 0:
            ratios = [r1, r2]
        rest = rest[:ratio_match.start()].strip()

    description = rest.strip() or "Expense"
    return AddCommand(amount=amount, description=description, paid_by=paid_by, ratios=ratios)


def _parse_txn(text: str) -> Optional[tuple[Decimal, str, str]]:
    """
    Parse '/txn <amount> <category> <description>' for personal transactions.

    Formats:
      /txn 150 food coffee
      /txn 1200 transport uber
      /txn 500 shopping clothes

    Returns (amount, category, description).
    """
    m = re.match(r"^/txn\s+(\d+(?:\.\d+)?)\s+(\S+)\s+(.+)$", text.strip(), re.IGNORECASE)
    if m:
        try:
            return Decimal(m.group(1)), m.group(2).lower(), m.group(3).strip()
        except Exception:
            return None
    # /txn 150 coffee  (no explicit category — defaults to "other")
    m2 = re.match(r"^/txn\s+(\d+(?:\.\d+)?)\s+(.+)$", text.strip(), re.IGNORECASE)
    if m2:
        try:
            return Decimal(m2.group(1)), "other", m2.group(2).strip()
        except Exception:
            return None
    return None


def _parse_settle(text: str) -> Optional[tuple[str, Optional[Decimal]]]:
    """
    Parse '/settle @display_name [amount]'.
    Returns (display_name, amount_or_none).
    """
    m = re.match(r"^/settle\s+@(\S+)(?:\s+(\d+(?:\.\d+)?))?$", text.strip(), re.IGNORECASE)
    if not m:
        return None
    display_name = m.group(1)
    amount = Decimal(m.group(2)) if m.group(2) else None
    return display_name, amount


# ---------------------------------------------------------------------------
# Activity logging
# ---------------------------------------------------------------------------


async def _log_activity(
    db: AsyncSession,
    user_id: UUID,
    event_type: str,
    description: str,
    amount: Decimal | None = None,
    currency: str | None = None,
) -> None:
    """Append an activity record for this user. Never raises — log failures are non-fatal."""
    try:
        LineAccountRepository(db).add_activity(
            user_id=user_id,
            event_type=event_type,
            description=description,
            amount=amount,
            currency=currency,
        )
    except Exception:
        logger.warning("Failed to log LINE bot activity", exc_info=True)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------



async def _get_link(db: AsyncSession, line_user_id: str) -> Optional[LineUserLink]:
    return await LineAccountRepository(db).get_link_by_line_user_id(line_user_id)


async def _get_or_create_group(
    db: AsyncSession, line_group_id: str, creator_user_id: Optional[UUID] = None
) -> LineGroup:
    repo = LineGroupRepository(db)
    group = await repo.get_group_by_line_group_id(line_group_id)
    if group is not None:
        return group
    # A LINE group is a shared bill-splitting context for the Taiwan market, so it is
    # always created in TWD. It must NOT inherit the creator's personal
    # preferred_currency (which may be USD) — one member's setting should not silently
    # define the whole group's currency. Existing USD groups are backfilled by
    # migration 2026_06_22_line_group_currency_twd.
    return await repo.create_group_if_absent(line_group_id, "TWD")


async def _ensure_member(
    db: AsyncSession,
    group: LineGroup,
    user_id: UUID,
    line_user_id: str,
) -> None:
    repo = LineGroupRepository(db)
    if await repo.get_member(group.id, user_id) is not None:
        return
    await repo.add_member_if_absent(group.id, user_id, line_user_id)


async def _get_group_members(db: AsyncSession, group_id: UUID) -> list[LineGroupMember]:
    return await LineGroupRepository(db).get_members(group_id)


async def _ensure_group_membership_if_linked(
    db: AsyncSession,
    line_group_id: Optional[str],
    line_user_id: Optional[str],
) -> None:
    """Register a linked user as a group member on any group interaction.

    Group membership (``LineGroupMember``) — not account linking (``LineUserLink``) —
    is what ``/add`` counts when splitting a bill. Previously only ``/add`` created a
    membership row, so two people could both ``/link`` their accounts yet still be told
    "only you are linked in this group". Creating membership lazily on every group
    message/postback means that once two linked users have each sent anything in the
    group, ``/add`` splits — matching the bot's own "ask others to /link" guidance.

    Best-effort: a failure here must never block the command the user actually sent.
    """
    if not line_group_id or not line_user_id:
        return
    try:
        link = await _get_link(db, line_user_id)
        if link is None:
            return
        group = await _get_or_create_group(db, line_group_id, link.user_id)
        await _ensure_member(db, group, link.user_id, line_user_id)
    except Exception as exc:  # defensive: membership is a side effect, not the command
        logger.warning("Group membership auto-register failed: %s", exc)


async def _get_user_currency(db: AsyncSession, user_id: UUID) -> str:
    """Return the user's preferred currency string, defaulting to TWD."""
    user = await LineAccountRepository(db).get_user(user_id)
    if user:
        return user.preferred_currency.value
    return "TWD"


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------


async def handle_link_command(
    db: AsyncSession, line_user_id: str, reply_token: str, is_group: bool = False
) -> None:
    """Issue a short-lived token and send the account-linking URL.

    In group context the personal token URL is pushed via DM to avoid
    exposing a single-use secret link publicly in the group chat.
    """
    existing = await _get_link(db, line_user_id)
    if existing:
        name = existing.display_name or "there"
        flex = _flex_welcome_back(name)
        await _reply_flex(reply_token, f"Already linked! Hi {name}", flex, DM_QR)
        return

    # Create the new token BEFORE purging old ones so that if the flush fails,
    # the user's existing tokens are not deleted without a replacement.
    account_repo = LineAccountRepository(db)
    token = account_repo.add_token(
        line_user_id=line_user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=LINK_TOKEN_TTL_MINUTES),
    )
    await db.flush()
    # Now safe to remove old unused tokens — the new one is in the transaction.
    await account_repo.purge_unused_tokens(line_user_id, token.token)

    frontend_url = settings.FRONTEND_URL or "https://aspiro.app"
    # openExternalBrowser=1 forces LINE to open the link in the device's default
    # browser instead of its in-app webview. Required because the link-line page
    # may bounce to Google OAuth, and Google blocks sign-in from embedded webviews
    # with "disallowed_useragent" (403).
    link_url = f"{frontend_url}/link-line?token={token.token}&openExternalBrowser=1"
    flex = _flex_link_prompt(link_url, LINK_TOKEN_TTL_MINUTES)

    if is_group:
        await _push_messages(line_user_id, [
            {"type": "flex", "altText": "Connect your Aspiro account", "contents": flex},
        ])
        await _reply(reply_token, "I've sent you a private DM with your account-linking link!")
    else:
        await _reply_flex(reply_token, "Connect your Aspiro account", flex)


def _split_amounts_equal(amount: Decimal, n: int) -> list[Decimal]:
    """Split *amount* equally among *n* members, assigning rounding remainder
    to the last member so the per-member shares always sum to *amount*."""
    per_person = (amount / Decimal(n)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total_distributed = per_person * (n - 1)
    last_amount = (amount - total_distributed).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return [last_amount if i == n - 1 else per_person for i in range(n)]


def _split_amounts_by_ratio(amount: Decimal, ratios: list[Decimal]) -> list[Decimal]:
    """Split *amount* by *ratios*, assigning the rounding remainder to the last
    share so the shares always sum to *amount*."""
    total_ratio = sum(ratios)
    amounts = [
        (amount * r / total_ratio).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        for r in ratios
    ]
    amounts[-1] = amount - sum(amounts[:-1])
    return amounts


async def _create_shared_expense(
    db: AsyncSession,
    *,
    group: LineGroup,
    members: list[LineGroupMember],
    payer_id: UUID,
    actor_user_id: UUID,
    amount: Decimal,
    description: str,
    ratios: Optional[list[Decimal]] = None,
    note: Optional[str] = None,
) -> tuple[SharedExpense, str]:
    """Core ledger write for a shared expense — shared by the chat /add command
    and the web POST endpoint so both produce identical SharedExpense +
    ExpenseSplit rows and the same activity log entry.

    Returns (expense, split_desc). Caller owns flush/commit and presentation.
    Ratios are only applied for 2-member groups; otherwise an equal split runs.
    """
    n = len(members)
    expense_repo = SharedExpenseRepository(db)
    expense = expense_repo.add_expense(
        group_id=group.id,
        payer_id=payer_id,
        amount=amount,
        currency=group.currency,
        description=description,
    )
    if note is not None:
        expense.note = note
    await db.flush()

    if ratios and len(ratios) == 2 and n == 2:
        amounts = _split_amounts_by_ratio(amount, ratios)
        for member, split_amount, ratio in zip(members, amounts, ratios):
            expense_repo.add_split(
                expense_id=expense.id,
                user_id=member.user_id,
                amount=split_amount,
                ratio=ratio,
            )
        split_desc = f"{int(ratios[0])}:{int(ratios[1])} ratio"
    else:
        amounts = _split_amounts_equal(amount, n)
        per_person = amounts[0] if n == 1 else (amount / Decimal(n)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        for member, split_amount in zip(members, amounts):
            expense_repo.add_split(
                expense_id=expense.id,
                user_id=member.user_id,
                amount=split_amount,
            )
        split_desc = f"split {n} ways — {group.currency} {per_person:,.0f} each"

    await db.flush()
    await _log_activity(
        db,
        actor_user_id,
        "add_expense",
        f"Added: {description} {group.currency} {amount:,.0f}",
        amount=amount,
        currency=group.currency,
    )
    return expense, split_desc


async def handle_add_command(
    db: AsyncSession,
    text: str,
    line_user_id: str,
    line_group_id: str,
    reply_token: str,
) -> None:
    """Record a shared expense with optional payer and ratio overrides."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    cmd = _parse_add(text)
    if cmd is None:
        await _reply(
            reply_token,
            "Usage: /add <amount> <description> [paid:@name] [ratio1:ratio2]\n"
            "Examples:\n"
            "  /add 150 coffee\n"
            "  /add 150 coffee paid:@jane\n"
            "  /add 150 coffee 60:40",
        )
        return

    # Guard against 0/negative and absurd amounts (the latter overflow the
    # Numeric(15,2) column and would 500). The regex already rejects negatives.
    if cmd.amount <= 0 or cmd.amount > Decimal("99999999"):
        await _reply(reply_token, "Amount must be greater than 0 and under 100,000,000.")
        return

    group = await _get_or_create_group(db, line_group_id, link.user_id)
    await _ensure_member(db, group, link.user_id, line_user_id)
    members = await _get_group_members(db, group.id)

    if len(members) < 2:
        await _reply(
            reply_token,
            "Only you are set up in this group so far. Ask the others to /link their "
            "Aspiro account and send any message here — then /add will split the bill.",
        )
        return

    # Resolve payer — default is the sender
    payer_id = link.user_id
    payer_display = link.display_name or "You"

    if cmd.paid_by:
        alt_link = await LineAccountRepository(db).find_group_member_link_by_display_name(
            group.id, cmd.paid_by
        )
        if alt_link is None:
            await _reply(reply_token, f"@{cmd.paid_by} is not linked in this group.")
            return
        payer_id = alt_link.user_id
        payer_display = alt_link.display_name or cmd.paid_by

    n = len(members)

    if cmd.ratios and n != 2:
        await _reply(
            reply_token,
            f"Custom ratios only work in 2-person groups. Splitting equally among {n} members instead.",
        )
        cmd.ratios = None  # fall through to equal split below

    _expense, split_desc = await _create_shared_expense(
        db,
        group=group,
        members=members,
        payer_id=payer_id,
        actor_user_id=link.user_id,
        amount=cmd.amount,
        description=cmd.description,
        ratios=cmd.ratios,
    )

    flex = _flex_expense_confirm(cmd.description, cmd.amount, group.currency, payer_display, split_desc)
    await _reply_flex(reply_token, f"Added: {cmd.description} {group.currency} {cmd.amount:,.0f}", flex, GROUP_QR)


async def handle_balance_command(
    db: AsyncSession,
    line_user_id: str,
    line_group_id: str,
    reply_token: str,
) -> None:
    """Show net balances for all linked members of the group."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    group = await LineGroupRepository(db).get_group_by_line_group_id(line_group_id)
    if group is None:
        await _reply(reply_token, "No expenses recorded in this group yet.")
        return

    balances = await compute_balances(db, group.id, currency=group.currency)
    if not balances.balances:
        await _reply_flex(reply_token, "All settled up!", _flex_all_settled(), GROUP_QR)
        return

    flex = _flex_balance(balances.balances, balances.currency, balances.member_names)
    await _reply_flex(reply_token, "Group Balances", flex, GROUP_QR)


async def _settle_debt(
    db: AsyncSession,
    *,
    group: LineGroup,
    actor_user_id: UUID,
    owed_by: UUID,
    owed_to: UUID,
    amount: Optional[Decimal] = None,
    activity_suffix: str = "",
) -> Optional[Decimal]:
    """Core ledger write for settling a debt — shared by the chat /settle command
    and the web POST endpoint so both have identical side effects and the same
    activity log entry.

    Marks unsettled splits where *owed_by* owes *owed_to* (i.e. *owed_to* paid)
    as settled. When *amount* is None (chat /settle default), every outstanding
    split is settled. When *amount* is given, splits are settled oldest-first
    until the requested amount is reached; a split is only marked settled if it
    fits entirely within the remaining budget (splits are atomic — no partial
    split rows). Returns the total settled, or None if nothing was outstanding.
    """
    splits = await SharedExpenseRepository(db).get_unsettled_splits_owed_to(
        group_id=group.id,
        payer_id=owed_to,
        debtor_id=owed_by,
    )
    if not splits:
        return None

    now = datetime.now(timezone.utc)
    currency = group.currency

    if amount is None:
        # Settle everything outstanding.
        total = Decimal("0")
        for split in splits:
            split.settled = True
            split.settled_at = now
            total += split.amount
    else:
        # Settle oldest splits first, never exceeding the requested amount.
        splits.sort(key=lambda s: s.expense.created_at)
        total = Decimal("0")
        remaining = amount
        for split in splits:
            if split.amount <= remaining:
                split.settled = True
                split.settled_at = now
                total += split.amount
                remaining -= split.amount
        if total == 0:
            # Requested amount was smaller than the smallest outstanding split;
            # nothing could be settled atomically.
            return Decimal("0")

    await db.flush()
    await _log_activity(
        db,
        actor_user_id,
        "settle",
        f"Settled {currency} {total:,.0f}{activity_suffix}",
        amount=total,
        currency=currency,
    )
    return total


async def handle_settle_command(
    db: AsyncSession,
    text: str,
    line_user_id: str,
    line_group_id: str,
    reply_token: str,
) -> None:
    """Mark all unsettled splits the current user owes to another as settled."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    parsed = _parse_settle(text)
    if parsed is None:
        await _reply(reply_token, "Usage: /settle @name\nExample: /settle @jane")
        return

    target_display, partial_amount = parsed
    if partial_amount is not None:
        await _reply(
            reply_token,
            f"Partial settle is not yet supported.\n"
            f"To settle everything you owe @{target_display}, type:\n"
            f"  /settle @{target_display}",
        )
        return

    # Find the target user by display name in this group
    group = await LineGroupRepository(db).get_group_by_line_group_id(line_group_id)
    if group is None:
        await _reply(reply_token, "No expenses in this group yet.")
        return

    target_link = await LineAccountRepository(db).find_group_member_link_by_display_name(
        group.id, target_display
    )
    if target_link is None:
        await _reply(reply_token, f"Could not find @{target_display} in this group.")
        return

    if target_link.user_id == link.user_id:
        await _reply(reply_token, "You can't settle a debt with yourself.")
        return

    # Settle everything the current user owes the target (target paid, current owes)
    total = await _settle_debt(
        db,
        group=group,
        actor_user_id=link.user_id,
        owed_by=link.user_id,
        owed_to=target_link.user_id,
        activity_suffix=f" with @{target_display}",
    )

    if total is None:
        await _reply(reply_token, f"No outstanding balance with @{target_display}.")
        return

    currency = group.currency
    flex = _flex_settle_confirm(target_display, currency, total)
    await _reply_flex(reply_token, f"Settled {currency} {total:,.0f} with @{target_display}", flex, GROUP_QR)


async def _fetch_personal_history(db: AsyncSession, user_id: UUID, limit: int = 5) -> list[dict]:
    """Return last N personal Aspiro transactions for this user."""
    result = await db.execute(
        select(Transaction, TransactionCategory.name.label("cat_name"))
        .outerjoin(TransactionCategory, Transaction.category_id == TransactionCategory.id)
        .where(
            Transaction.user_id == user_id,
            Transaction.is_deleted == False,  # noqa: E712
        )
        .order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
        .limit(limit)
    )
    rows = result.all()
    return [
        {
            "date": str(txn.transaction_date),
            "description": txn.description,
            "amount": txn.amount,
            "currency": txn.currency or "TWD",
            "category": cat_name or txn.type.value,
            "type": txn.type.value,
        }
        for txn, cat_name in rows
    ]


def _flex_history(title: str, rows: list[dict]) -> dict:
    if not rows:
        body_contents = [{"type": "text", "text": "No transactions yet.", "color": "#888888", "align": "center"}]
    else:
        body_contents = []
        for r in rows:
            date_label = r["date"][5:]  # MM-DD
            is_expense = r.get("type", "expense") == "expense"
            amount_color = "#E53E3E" if is_expense else "#06C755"
            sign = "-" if is_expense else "+"
            body_contents.append({
                "type": "box",
                "layout": "horizontal",
                "margin": "sm",
                "contents": [
                    {
                        "type": "box",
                        "layout": "vertical",
                        "flex": 5,
                        "contents": [
                            {"type": "text", "text": r["description"], "size": "sm", "wrap": True},
                            {"type": "text", "text": f"{r.get('category', '')}  {date_label}", "size": "xs", "color": "#888888"},
                        ],
                    },
                    {
                        "type": "text",
                        "text": f"{sign}{r['currency']} {r['amount']:,.0f}",
                        "size": "sm",
                        "weight": "bold",
                        "color": amount_color,
                        "align": "end",
                        "flex": 3,
                        "gravity": "center",
                    },
                ],
            })

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "contents": [
                {"type": "text", "text": title, "color": "#ffffff", "weight": "bold", "size": "md"},
            ],
        },
        "body": {"type": "box", "layout": "vertical", "spacing": "none", "contents": body_contents},
    }


def _flex_dm_balance(month: str, summary: dict, currency: str = "TWD") -> dict:
    income = summary.get("total_income", Decimal("0"))
    expenses = summary.get("total_expenses", Decimal("0"))
    net = summary.get("net_amount", Decimal("0"))
    txn_count = summary.get("transaction_count", 0)

    net_color = "#06C755" if net >= 0 else "#E53E3E"
    net_sign = "+" if net >= 0 else ""

    # Savings rate bar (income > 0 guard)
    savings_pct = max(0, min(100, int((float(net) / float(income) * 100) if income > 0 else 0)))
    bar_filled = max(1, savings_pct)
    bar_empty = 100 - bar_filled

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "📅 Monthly Overview", "color": "#aaaaaa", "size": "xs"},
                {"type": "text", "text": month, "color": "#ffffff", "weight": "bold", "size": "lg"},
                {"type": "text", "text": f"{txn_count} transactions", "color": "#aaaaaa", "size": "xs", "margin": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "paddingAll": "16px",
            "contents": [
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {
                            "type": "box",
                            "layout": "vertical",
                            "flex": 1,
                            "contents": [
                                {"type": "text", "text": "Income", "size": "xs", "color": "#888888"},
                                {"type": "text", "text": f"{currency} {income:,.0f}", "size": "md", "weight": "bold", "color": "#06C755"},
                            ],
                        },
                        {
                            "type": "box",
                            "layout": "vertical",
                            "flex": 1,
                            "contents": [
                                {"type": "text", "text": "Expenses", "size": "xs", "color": "#888888", "align": "end"},
                                {"type": "text", "text": f"{currency} {expenses:,.0f}", "size": "md", "weight": "bold", "color": "#E53E3E", "align": "end"},
                            ],
                        },
                    ],
                },
                {"type": "separator"},
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "Net Savings", "size": "sm", "weight": "bold", "flex": 3, "gravity": "center"},
                        {"type": "text", "text": f"{net_sign}{currency} {net:,.0f}", "size": "lg", "weight": "bold", "color": net_color, "flex": 4, "align": "end", "gravity": "center"},
                    ],
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xs",
                    "contents": [
                        {"type": "text", "text": f"Savings rate  {savings_pct}%", "size": "xs", "color": "#888888"},
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "height": "6px",
                            "margin": "xs",
                            "contents": [
                                {"type": "box", "layout": "vertical", "backgroundColor": "#06C755", "flex": bar_filled, "contents": [{"type": "filler"}]},
                                {"type": "box", "layout": "vertical", "backgroundColor": "#EEEEEE", "flex": bar_empty, "contents": [{"type": "filler"}]},
                            ],
                        },
                    ],
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "📜 History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "📊 Categories", "data": "cmd=summary", "displayText": "Spending summary"},
                    "style": "primary",
                    "color": "#1A1A2E",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


def _flex_dm_summary(month: str, rows: list[dict], currency: str = "TWD") -> dict:
    body_rows: list[dict] = []
    total = sum(cat.get("total_amount", 0) for cat in rows)

    for cat in rows:
        name = cat.get("category_name", "Other")
        amount = cat.get("total_amount", 0)
        pct = cat.get("pct", 0)
        color = _cat_color(name)
        icon = _cat_icon(name)
        pct_int = max(1, min(99, round(pct)))

        body_rows.append({
            "type": "box",
            "layout": "vertical",
            "margin": "md",
            "contents": [
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "flex": 5,
                            "contents": [
                                {"type": "text", "text": icon, "size": "sm", "flex": 0},
                                {"type": "text", "text": f"  {name}", "size": "sm", "weight": "bold", "gravity": "center"},
                            ],
                        },
                        {
                            "type": "box",
                            "layout": "vertical",
                            "flex": 4,
                            "contents": [
                                {"type": "text", "text": f"{currency} {amount:,.0f}", "size": "sm", "weight": "bold", "color": "#E53E3E", "align": "end"},
                                {"type": "text", "text": f"{pct:.1f}%", "size": "xs", "color": "#888888", "align": "end"},
                            ],
                        },
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "height": "6px",
                    "margin": "xs",
                    "contents": [
                        {"type": "box", "layout": "vertical", "backgroundColor": color, "flex": pct_int, "contents": [{"type": "filler"}]},
                        {"type": "box", "layout": "vertical", "backgroundColor": "#EEEEEE", "flex": 100 - pct_int, "contents": [{"type": "filler"}]},
                    ],
                },
            ],
        })

    # Totals row
    body_rows.append({"type": "separator", "margin": "lg"})
    body_rows.append({
        "type": "box",
        "layout": "horizontal",
        "margin": "md",
        "contents": [
            {"type": "text", "text": "Total Expenses", "size": "sm", "weight": "bold", "flex": 5},
            {"type": "text", "text": f"{currency} {total:,.0f}", "size": "sm", "weight": "bold", "color": "#E53E3E", "flex": 4, "align": "end"},
        ],
    })

    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#2D3748",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "📊 Spending by Category", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": month, "color": "#aaaaaa", "size": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "none",
            "paddingAll": "16px",
            "contents": body_rows,
        },
        "footer": {
            "type": "box",
            "layout": "horizontal",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "💳 Log Spend", "data": "cmd=txn_start", "displayText": "Log a spend"},
                    "style": "primary",
                    "color": "#2D3748",
                    "height": "sm",
                    "flex": 1,
                },
                {
                    "type": "button",
                    "action": {"type": "postback", "label": "📜 History", "data": "cmd=history", "displayText": "Show history"},
                    "style": "secondary",
                    "height": "sm",
                    "flex": 1,
                },
            ],
        },
    }


async def handle_history_command(
    db: AsyncSession,
    line_user_id: str,
    line_group_id: Optional[str],
    reply_token: str,
    limit: int = 5,
) -> None:
    """Show the last N transactions.

    Group context: shows shared group expenses only (never personal data).
    DM context: shows personal Aspiro transactions.
    """
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    await _log_activity(db, link.user_id, "history", "Viewed transaction history")

    # --- Group context ---
    if line_group_id:
        group = await LineGroupRepository(db).get_group_by_line_group_id(line_group_id)
        group_expenses = await get_group_expenses(db, group.id, limit=limit) if group else []

        if group_expenses:
            payer_ids = {e.payer_id for e in group_expenses}
            link_rows = await LineAccountRepository(db).get_links_by_user_ids(payer_ids)
            names = {row.user_id: (row.display_name or str(row.user_id)[:8]) for row in link_rows}

            rows = [
                {
                    "date": e.created_at.strftime("%Y-%m-%d"),
                    "description": e.description,
                    "amount": e.amount,
                    "currency": e.currency,
                    "category": f"by {names.get(e.payer_id, '?')}",
                    "type": "expense",
                }
                for e in group_expenses
            ]
            flex = _flex_history(f"Last {len(rows)} Group Expenses", rows)
            await _reply_flex(reply_token, "Group expense history", flex, GROUP_QR)
            return

        # No group expenses yet — show a group-scoped empty state. Never fall back
        # to the user's PERSONAL transactions here: this is a shared group chat, so
        # that would both leak personal data and isn't what group /history means.
        await _reply(
            reply_token,
            "No expenses in this group yet.\nTap 💰 Add or type \"/add 150 coffee\" to log the first shared expense.",
            [_qr_postback("💰 Add expense", "cmd=add_start", "Add expense"), *GROUP_QR[:3]],
        )
        return

    # --- DM context ---
    personal = await _fetch_personal_history(db, link.user_id, limit)
    flex = _flex_history("Your Recent Transactions", personal)
    await _reply_flex(
        reply_token,
        "Your recent transactions",
        flex,
        [_qr_postback("💳 Add spending", "cmd=txn_start", "Add another"), _qr_postback("❓ Help", "cmd=help", "Help")],
    )


async def handle_undo_command(
    db: AsyncSession,
    line_user_id: str,
    line_group_id: str,
    reply_token: str,
) -> None:
    """Delete the last shared expense recorded by the current user in this group."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    group_repo = LineGroupRepository(db)
    group = await group_repo.get_group_by_line_group_id(line_group_id)
    if group is None:
        await _reply(reply_token, "No expenses in this group yet.")
        return

    if await group_repo.get_member(group.id, link.user_id) is None:
        await _reply(reply_token, "You're not a member of this group.")
        return

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    expense_repo = SharedExpenseRepository(db)
    last = await expense_repo.get_last_expense_by_payer_for_update(
        group_id=group.id, payer_id=link.user_id, since=cutoff
    )
    if last is None:
        await _reply(reply_token, "No recent expenses to undo. Only expenses added in the last 30 minutes can be undone.")
        return

    desc = last.description
    amount = last.amount
    currency = last.currency
    await expense_repo.delete_expense(last)
    await db.flush()

    await _log_activity(db, link.user_id, "undo_expense", f"Removed: {desc} {currency} {amount:,.0f}", amount=amount, currency=currency)
    flex = _flex_undo_confirm(desc, currency, amount)
    await _reply_flex(reply_token, f"Removed: {desc} {currency} {amount:,.0f}", flex, GROUP_QR)


async def handle_summary_command(
    db: AsyncSession,
    line_user_id: str,
    line_group_id: str,
    reply_token: str,
) -> None:
    """Show monthly expense totals for the group."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    group = await LineGroupRepository(db).get_group_by_line_group_id(line_group_id)
    if group is None:
        await _reply(reply_token, "No expenses in this group yet.")
        return

    # The month is the business (Taipei) month: in UTC, the first eight hours
    # of each month still counted as, and were titled, the previous one.
    now = business_now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    expenses = await SharedExpenseRepository(db).get_expenses_since(
        group.id, month_start.astimezone(timezone.utc)
    )

    if not expenses:
        await _reply(reply_token, f"No expenses this month ({now.strftime('%B')}).")
        return

    total = sum(e.amount for e in expenses)

    # Per-person paid totals
    paid_by: dict[UUID, Decimal] = {}
    owed_by: dict[UUID, Decimal] = {}
    for e in expenses:
        paid_by[e.payer_id] = paid_by.get(e.payer_id, Decimal("0")) + e.amount
        for s in e.splits:
            owed_by[s.user_id] = owed_by.get(s.user_id, Decimal("0")) + s.amount

    # Get display names
    all_ids = set(paid_by) | set(owed_by)
    link_rows = await LineAccountRepository(db).get_links_by_user_ids(all_ids)
    names = {row.user_id: (row.display_name or str(row.user_id)[:8]) for row in link_rows}

    month_name = now.strftime("%B %Y")
    flex = _flex_group_summary(month_name, group.currency, total, len(expenses), paid_by, names)
    await _reply_flex(reply_token, f"{month_name} Group Summary", flex, GROUP_QR)


async def handle_txn_command(
    db: AsyncSession,
    text: str,
    line_user_id: str,
    reply_token: str,
) -> None:
    """Record a personal transaction for the current user directly from LINE."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    parsed = _parse_txn(text)
    if parsed is None:
        await _reply(
            reply_token,
            "Usage: /txn <amount> <category> <description>\n"
            "Categories: food transport shopping entertainment health other\n\n"
            "Examples:\n"
            "  /txn 150 food coffee\n"
            "  /txn 1200 transport taxi home\n"
            "  /txn 500 shopping new shoes",
        )
        return

    amount, category_name, description = parsed

    if amount <= 0:
        await _reply(reply_token, "Amount must be greater than zero.")
        return

    currency = await _get_user_currency(db, link.user_id)

    # TODO(repo): these read/write the transactions module's tables
    # (TransactionCategory / Transaction), not line_bot-owned entities. Left in
    # service to avoid reaching across module boundaries; belongs in the
    # transactions repository if consolidated later.
    # Targeted lookup instead of loading the full categories table
    cat_result = await db.execute(
        select(TransactionCategory)
        .where(TransactionCategory.name.ilike(category_name))
        .limit(1)
    )
    category = cat_result.scalar_one_or_none()
    if category is None:
        fallback_result = await db.execute(
            select(TransactionCategory)
            .where(
                TransactionCategory.name.ilike("%other%")
                | TransactionCategory.name.ilike("%misc%")
            )
            .limit(1)
        )
        category = fallback_result.scalar_one_or_none()
    if category is None:
        # Last resort: pick any available category so category_id NOT NULL is satisfied
        any_cat_result = await db.execute(select(TransactionCategory).limit(1))
        category = any_cat_result.scalar_one_or_none()
    if category is None:
        await _reply(reply_token, "Could not find a transaction category. Please set up categories in the Aspiro app first.")
        return

    txn = Transaction(
        user_id=link.user_id,
        type=TransactionType.EXPENSE,
        wallet_type=TransactionWalletType.LIFE,
        amount=amount,
        currency=currency,
        description=description,
        category_id=category.id,
        payment_method=PaymentMethod.OTHER,
        transaction_date=business_today(),
        notes="Added via LINE bot",
    )
    db.add(txn)
    await db.flush()

    cat_label = category.name
    await _log_activity(db, link.user_id, "txn", f"Logged: {description} {currency} {amount:,.0f}", amount=amount, currency=currency)
    flex = _flex_txn_confirm(description, amount, currency, cat_label)
    await _reply_flex(
        reply_token,
        f"Recorded: {description} {currency} {amount:,.0f}",
        flex,
        [_qr_postback("💳 Add another", "cmd=txn_start", "Add another"), _qr_postback("📜 History", "cmd=history", "Show history")],
    )


# ---------------------------------------------------------------------------
# Quick log — plain-text bookkeeping in a DM ("午餐 120", "+50000 薪水")
# ---------------------------------------------------------------------------

LINE_TXN_NOTE = "Added via LINE bot"
# Undo and re-categorise reach only the user's own LINE-made rows, and only for
# a day: a stale button in the chat history must not edit last month's books.
QUICK_EDIT_WINDOW = timedelta(hours=24)
QUICK_FAVORITES_LOOKBACK_DAYS = 60
QUICK_FAVORITES_MIN_COUNT = 3


def _amount_text(amount: Decimal) -> str:
    """1200 → "1200", 12.50 → "12.5": what a person would type back."""
    return format(amount.normalize(), "f")


async def _find_category(db: AsyncSession, name: str, cat_type: CategoryType) -> Optional[TransactionCategory]:
    """The active category with this name and type. Duplicate global rows exist
    (Dining, Others); the most used one wins, so a guess lands where the user's
    history already is."""
    result = await db.execute(
        select(TransactionCategory)
        .where(
            TransactionCategory.is_active.is_(True),
            TransactionCategory.type == cat_type,
            sqlfunc.lower(TransactionCategory.name) == name.lower(),
        )
        .order_by(TransactionCategory.usage_count.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _category_from_history(
    db: AsyncSession, user_id: UUID, description: str, txn_type: TransactionType
) -> Optional[TransactionCategory]:
    """The category this user filed the same description under most often."""
    result = await db.execute(
        select(TransactionCategory)
        .join(Transaction, Transaction.category_id == TransactionCategory.id)
        .where(
            Transaction.user_id == user_id,
            Transaction.type == txn_type,
            sqlfunc.lower(Transaction.description) == description.lower(),
            TransactionCategory.is_active.is_(True),
        )
        .group_by(TransactionCategory.id)
        .order_by(sqlfunc.count(Transaction.id).desc(), sqlfunc.max(Transaction.created_at).desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _resolve_quick_category(
    db: AsyncSession, user_id: UUID, description: str, is_income: bool
) -> Optional[TransactionCategory]:
    txn_type = TransactionType.INCOME if is_income else TransactionType.EXPENSE
    cat_type = CategoryType.INCOME if is_income else CategoryType.EXPENSE
    category = await _category_from_history(db, user_id, description, txn_type)
    if category is not None:
        return category
    category = await _find_category(db, guess_category_name(description, is_income), cat_type)
    if category is not None:
        return category
    return await _find_category(db, FALLBACK_CATEGORY, cat_type)


async def _quick_favorites(db: AsyncSession, user_id: UUID) -> list[tuple[str, Decimal]]:
    """The expenses this user repeats — same description and amount, 3+ times in
    the last 60 days — offered back as one-tap entries."""
    since = business_today() - timedelta(days=QUICK_FAVORITES_LOOKBACK_DAYS)
    result = await db.execute(
        select(Transaction.description, Transaction.amount, sqlfunc.count(Transaction.id).label("n"))
        .where(
            Transaction.user_id == user_id,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.transaction_date >= since,
        )
        .group_by(Transaction.description, Transaction.amount)
        .having(sqlfunc.count(Transaction.id) >= QUICK_FAVORITES_MIN_COUNT)
        .order_by(sqlfunc.count(Transaction.id).desc())
        .limit(4)
    )
    return [(row.description, row.amount) for row in result.all() if parse_quick_entry(f"{row.description} {_amount_text(row.amount)}")]


def _quick_log_replies(txn_id: UUID, favorites: list[tuple[str, Decimal]]) -> list[dict]:
    replies = [
        _qr_postback("↩️ Undo", f"cmd=qlog_undo&t={txn_id}", "Undo"),
        _qr_postback("🏷️ Category", f"cmd=qlog_cat&t={txn_id}", "Change category"),
    ]
    for desc, amount in favorites:
        text = f"{desc} {_amount_text(amount)}"
        replies.append(_qr_message(f"⚡ {text}"[:20], text))
    replies.append(_qr_postback("📋 Menu", "cmd=menu", "Menu"))
    return replies


async def handle_quick_log(
    db: AsyncSession,
    text: str,
    line_user_id: str,
    reply_token: str,
) -> bool:
    """Record "午餐 120" / "+50000 薪水" typed in a DM. Returns False when the text
    is not a bookkeeping line, so the caller can fall back to the menu."""
    entry = parse_quick_entry(text)
    if entry is None:
        return False

    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return True

    category = await _resolve_quick_category(db, link.user_id, entry.description, entry.is_income)
    if category is None:
        await _reply(reply_token, "Could not find a transaction category. Please set up categories in the Aspiro app first.")
        return True

    currency = await _get_user_currency(db, link.user_id)
    txn = Transaction(
        user_id=link.user_id,
        type=TransactionType.INCOME if entry.is_income else TransactionType.EXPENSE,
        wallet_type=TransactionWalletType.LIFE,
        amount=entry.amount,
        currency=currency,
        description=entry.description,
        category_id=category.id,
        payment_method=PaymentMethod.OTHER,
        transaction_date=business_today(),
        notes=LINE_TXN_NOTE,
    )
    db.add(txn)
    await db.flush()

    kind = "Income" if entry.is_income else "Logged"
    await _log_activity(
        db, link.user_id, "txn", f"{kind}: {entry.description} {currency} {_money_text(entry.amount)}",
        amount=entry.amount, currency=currency,
    )
    favorites = [] if entry.is_income else await _quick_favorites(db, link.user_id)
    sign = "+" if entry.is_income else ""
    await _reply_flex(
        reply_token,
        f"Recorded: {entry.description} {sign}{currency} {_money_text(entry.amount)} · {category.name}",
        _flex_txn_confirm(entry.description, entry.amount, currency, category.name),
        _quick_log_replies(txn.id, favorites),
    )
    return True


async def _get_quick_txn(db: AsyncSession, user_id: UUID, txn_id: str) -> Optional[Transaction]:
    """A LINE-made transaction of this user from the last day, or None."""
    try:
        tid = UUID(txn_id)
    except (ValueError, TypeError):
        return None
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == tid,
            Transaction.user_id == user_id,
            Transaction.notes == LINE_TXN_NOTE,
            Transaction.created_at >= datetime.now(timezone.utc) - QUICK_EDIT_WINDOW,
        )
    )
    return result.scalar_one_or_none()


async def handle_quick_undo(db: AsyncSession, line_user_id: str, reply_token: str, txn_id: str) -> None:
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return
    txn = await _get_quick_txn(db, link.user_id, txn_id)
    if txn is None:
        await _reply(reply_token, "Nothing to undo — only entries made here in the last 24 hours can be undone.", DM_QR)
        return
    desc, amount, currency = txn.description, txn.amount, txn.currency
    await db.delete(txn)
    await db.flush()
    await _log_activity(db, link.user_id, "undo_txn", f"Removed: {desc} {currency} {_money_text(amount)}", amount=amount, currency=currency)
    await _reply_flex(reply_token, f"Removed: {desc} {currency} {_money_text(amount)}", _flex_undo_confirm(desc, currency, amount), DM_QR)


async def handle_quick_category_picker(db: AsyncSession, line_user_id: str, reply_token: str, txn_id: str) -> None:
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return
    txn = await _get_quick_txn(db, link.user_id, txn_id)
    if txn is None:
        await _reply(reply_token, "That entry can no longer be changed here — edit it in the Aspiro app.", DM_QR)
        return
    cat_type = CategoryType.INCOME if txn.type == TransactionType.INCOME else CategoryType.EXPENSE
    result = await db.execute(
        select(TransactionCategory)
        .where(TransactionCategory.is_active.is_(True), TransactionCategory.type == cat_type)
        .order_by(TransactionCategory.usage_count.desc())
    )
    categories = list(result.scalars())
    # Skip by name, not id: a duplicate global row of the current category
    # (two "Dining" rows exist) would otherwise be offered as a "change".
    current = next((c.name.lower() for c in categories if c.id == txn.category_id), None)
    seen: set[str] = {current} if current else set()
    replies: list[dict] = []
    for cat in categories:
        key = cat.name.lower()
        if key in seen or key in {"transfer", "investment purchase", "investment sale", "loan receipt"}:
            continue
        seen.add(key)
        label = f"{_cat_icon(cat.name)} {cat.name}"[:20]
        replies.append(_qr_postback(label, f"cmd=qlog_set&t={txn.id}&c={cat.id}", cat.name))
        if len(replies) == 12:  # LINE allows 13 quick replies
            break
    await _reply(reply_token, f"Move “{txn.description}” to which category?", replies)


async def handle_quick_set_category(
    db: AsyncSession, line_user_id: str, reply_token: str, txn_id: str, category_id: str
) -> None:
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return
    txn = await _get_quick_txn(db, link.user_id, txn_id)
    if txn is None:
        await _reply(reply_token, "That entry can no longer be changed here — edit it in the Aspiro app.", DM_QR)
        return
    try:
        cid = UUID(category_id)
    except (ValueError, TypeError):
        await _reply(reply_token, "Unknown category.", DM_QR)
        return
    cat_type = CategoryType.INCOME if txn.type == TransactionType.INCOME else CategoryType.EXPENSE
    category = (await db.execute(
        select(TransactionCategory).where(
            TransactionCategory.id == cid,
            TransactionCategory.is_active.is_(True),
            TransactionCategory.type == cat_type,
        )
    )).scalar_one_or_none()
    if category is None:
        await _reply(reply_token, "Unknown category.", DM_QR)
        return
    # Re-filing the row is also how the bot learns: the next "<same description>"
    # resolves from this user's history before any keyword guess.
    txn.category_id = category.id
    await db.flush()
    await _reply(
        reply_token,
        f"{_cat_icon(category.name)} “{txn.description}” is now {category.name}. Next time I'll file it there.",
        _quick_log_replies(txn.id, []),
    )


async def handle_help_command(reply_token: str, is_group: bool = False) -> None:
    carousel = _flex_help(is_group=is_group)
    alt = "Group Commands" if is_group else "Aspiro Commands"
    await _reply_flex(reply_token, alt, carousel, GROUP_QR if is_group else DM_QR)


# ---------------------------------------------------------------------------
# Main webhook event dispatcher
# ---------------------------------------------------------------------------


async def handle_join_event(event: LineEvent) -> None:
    """Bot was added to a group or room.

    When LIFF is configured, post a SINGLE clean card with an "Open Aspiro" button
    (rich interaction happens in the LIFF app, keeping the group chat tidy). Otherwise
    fall back to the legacy welcome + interactive command-menu cards.
    """
    if not event.replyToken:
        return
    liff_url = _liff_url()
    if liff_url:
        await _reply_flex(
            event.replyToken,
            "Hi! I'm Aspiro — tap to open and split expenses",
            _flex_group_join_liff(liff_url),
        )
        return
    welcome_flex = _flex_group_join_welcome()
    menu_flex = _flex_main_menu(is_group=True)
    await _send(event.replyToken, [
        {"type": "flex", "altText": "Hi! I'm Aspiro — your group expense tracker", "contents": welcome_flex},
        {"type": "flex", "altText": "Group Expense Menu — tap to get started", "contents": menu_flex},
    ])


async def handle_member_joined_event(event: LineEvent) -> None:
    """New member joined the group — prompt them to /link."""
    if not event.replyToken:
        return
    members = (event.model_extra or {}).get("joined", {}).get("members", [])
    count = len(members)
    noun = "member" if count == 1 else "members"
    await _reply(
        event.replyToken,
        f"Welcome, new {noun}!\nType /link to connect your Aspiro account and start splitting expenses.",
    )


async def handle_follow_event(db: AsyncSession, event: LineEvent) -> None:
    """User added the bot as a friend — show personal assistant welcome."""
    if not event.replyToken:
        return
    line_user_id = event.source.userId
    if not line_user_id:
        return

    link = await _get_link(db, line_user_id)
    if link:
        name = link.display_name or "there"
        welcome_flex = _flex_welcome_back(name)
        menu_flex = _flex_main_menu(is_group=False)
        await _send(event.replyToken, [
            {"type": "flex", "altText": f"Welcome back, {name}!", "contents": welcome_flex,
             "quickReply": {"items": DM_QR}},
            {"type": "flex", "altText": "Aspiro Menu — tap to get started", "contents": menu_flex},
        ])
    else:
        account_repo = LineAccountRepository(db)
        token = account_repo.add_token(
            line_user_id=line_user_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=LINK_TOKEN_TTL_MINUTES),
        )
        await db.flush()
        # Purge old tokens only after new one is flushed to avoid a window
        # where the user has no valid token if the flush or reply fails.
        await account_repo.purge_unused_tokens(line_user_id, token.token)
        frontend_url = settings.FRONTEND_URL or "https://aspiro.app"
        # openExternalBrowser=1 forces LINE to open the link in the device's default
        # browser instead of its in-app webview. Required because the link-line page
        # may bounce to Google OAuth, and Google blocks sign-in from embedded webviews
        # with "disallowed_useragent" (403).
        link_url = f"{frontend_url}/link-line?token={token.token}&openExternalBrowser=1"
        welcome_flex = _flex_welcome_new(link_url, LINK_TOKEN_TTL_MINUTES)
        menu_flex = _flex_main_menu(is_group=False)
        await _send(event.replyToken, [
            {"type": "flex", "altText": "Hi! I'm your Aspiro finance assistant", "contents": welcome_flex},
            {"type": "flex", "altText": "Aspiro Menu — tap to get started", "contents": menu_flex,
             "quickReply": {"items": [_qr_postback("🔗 Link Account", "cmd=link", "Link account"), _qr_postback("❓ Help", "cmd=help", "Help")]}},
        ])


async def handle_dm_balance_command(
    db: AsyncSession,
    line_user_id: str,
    reply_token: str,
) -> None:
    """Show personal monthly finance summary (income, expenses, net)."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    now = business_now()  # the business month: transaction dates are Taipei days
    month_start = date(now.year, now.month, 1)
    month_end = date(now.year + 1, 1, 1) if now.month == 12 else date(now.year, now.month + 1, 1)

    repo = TransactionRepository(db)
    summary = await repo.get_summary(
        user_id=str(link.user_id),
        date_from=month_start,
        date_to=month_end,
    )

    month_name = now.strftime("%B %Y")
    await _log_activity(db, link.user_id, "balance", "Checked wallet balance")
    # get_summary totals in TWD whatever currency the rows were entered in, so
    # the card says TWD. Labelling it with the user's preferred currency put
    # "USD 31,500" on a month of US$1,000.
    flex = _flex_dm_balance(month_name, summary, summary.get("currency", "TWD"))
    await _reply_flex(reply_token, f"{month_name} Summary", flex, DM_QR)


async def handle_dm_summary_command(
    db: AsyncSession,
    line_user_id: str,
    reply_token: str,
) -> None:
    """Show spending by category for the current month."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    from app.utils.fx_sql import in_twd

    now = business_now()  # the business month: transaction dates are Taipei days
    month_start = date(now.year, now.month, 1)
    month_end = date(now.year + 1, 1, 1) if now.month == 12 else date(now.year, now.month + 1, 1)

    # Same rows and same unit as /balance, which reads get_summary: completed,
    # not deleted, and every amount in TWD. Summing the raw column here meant
    # /balance counted a US$100 expense as ~NT$3,150 while this card counted 100.
    conditions = [
        *TransactionRepository.counted_conditions(link.user_id),
        Transaction.type == TransactionType.EXPENSE,
        Transaction.transaction_date >= month_start,
        Transaction.transaction_date < month_end,
    ]
    rates = await TransactionRepository(db).twd_rates_for_conditions(conditions)
    amount_twd = in_twd(Transaction.amount, Transaction.currency, rates)

    # TODO(repo): aggregates the transactions module's tables — cross-module
    # read, left in service rather than the line_bot repository.
    stmt = (
        select(
            TransactionCategory.name.label("category_name"),
            sqlfunc.sum(amount_twd).label("total_amount"),
        )
        .join(TransactionCategory, Transaction.category_id == TransactionCategory.id)
        .where(and_(*conditions))
        .group_by(TransactionCategory.name)
        .order_by(sqlfunc.sum(amount_twd).desc())
        .limit(6)
    )
    result = await db.execute(stmt)
    rows = result.all()

    month_name = now.strftime("%B %Y")
    if not rows:
        await _reply(
            reply_token,
            f"No expenses recorded for {month_name} yet.\nUse /txn to log spending.",
            DM_QR,
        )
        return

    total = sum(float(r.total_amount) for r in rows)
    breakdown = [
        {
            "category_name": r.category_name,
            "total_amount": float(r.total_amount),
            "pct": (float(r.total_amount) / total * 100) if total > 0 else 0,
        }
        for r in rows
    ]

    await _log_activity(db, link.user_id, "summary", f"Viewed spending summary — {len(breakdown)} categories")
    chart_url = _category_pie_url(breakdown)
    flex = _flex_dm_summary(month_name, breakdown, "TWD")
    await _send(reply_token, [
        {
            "type": "image",
            "originalContentUrl": chart_url,
            "previewImageUrl": chart_url,
        },
        {
            "type": "flex",
            "altText": f"{month_name} Spending by Category",
            "contents": flex,
            "quickReply": {"items": DM_QR},
        },
    ])


async def handle_goals_command(
    db: AsyncSession,
    line_user_id: str,
    reply_token: str,
) -> None:
    """Show active financial goals with progress bars."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    currency = await _get_user_currency(db, link.user_id)

    # TODO(repo): reads the goals module's tables — cross-module read, left in service.
    result = await db.execute(
        select(Goal)
        .where(
            and_(
                Goal.user_id == link.user_id,
                Goal.status == GoalStatus.ACTIVE,
            )
        )
        .order_by(Goal.target_date.asc().nullslast())
        .limit(4)
    )
    goals = result.scalars().all()

    today = business_today()
    goal_rows = [
        {
            # Goals have a title, not a name: g.name raised for anyone with a goal.
            "name": g.title,
            "current_amount": float(g.current_amount),
            "target_amount": float(g.target_amount),
            "days_left": (business_day_of(g.target_date) - today).days if g.target_date else None,
        }
        for g in goals
    ]

    await _log_activity(db, link.user_id, "goals", f"Viewed goals ({len(goal_rows)} active)")
    flex = _flex_goals(goal_rows, currency)
    await _reply_flex(reply_token, "Your Financial Goals", flex, DM_QR)


async def handle_portfolio_command(
    db: AsyncSession,
    line_user_id: str,
    reply_token: str,
) -> None:
    """Show a portfolio snapshot: total value, return %, top holdings."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link your Aspiro account", _flex_not_linked())
        return

    currency = await _get_user_currency(db, link.user_id)

    # TODO(repo): reads the portfolio module's tables — cross-module read, left in service.
    portfolio_result = await db.execute(
        select(Portfolio).where(Portfolio.user_id == link.user_id)
        .order_by(Portfolio.created_at.desc()).limit(1)
    )
    portfolio = portfolio_result.scalar_one_or_none()

    if portfolio is None:
        await _reply_flex(
            reply_token,
            "No portfolio yet",
            _flex_portfolio([], 0.0, 0.0, currency),
            DM_QR,
        )
        return

    holdings_result = await db.execute(
        select(PortfolioHolding)
        .where(
            PortfolioHolding.portfolio_id == portfolio.id,
            PortfolioHolding.is_active == True,
        )
        .order_by(PortfolioHolding.total_value.desc())
    )
    holdings = holdings_result.scalars().all()

    # Aggregate multiple lots of the same symbol (mirrors frontend logic)
    symbol_map: dict[str, dict] = {}
    for h in holdings:
        key = h.symbol.upper()
        if key not in symbol_map:
            symbol_map[key] = {
                "symbol": key,
                "name": h.name or key,
                "total_value": 0.0,
                "total_cost": 0.0,
                "currency": h.currency or portfolio.currency,
            }
        symbol_map[key]["total_value"] += float(h.total_value)
        cost = float(h.total_cost) if h.total_cost is not None else float(h.quantity) * float(h.average_cost)
        symbol_map[key]["total_cost"] += cost

    holding_rows = []
    for agg in symbol_map.values():
        tc = agg["total_cost"]
        tv = agg["total_value"]
        gain_pct = ((tv - tc) / tc * 100) if tc > 0 else 0.0
        holding_rows.append({
            "symbol": agg["symbol"],
            "name": agg["name"],
            "total_value": tv,
            "gain_loss_percentage": gain_pct,
            "currency": agg["currency"],
        })

    # Sort by total value descending and take top 5
    holding_rows.sort(key=lambda r: r["total_value"], reverse=True)
    holding_rows = holding_rows[:5]

    total_value = float(portfolio.total_value)
    total_gain_pct = float(portfolio.total_gain_loss_percentage)

    await _log_activity(db, link.user_id, "portfolio", "Viewed portfolio")
    # Total is denominated in the portfolio's base currency (not the user's display
    # preference) — the bot shows stored values without FX conversion.
    flex = _flex_portfolio(holding_rows, total_value, total_gain_pct, portfolio.currency)
    await _reply_flex(reply_token, f"Portfolio  {currency} {total_value:,.0f}", flex, DM_QR)


def _flex_rate(base: str, rates: dict[str, float], source: str = "live") -> dict:
    """Flex bubble showing exchange rates relative to *base* currency."""
    flag_map = {
        "USD": "🇺🇸", "TWD": "🇹🇼", "JPY": "🇯🇵", "EUR": "🇪🇺",
        "GBP": "🇬🇧", "KRW": "🇰🇷", "HKD": "🇭🇰", "SGD": "🇸🇬",
        "CNY": "🇨🇳", "THB": "🇹🇭", "MYR": "🇲🇾",
    }
    rows = []
    for currency, rate in rates.items():
        if currency == base:
            continue
        flag = flag_map.get(currency, "🌐")
        # Format: small numbers with 4 dp, large with 2 dp
        rate_str = f"{rate:.4f}" if rate < 10 else f"{rate:.2f}"
        rows.append({
            "type": "box",
            "layout": "horizontal",
            "margin": "sm",
            "contents": [
                {"type": "text", "text": f"{flag} {currency}", "size": "sm", "flex": 3},
                {"type": "text", "text": rate_str, "size": "sm", "weight": "bold",
                 "align": "end", "flex": 3, "color": "#2D3436"},
            ],
        })

    source_label = "Live" if source == "live" else "Approx."
    return {
        "type": "bubble",
        "size": "kilo",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#16213E",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "💱 Exchange Rates", "color": "#ffffff",
                 "weight": "bold", "size": "lg"},
                {"type": "text", "text": f"Base: 1 {base}  •  {source_label}",
                 "color": "#aaaaaa", "size": "xs", "margin": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "none",
            "paddingAll": "12px",
            "contents": rows or [
                {"type": "text", "text": "No rates available.", "color": "#888888", "align": "center"}
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#F0F0F0",
            "paddingAll": "8px",
            "contents": [
                {"type": "text", "text": "Rates update hourly", "size": "xxs",
                 "color": "#aaaaaa", "align": "center"},
            ],
        },
    }


async def handle_rate_command(
    db: AsyncSession,
    line_user_id: str,
    reply_token: str,
) -> None:
    """Show current exchange rates relative to the user's preferred currency."""
    link = await _get_link_safe(db, line_user_id)
    base = await _get_user_currency(db, link.user_id) if link else "TWD"

    svc = ExchangeRateService(db_session=db)
    targets = ["USD", "TWD", "JPY", "EUR", "GBP", "KRW", "SGD"]
    targets = [t for t in targets if t != base]

    raw_rates = await svc.get_multiple_rates(base, targets)
    rates: dict[str, float] = {}
    source = "live"
    for currency, rate in raw_rates.items():
        if rate is not None:
            rates[currency] = float(rate)
        else:
            # Fallback: use the fallback table
            fb = svc._get_fallback_rates(base)
            if currency in fb:
                rates[currency] = fb[currency]
                source = "approx"

    flex = _flex_rate(base, rates, source)
    await _reply_flex(reply_token, f"Exchange Rates • 1 {base}", flex, DM_QR)


async def _get_link_safe(db: AsyncSession, line_user_id: str):
    """Return LineUserLink or None; logs and suppresses DB errors for optional-link contexts."""
    try:
        return await _get_link(db, line_user_id)
    except Exception:
        logger.warning("DB error in _get_link_safe for %s", line_user_id, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Guided flow flex builders
# ---------------------------------------------------------------------------


def _flex_add_amount_picker(currency: str = "TWD") -> dict:
    """Step 1 of guided expense entry — pick an amount."""
    common = [50, 100, 150, 200, 300, 500, 800, 1000, 1500, 2000]
    rows: list[dict] = []
    # 5 buttons per row
    for i in range(0, len(common), 5):
        chunk = common[i:i+5]
        rows.append({
            "type": "box",
            "layout": "horizontal",
            "spacing": "xs",
            "contents": [
                {
                    "type": "box",
                    "layout": "vertical",
                    "flex": 1,
                    "backgroundColor": "#E8F5E9",
                    "cornerRadius": "8px",
                    "paddingAll": "8px",
                    "alignItems": "center",
                    "action": {
                        "type": "postback",
                        "label": f"{currency} {a}",
                        "data": f"cmd=add_amount&v={a}",
                        "displayText": f"{a}",
                    },
                    "contents": [
                        {"type": "text", "text": f"{a:,}", "size": "sm", "weight": "bold", "align": "center", "color": "#1A5C2A"},
                    ],
                }
                for a in chunk
            ],
        })
    rows.append({
        "type": "box",
        "layout": "vertical",
        "margin": "md",
        "backgroundColor": "#F5F5F5",
        "cornerRadius": "8px",
        "paddingAll": "10px",
        "alignItems": "center",
        "action": {"type": "message", "label": "Custom amount", "text": "Amount: "},
        "contents": [
            {"type": "text", "text": "✏️ Custom amount", "size": "sm", "weight": "bold", "color": "#555555", "align": "center"},
        ],
    })
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#06C755",
            "paddingAll": "14px",
            "contents": [
                {"type": "text", "text": "💰 Add Group Expense", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": f"How much? ({currency})", "color": "#e0ffe0", "size": "xs", "margin": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "12px",
            "contents": rows,
        },
    }


def _flex_add_desc_picker(amount: str, currency: str = "TWD") -> dict:
    """Step 2 of guided expense entry — pick a description."""
    common_descs = [
        ("🍽️", "Meal"),
        ("☕", "Coffee"),
        ("🚗", "Taxi"),
        ("🛒", "Groceries"),
        ("🍻", "Drinks"),
        ("🎬", "Movie"),
        ("🏠", "Rent"),
        ("💡", "Utilities"),
        ("🛍️", "Shopping"),
        ("📦", "Other"),
    ]
    rows: list[dict] = []
    for i in range(0, len(common_descs), 2):
        pair = common_descs[i:i+2]
        row_btns = []
        for icon, label in pair:
            row_btns.append({
                "type": "box",
                "layout": "horizontal",
                "flex": 1,
                "backgroundColor": "#F8FAFC",
                "cornerRadius": "8px",
                "paddingAll": "8px",
                "spacing": "xs",
                "alignItems": "center",
                "action": {
                    "type": "postback",
                    "label": f"{icon} {label}"[:20],
                    "data": f"cmd=add_confirm&a={amount}&d={label.lower()}",
                    "displayText": label,
                },
                "contents": [
                    {"type": "text", "text": icon, "size": "sm", "flex": 0},
                    {"type": "text", "text": label, "size": "sm", "weight": "bold", "margin": "sm", "color": "#333333"},
                ],
            })
        rows.append({"type": "box", "layout": "horizontal", "spacing": "sm", "contents": row_btns})
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#06C755",
            "paddingAll": "14px",
            "contents": [
                {"type": "text", "text": "💰 Add Group Expense", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": f"Amount: {currency} {amount}  —  What was it for?", "color": "#e0ffe0", "size": "xs", "margin": "xs", "wrap": True},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "12px",
            "contents": rows,
        },
    }


def _flex_txn_category_picker() -> dict:
    """Step 1 of guided personal transaction — pick a category."""
    categories = [
        ("🍽️", "Food", "food"),
        ("🚗", "Transport", "transport"),
        ("🛍️", "Shopping", "shopping"),
        ("🎬", "Entertainment", "entertainment"),
        ("🏥", "Healthcare", "health"),
        ("💡", "Utilities", "utilities"),
        ("🏠", "Housing", "housing"),
        ("📦", "Other", "other"),
    ]
    rows: list[dict] = []
    for i in range(0, len(categories), 2):
        pair = categories[i:i+2]
        row_btns = []
        for icon, label, key in pair:
            row_btns.append({
                "type": "box",
                "layout": "vertical",
                "flex": 1,
                "backgroundColor": "#F8FAFC",
                "cornerRadius": "10px",
                "paddingAll": "10px",
                "alignItems": "center",
                "spacing": "xs",
                "action": {
                    "type": "postback",
                    "label": f"{icon} {label}"[:20],
                    "data": f"cmd=txn_cat&c={key}",
                    "displayText": label,
                },
                "contents": [
                    {"type": "text", "text": icon, "size": "xl", "align": "center"},
                    {"type": "text", "text": label, "size": "xs", "weight": "bold", "align": "center", "color": "#333333"},
                ],
            })
        rows.append({"type": "box", "layout": "horizontal", "spacing": "sm", "contents": row_btns})
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "paddingAll": "14px",
            "contents": [
                {"type": "text", "text": "💳 Log a Spend", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": "What category?", "color": "#aaaaaa", "size": "xs", "margin": "xs"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "12px",
            "contents": rows,
        },
    }


def _flex_txn_amount_picker(category: str, currency: str = "TWD") -> dict:
    """Step 2 of guided personal transaction — pick an amount."""
    common = [50, 100, 150, 200, 300, 500, 800, 1000]
    rows: list[dict] = []
    for i in range(0, len(common), 4):
        chunk = common[i:i+4]
        rows.append({
            "type": "box",
            "layout": "horizontal",
            "spacing": "xs",
            "contents": [
                {
                    "type": "box",
                    "layout": "vertical",
                    "flex": 1,
                    "backgroundColor": "#E3F2FD",
                    "cornerRadius": "8px",
                    "paddingAll": "8px",
                    "alignItems": "center",
                    "action": {
                        "type": "postback",
                        "label": f"{a}",
                        "data": f"cmd=txn_amount&c={category}&v={a}",
                        "displayText": f"{a}",
                    },
                    "contents": [
                        {"type": "text", "text": f"{a:,}", "size": "sm", "weight": "bold", "align": "center", "color": "#0D47A1"},
                    ],
                }
                for a in chunk
            ],
        })
    rows.append({
        "type": "box",
        "layout": "vertical",
        "margin": "sm",
        "backgroundColor": "#F5F5F5",
        "cornerRadius": "8px",
        "paddingAll": "10px",
        "alignItems": "center",
        "action": {"type": "message", "label": "Custom amount", "text": "Amount: "},
        "contents": [
            {"type": "text", "text": "✏️ Custom amount", "size": "sm", "weight": "bold", "color": "#555555", "align": "center"},
        ],
    })
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "paddingAll": "14px",
            "contents": [
                {"type": "text", "text": "💳 Log a Spend", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": f"Category: {category.title()}  —  How much? ({currency})", "color": "#aaaaaa", "size": "xs", "margin": "xs", "wrap": True},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "12px",
            "contents": rows,
        },
    }


def _flex_txn_desc_picker(category: str, amount: str) -> dict:
    """Step 3 of guided personal transaction — pick a description."""
    by_category: dict[str, list[tuple[str, str]]] = {
        "food": [("☕", "Coffee"), ("🍱", "Lunch"), ("🍜", "Dinner"), ("🥐", "Breakfast"), ("🧋", "Bubble Tea"), ("🍕", "Takeout")],
        "transport": [("🚕", "Taxi"), ("🚌", "Bus"), ("🚇", "Metro"), ("⛽", "Gas"), ("🛵", "Scooter"), ("✈️", "Flight")],
        "shopping": [("👕", "Clothes"), ("📱", "Electronics"), ("💄", "Beauty"), ("🏠", "Home"), ("📚", "Books"), ("🎁", "Gifts")],
        "entertainment": [("🎬", "Movie"), ("🎮", "Gaming"), ("🎵", "Music"), ("🎳", "Bowling"), ("🏋️", "Gym"), ("🎭", "Events")],
        "health": [("💊", "Medicine"), ("🏥", "Doctor"), ("🦷", "Dentist"), ("💆", "Massage"), ("🧪", "Lab"), ("💉", "Clinic")],
    }
    descs = by_category.get(category, [("📦", "Other"), ("🛒", "Purchase"), ("💳", "Payment"), ("🔧", "Service")])
    rows: list[dict] = []
    for i in range(0, len(descs), 2):
        pair = descs[i:i+2]
        row_btns = []
        for icon, label in pair:
            row_btns.append({
                "type": "box",
                "layout": "horizontal",
                "flex": 1,
                "backgroundColor": "#F8FAFC",
                "cornerRadius": "8px",
                "paddingAll": "8px",
                "spacing": "xs",
                "alignItems": "center",
                "action": {
                    "type": "postback",
                    "label": f"{icon} {label}"[:20],
                    "data": f"cmd=txn_confirm&c={category}&v={amount}&d={label.lower().replace(' ', '_')}",
                    "displayText": label,
                },
                "contents": [
                    {"type": "text", "text": icon, "size": "sm", "flex": 0},
                    {"type": "text", "text": label, "size": "sm", "weight": "bold", "margin": "sm", "color": "#333333"},
                ],
            })
        rows.append({"type": "box", "layout": "horizontal", "spacing": "sm", "contents": row_btns})
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#1A1A2E",
            "paddingAll": "14px",
            "contents": [
                {"type": "text", "text": "💳 Log a Spend", "color": "#ffffff", "weight": "bold", "size": "md"},
                {"type": "text", "text": f"{category.title()} · {amount} — What specifically?", "color": "#aaaaaa", "size": "xs", "margin": "xs", "wrap": True},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "12px",
            "contents": rows,
        },
    }


# ---------------------------------------------------------------------------
# Guided flow handlers
# ---------------------------------------------------------------------------


async def handle_add_expense_start(
    db: AsyncSession, line_user_id: str, line_group_id: Optional[str], reply_token: str
) -> None:
    """Step 1: show amount picker for guided group expense entry."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link first", _flex_not_linked())
        return
    if not line_group_id:
        await _reply_flex(
            reply_token,
            "Group feature",
            {
                "type": "bubble", "size": "kilo",
                "body": {
                    "type": "box", "layout": "vertical", "paddingAll": "20px", "spacing": "md",
                    "contents": [
                        {"type": "text", "text": "👥", "size": "xxl", "align": "center"},
                        {"type": "text", "text": "Group feature", "weight": "bold", "size": "lg", "align": "center"},
                        {"type": "text", "text": "Add me to a LINE group to split expenses with friends.", "size": "sm", "color": "#888888", "wrap": True, "align": "center"},
                    ],
                },
            },
        )
        return
    group = await _get_or_create_group(db, line_group_id, link.user_id)
    flex = _flex_add_amount_picker(group.currency)
    await _reply_flex(reply_token, "Add expense — how much?", flex)


async def handle_add_expense_amount_selected(
    db: AsyncSession, line_user_id: str, line_group_id: Optional[str], reply_token: str, amount: str
) -> None:
    """Step 2: show description picker after amount is chosen."""
    link = await _get_link(db, line_user_id)
    if link is None:
        await _reply_flex(reply_token, "Link first", _flex_not_linked())
        return
    if not line_group_id:
        await _reply(reply_token, "Group expense splitting is only available in group chats.")
        return
    group = await _get_or_create_group(db, line_group_id, link.user_id)
    flex = _flex_add_desc_picker(amount, group.currency)
    await _reply_flex(reply_token, f"Amount: {amount} — what was it for?", flex)


async def handle_add_expense_confirm(
    db: AsyncSession, line_user_id: str, line_group_id: Optional[str], reply_token: str, amount: str, desc: str
) -> None:
    """Step 3: save the expense using the existing add handler."""
    if not line_group_id:
        await _reply(reply_token, "Group expense splitting is only available in group chats.")
        return
    text = f"/add {amount} {desc or 'expense'}"
    await handle_add_command(db, text, line_user_id, line_group_id, reply_token)


async def handle_txn_start(reply_token: str) -> None:
    """Step 1: show category picker for guided personal transaction."""
    flex = _flex_txn_category_picker()
    await _reply_flex(reply_token, "Log a spend — pick a category", flex)


async def handle_txn_category_selected(reply_token: str, category: str, currency: str = "TWD") -> None:
    """Step 2: show amount picker after category is chosen."""
    flex = _flex_txn_amount_picker(category, currency)
    await _reply_flex(reply_token, f"{category.title()} — how much?", flex)


async def handle_txn_amount_selected(reply_token: str, category: str, amount: str) -> None:
    """Step 3: show description picker after amount is chosen."""
    flex = _flex_txn_desc_picker(category, amount)
    await _reply_flex(reply_token, f"{category.title()} · {amount} — what specifically?", flex)


async def handle_txn_confirm(
    db: AsyncSession, line_user_id: str, reply_token: str, category: str, amount: str, desc: str
) -> None:
    """Step 4: save transaction using the existing txn handler."""
    text = f"/txn {amount} {category} {desc.replace('_', ' ') or 'other'}"
    await handle_txn_command(db, text, line_user_id, reply_token)


# ---------------------------------------------------------------------------
# Postback event dispatcher
# ---------------------------------------------------------------------------


async def handle_postback_event(db: AsyncSession, event: LineEvent) -> None:
    """Route LINE postback events from button taps to the appropriate handler."""
    if not event.postback or not event.replyToken:
        return
    line_user_id = event.source.userId
    if not line_user_id:
        return

    line_group_id = event.source.chat_id
    is_group = bool(line_group_id)
    data = event.postback.data
    reply_token = event.replyToken

    # A button tap from a linked user in a group also registers membership (see the
    # text dispatcher) so group splitting works without everyone running /add first.
    if is_group:
        await _ensure_group_membership_if_linked(db, line_group_id, line_user_id)

    # Parse "key=value&key=value" pairs
    params: dict[str, str] = {}
    for part in data.split("&"):
        if "=" in part:
            k, _, v = part.partition("=")
            params[k.strip()] = v.strip()
    cmd = params.get("cmd", "")

    # DM-only postbacks must never run in a group chat — they'd surface a member's
    # personal portfolio/goals or log a personal transaction into the shared chat.
    # Mirrors the guards the text dispatcher already applies to /portfolio, /goals, /txn.
    if is_group and cmd in {"goals", "portfolio", "txn_start", "txn_cat", "txn_amount", "txn_confirm", "qlog_undo", "qlog_cat", "qlog_set"}:
        await _reply(reply_token, "💡 That's a personal command — DM me to use it.", GROUP_QR)
        return

    if cmd == "menu":
        await _reply_flex(
            reply_token,
            "Aspiro Menu" if not is_group else "Group Expense Menu",
            _flex_main_menu(is_group=is_group),
            GROUP_QR if is_group else DM_QR,
        )
    elif cmd == "balance":
        if is_group:
            await handle_balance_command(db, line_user_id, line_group_id, reply_token)
        else:
            await handle_dm_balance_command(db, line_user_id, reply_token)
    elif cmd == "summary":
        if is_group:
            await handle_summary_command(db, line_user_id, line_group_id, reply_token)
        else:
            await handle_dm_summary_command(db, line_user_id, reply_token)
    elif cmd == "history":
        await handle_history_command(db, line_user_id, line_group_id, reply_token)
    elif cmd == "goals":
        await handle_goals_command(db, line_user_id, reply_token)
    elif cmd == "portfolio":
        await handle_portfolio_command(db, line_user_id, reply_token)
    elif cmd == "rate":
        await handle_rate_command(db, line_user_id, reply_token)
    elif cmd == "link":
        await handle_link_command(db, line_user_id, reply_token, is_group=is_group)
    elif cmd == "help":
        await handle_help_command(reply_token, is_group)
    elif cmd == "undo":
        if is_group and line_group_id:
            await handle_undo_command(db, line_user_id, line_group_id, reply_token)
        else:
            await _reply(reply_token, "Undo is only available in group chats.")
    elif cmd == "add_start":
        await handle_add_expense_start(db, line_user_id, line_group_id, reply_token)
    elif cmd == "add_amount":
        amount = params.get("v", "")
        await handle_add_expense_amount_selected(db, line_user_id, line_group_id, reply_token, amount)
    elif cmd == "add_confirm":
        amount = params.get("a", "")
        desc = params.get("d", "expense")
        await handle_add_expense_confirm(db, line_user_id, line_group_id, reply_token, amount, desc)
    elif cmd == "settle_start":
        if is_group and line_group_id:
            # Show the balance card so the user sees who they owe before settling.
            # Actual settlement: type /settle @name
            await handle_balance_command(db, line_user_id, line_group_id, reply_token)
        else:
            await _reply(reply_token, "Settle is only available in group chats.")
    elif cmd == "qlog_undo":
        await handle_quick_undo(db, line_user_id, reply_token, params.get("t", ""))
    elif cmd == "qlog_cat":
        await handle_quick_category_picker(db, line_user_id, reply_token, params.get("t", ""))
    elif cmd == "qlog_set":
        await handle_quick_set_category(db, line_user_id, reply_token, params.get("t", ""), params.get("c", ""))
    elif cmd == "txn_start":
        await handle_txn_start(reply_token)
    elif cmd == "txn_cat":
        category = params.get("c", "other")
        link = await _get_link_safe(db, line_user_id)
        currency = await _get_user_currency(db, link.user_id) if link else "TWD"
        await handle_txn_category_selected(reply_token, category, currency)
    elif cmd == "txn_amount":
        category = params.get("c", "other")
        amount = params.get("v", "")
        await handle_txn_amount_selected(reply_token, category, amount)
    elif cmd == "txn_confirm":
        category = params.get("c", "other")
        amount = params.get("v", "")
        desc = params.get("d", "other")
        await handle_txn_confirm(db, line_user_id, reply_token, category, amount, desc)


async def handle_event(db: AsyncSession, event: LineEvent) -> None:
    """Route a single LINE event to the appropriate handler."""
    # Non-message events
    if event.type == "join":
        await handle_join_event(event)
        return
    if event.type == "follow":
        await handle_follow_event(db, event)
        return
    if event.type == "memberJoined":
        await handle_member_joined_event(event)
        return
    if event.type == "postback":
        await handle_postback_event(db, event)
        return
    if event.type == "unfollow":
        line_user_id = event.source.userId
        if line_user_id:
            await LineAccountRepository(db).delete_tokens_by_line_user_id(line_user_id)
        return
    if event.type == "leave":
        line_group_id = event.source.chat_id
        if line_group_id:
            group_repo = LineGroupRepository(db)
            group = await group_repo.get_group_by_line_group_id(line_group_id)
            if group:
                await group_repo.delete_members_by_group(group.id)
                await group_repo.delete_group(group)
        return
    if event.type == "memberLeft":
        line_group_id = event.source.chat_id
        members = (event.model_extra or {}).get("left", {}).get("members", [])
        if line_group_id and members:
            group_repo = LineGroupRepository(db)
            group = await group_repo.get_group_by_line_group_id(line_group_id)
            if group:
                left_line_ids = [m.get("userId") for m in members if m.get("userId")]
                if left_line_ids:
                    links = await LineAccountRepository(db).get_links_by_line_user_ids(left_line_ids)
                    left_user_ids = [r.user_id for r in links]
                    if left_user_ids:
                        await group_repo.delete_members_by_group_and_users(
                            group.id, left_user_ids
                        )
        return
    if event.type != "message":
        return
    if not event.message or event.message.type != "text":
        return
    if not event.replyToken:
        return

    text = (event.message.text or "").strip()
    line_user_id = event.source.userId
    if not line_user_id:
        return

    line_group_id = event.source.chat_id
    is_group = bool(line_group_id)
    cmd = text.lower().split()[0] if text else ""

    # Any message from a linked user in a group registers them as a member, so two
    # linked users who have each spoken can split — not just whoever runs /add first.
    if is_group:
        await _ensure_group_membership_if_linked(db, line_group_id, line_user_id)

    if cmd == "/link":
        await handle_link_command(db, line_user_id, event.replyToken, is_group=is_group)
    elif cmd in ("/menu", "/start"):
        await _reply_flex(
            event.replyToken,
            "Aspiro Menu" if not is_group else "Group Expense Menu",
            _flex_main_menu(is_group=is_group),
            GROUP_QR if is_group else DM_QR,
        )
    elif cmd == "/help":
        await handle_help_command(event.replyToken, is_group)
    elif cmd == "/history":
        await handle_history_command(db, line_user_id, line_group_id, event.replyToken)
    # --- Dual-mode: /balance and /summary behave differently in group vs DM ---
    elif cmd == "/balance":
        if is_group:
            await handle_balance_command(db, line_user_id, line_group_id, event.replyToken)
        else:
            await handle_dm_balance_command(db, line_user_id, event.replyToken)
    elif cmd == "/summary":
        if is_group:
            await handle_summary_command(db, line_user_id, line_group_id, event.replyToken)
        else:
            await handle_dm_summary_command(db, line_user_id, event.replyToken)
    # --- Group-only commands ---
    elif cmd == "/add":
        if not is_group:
            await _reply(
                event.replyToken,
                "💡 /add splits expenses among group members.\nAdd me to a LINE group to use it.",
                [_qr_message("❓ Help", "/help")],
            )
            return
        await handle_add_command(db, text, line_user_id, line_group_id, event.replyToken)
    elif cmd == "/settle":
        if not is_group:
            await _reply(
                event.replyToken,
                "💡 /settle is for group expenses.\nAdd me to a LINE group to use it.",
                [_qr_message("❓ Help", "/help")],
            )
            return
        await handle_settle_command(db, text, line_user_id, line_group_id, event.replyToken)
    elif cmd == "/undo":
        if not is_group:
            await _reply(
                event.replyToken,
                "💡 /undo removes group expenses.\nAdd me to a LINE group to use it.",
                [_qr_message("❓ Help", "/help")],
            )
            return
        await handle_undo_command(db, line_user_id, line_group_id, event.replyToken)
    # --- DM-only commands ---
    elif cmd == "/txn":
        if is_group:
            await _reply_flex(
                event.replyToken,
                "Use /txn in a DM",
                _flex_not_linked("group_txn_hint"),
                GROUP_QR,
            )
            return
        await handle_txn_command(db, text, line_user_id, event.replyToken)
    elif cmd == "/goals":
        if is_group:
            await _reply_flex(event.replyToken, "Use /goals in a DM", _flex_not_linked(), GROUP_QR)
            return
        await handle_goals_command(db, line_user_id, event.replyToken)
    elif cmd == "/portfolio":
        if is_group:
            await _reply_flex(event.replyToken, "Use /portfolio in a DM", _flex_not_linked(), GROUP_QR)
            return
        await handle_portfolio_command(db, line_user_id, event.replyToken)
    elif cmd == "/rate":
        await handle_rate_command(db, line_user_id, event.replyToken)
    elif text and not cmd.startswith("/"):
        # Only surface the menu in DM context — replying to every non-command
        # message in a group chat would be disruptive to normal conversation.
        # In a DM, a line like "午餐 120" is a bookkeeping entry first.
        if not is_group:
            if await handle_quick_log(db, text, line_user_id, event.replyToken):
                return
            await _reply_flex(
                event.replyToken,
                "Aspiro Menu",
                _flex_main_menu(is_group=False),
                DM_QR,
            )


# Retention for the dedup markers. LINE never re-delivers events older than a
# short window, so a few days is ample; markers past this are pruned.
_PROCESSED_EVENT_RETENTION = timedelta(days=7)


async def _dispatch_event(db: AsyncSession, event: LineEvent) -> None:
    """Idempotency guard + handle. Skips events already processed so a
    re-delivered batch can't double-record ``/add`` and ``/txn`` entries.

    Fast-ack (returning 200 before processing) makes redelivery rare but not
    impossible — LINE can still re-deliver on network issues or its own retries.
    The ``webhookEventId`` (falling back to ``message.id``) is the dedup key; if
    the event carries no id we handle it normally rather than drop it.
    """
    event_id = event.webhookEventId or (event.message.id if event.message else None)
    if event_id is not None:
        is_new = await LineAccountRepository(db).mark_event_processed(event_id)
        if not is_new:
            logger.info("Skipping already-processed LINE event %s", event_id)
            return
    await handle_event(db, event)


async def process_webhook_events(events: list[LineEvent]) -> None:
    """Process a batch of LINE webhook events in the background.

    Scheduled by the ``/webhook`` endpoint *after* it has already returned 200 to
    LINE, so a slow handler (LINE API round-trips + DB writes) can't delay the ack
    and make LINE time out and re-deliver the batch. Events are additionally
    deduped by id (see ``_dispatch_event``) so any redelivery that slips through
    doesn't double-record ``/add`` and ``/txn`` entries.

    Uses its own session (not the request's ``get_db``) because the request — and
    therefore its session — is already closed by the time this runs. Each event is
    isolated in a savepoint so one failure doesn't abort the rest; the batch is
    committed once at the end.
    """
    async with async_session() as db:
        for event in events:
            try:
                async with db.begin_nested():
                    await _dispatch_event(db, event)
            except Exception as exc:
                logger.exception("Error handling LINE event: %s", exc)
        # Occasionally prune old dedup markers so the table stays bounded, without
        # standing up a separate cron for a low-volume table.
        if random.random() < 0.05:
            try:
                await LineAccountRepository(db).prune_processed_events(
                    datetime.now(timezone.utc) - _PROCESSED_EVENT_RETENTION
                )
            except Exception as exc:
                logger.warning("Failed to prune processed LINE events: %s", exc)
        try:
            await db.commit()
        except Exception as exc:
            logger.exception("Error committing LINE webhook batch: %s", exc)
            await db.rollback()


# ---------------------------------------------------------------------------
# REST API helpers (called by the frontend after Google login)
# ---------------------------------------------------------------------------


async def link_preview(db: AsyncSession, token: UUID) -> LinkPreviewResponse:
    """Say which LINE account a link token would attach, without using it.

    The token is a bearer capability minted by whoever ran /link in LINE, and
    anyone can send its URL to someone else. /link-line shows this to the
    signed-in user and confirms only on an explicit click, so a link from a
    stranger cannot silently bind the stranger's LINE account to theirs.
    """
    link_token = await LineAccountRepository(db).get_token(token)
    if link_token is None or link_token.used:
        raise ValueError("Invalid or already-used link token")
    if datetime.now(timezone.utc) > link_token.expires_at:
        raise ValueError("Link token has expired — please run /link again in LINE")
    line_display_name, picture_url = await _fetch_line_profile(link_token.line_user_id)
    return LinkPreviewResponse(
        line_display_name=line_display_name,
        picture_url=picture_url,
        expires_at=link_token.expires_at,
    )


async def confirm_link(
    db: AsyncSession, token: UUID, user_id: UUID, display_name: Optional[str]
) -> LinkConfirmResponse:
    """Validate a link token and create the LineUserLink record."""
    account_repo = LineAccountRepository(db)
    link_token = await account_repo.get_token_for_update(token)

    if link_token is None or link_token.used:
        raise ValueError("Invalid or already-used link token")
    if datetime.now(timezone.utc) > link_token.expires_at:
        raise ValueError("Link token has expired — please run /link again in LINE")

    # Check if this LINE user is already linked to a different account
    existing = await _get_link(db, link_token.line_user_id)
    if existing and existing.user_id != user_id:
        raise ValueError("This LINE account is already linked to a different Aspiro account")

    line_user_id = link_token.line_user_id

    if existing is None:
        account_repo.add_link(
            line_user_id=line_user_id,
            user_id=user_id,
            display_name=display_name,
        )
    else:
        existing.display_name = display_name

    link_token.used = True
    await db.flush()
    # The LINE push notification is intentionally deferred to the caller (router)
    # so it fires AFTER db.commit(). Pushing before commit risks sending "Linked!"
    # to the user while the transaction is still uncommitted / could be rolled back.

    linked_at = datetime.now(timezone.utc)
    return LinkConfirmResponse(
        line_user_id=line_user_id,
        display_name=display_name,
        linked_at=linked_at,
    )


async def push_link_confirmation(line_user_id: str, display_name: Optional[str]) -> None:
    """Send the LINE 'Linked!' confirmation push. Call AFTER db.commit()."""
    name_label = display_name or "your account"
    await _push_messages(line_user_id, [
        {
            "type": "text",
            "text": f"✅ Linked! {name_label} is now connected to Aspiro.",
        },
        {
            "type": "flex",
            "altText": "You're all set — here's what you can do",
            "contents": _flex_main_menu(is_group=False),
            "quickReply": {"items": DM_QR},
        },
    ])


# Bounded LRU + TTL cache so link-status polling doesn't hammer the LINE profile
# API, while capping memory: a plain dict grew one entry per LINE user ever seen
# (expired entries were only overwritten, never evicted) and leaked over time.
_profile_cache: "OrderedDict[str, tuple[float, Optional[str], Optional[str]]]" = OrderedDict()
_PROFILE_CACHE_TTL = 300.0  # seconds
_PROFILE_CACHE_MAX = 1000   # evict least-recently-used entries beyond this


async def _fetch_line_profile(line_user_id: str) -> tuple[Optional[str], Optional[str]]:
    """Return (display_name, picture_url) from LINE Bot profile API, or (None, None) on failure.

    Results are cached in-process (bounded LRU) for _PROFILE_CACHE_TTL seconds to
    avoid hammering the LINE API on every link-status request.
    """
    now = _time.monotonic()
    cached = _profile_cache.get(line_user_id)
    if cached and now - cached[0] < _PROFILE_CACHE_TTL:
        _profile_cache.move_to_end(line_user_id)  # mark most-recently-used
        return cached[1], cached[2]
    if cached:
        _profile_cache.pop(line_user_id, None)  # expired — drop it

    if not settings.LINE_CHANNEL_ACCESS_TOKEN:
        return None, None
    try:
        resp = await _get_http_client().get(
            f"https://api.line.me/v2/bot/profile/{line_user_id}",
            headers={"Authorization": f"Bearer {settings.LINE_CHANNEL_ACCESS_TOKEN}"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            display_name, picture_url = data.get("displayName"), data.get("pictureUrl")
            _profile_cache[line_user_id] = (now, display_name, picture_url)
            _profile_cache.move_to_end(line_user_id)
            while len(_profile_cache) > _PROFILE_CACHE_MAX:
                _profile_cache.popitem(last=False)  # evict least-recently-used
            return display_name, picture_url
        else:
            logger.warning(
                "LINE profile API returned %d for %s", resp.status_code, line_user_id
            )
    except Exception as exc:
        logger.warning("Failed to fetch LINE profile for %s: %s", line_user_id, exc)
    return None, None


async def get_link_status(db: AsyncSession, user_id: UUID) -> LinkStatusResponse:
    link = await LineAccountRepository(db).get_link_by_user_id(user_id)
    if link is None:
        return LinkStatusResponse(linked=False)
    line_display_name, picture_url = await _fetch_line_profile(link.line_user_id)
    return LinkStatusResponse(
        linked=True,
        line_user_id=link.line_user_id,
        display_name=link.display_name,
        line_display_name=line_display_name,
        picture_url=picture_url,
        linked_at=link.created_at,
    )


async def liff_session(db: AsyncSession, id_token: str) -> LiffSessionResponse:
    """Exchange a LIFF LINE ID token for an Aspiro session.

    Verifies the ID token with LINE (audience = the LINE Login channel), then maps the
    LINE user to their linked Aspiro account. Already-linked users get a normal Aspiro
    access token (so the LIFF app reuses the same JWT-authed endpoints as the web app);
    unlinked users get linked=False so the LIFF app shows the account-link CTA.
    """
    if not settings.LINE_LOGIN_CHANNEL_ID:
        raise ValueError("LINE_LOGIN_CHANNEL_ID not configured")

    # LINE verifies the ID token's signature, audience and expiry server-side.
    try:
        resp = await _get_http_client().post(
            "https://api.line.me/oauth2/v2.1/verify",
            data={"id_token": id_token, "client_id": settings.LINE_LOGIN_CHANNEL_ID},
            timeout=5.0,
        )
    except Exception as exc:
        logger.warning("LIFF ID-token verify request failed: %s", exc)
        raise ValueError("Could not verify LINE identity")

    if resp.status_code != 200:
        logger.warning("LIFF ID-token verify rejected (%d): %s", resp.status_code, resp.text[:200])
        raise ValueError("Invalid LINE ID token")

    line_user_id = resp.json().get("sub")
    if not line_user_id:
        raise ValueError("LINE ID token missing subject")

    link = await _get_link(db, line_user_id)
    if link is None:
        return LiffSessionResponse(linked=False)

    user = await LineAccountRepository(db).get_user(link.user_id)
    # A missing, deactivated, suspended, pending or locked account gets no token:
    # this mints a session without a password, so it must refuse exactly what
    # CurrentUser refuses, or deactivation would not reach LINE-linked users.
    if (
        user is None
        or not user.is_active
        or user.deleted_at is not None
        or user.status != UserStatus.ACTIVE
        or user.is_account_locked
    ):
        return LiffSessionResponse(linked=False)

    access_token = jwt_manager.create_access_token({"sub": str(user.id), "email": user.email})
    return LiffSessionResponse(linked=True, access_token=access_token, display_name=link.display_name)


async def unlink(db: AsyncSession, user_id: UUID) -> None:
    """Remove the LineUserLink and all group memberships for the given user.

    Group memberships store line_user_id as a plain string — not a FK to
    LineUserLink — so they must be cleaned up explicitly. Otherwise a re-link
    with a different LINE account leaves stale line_user_id values that break
    balance and settle commands.
    """
    # LineGroupMember.line_user_id is a plain string (not a FK to LineUserLink),
    # so memberships must be deleted explicitly alongside the link.
    account_repo = LineAccountRepository(db)
    link = await account_repo.get_link_by_user_id(user_id)
    await LineGroupRepository(db).delete_members_by_user(user_id)
    await account_repo.delete_links_by_user_id(user_id)
    # Also purge any outstanding link tokens for this LINE user so unlink leaves
    # no orphan rows behind (tokens key on line_user_id, not user_id).
    if link is not None:
        await account_repo.delete_tokens_by_line_user_id(link.line_user_id)
    await db.commit()


async def get_recent_activity(db: AsyncSession, user_id: UUID, limit: int = 20) -> list:
    """Recent LINE bot activity for a user (newest first), via the repository."""
    return await LineAccountRepository(db).get_recent_activities(user_id, limit)


async def assert_group_member(db: AsyncSession, group_id: UUID, user_id: UUID) -> None:
    """Raise HTTP 403 if user_id is not a member of the group.

    Called by REST endpoints before any group data query so that users
    cannot enumerate other groups' financial data by guessing UUIDs.
    """
    from fastapi import HTTPException, status as http_status

    member = await LineGroupRepository(db).get_member(group_id, user_id)
    if member is None:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Not a member of this group",
        )


async def get_user_groups(db: AsyncSession, user_id: UUID) -> list:
    rows = await LineGroupRepository(db).get_user_groups_with_counts(user_id)
    return [
        GroupOut(
            id=g.id,
            line_group_id=g.line_group_id,
            name=g.name,
            currency=g.currency,
            member_count=count,
            created_at=g.created_at,
        )
        for g, count in rows
    ]


async def get_group_expenses(
    db: AsyncSession, group_id: UUID, limit: int = 50, offset: int = 0
) -> list:

    expenses = await SharedExpenseRepository(db).get_recent_expenses(
        group_id, limit=limit, offset=offset
    )
    return [
        ExpenseOut(
            id=e.id,
            group_id=e.group_id,
            payer_id=e.payer_id,
            amount=e.amount,
            currency=e.currency,
            description=e.description,
            note=e.note,
            created_at=e.created_at,
            splits=[
                SplitOut(
                    user_id=s.user_id,
                    amount=s.amount,
                    ratio=s.ratio,
                    settled=s.settled,
                    settled_at=s.settled_at,
                )
                for s in e.splits
            ],
        )
        for e in expenses
    ]


async def compute_balances(
    db: AsyncSession, group_id: UUID, currency: str | None = None
) -> GroupBalanceResponse:
    """
    Compute net balances for a group.

    For each expense: the payer is owed money by every other member whose
    split is not settled. We reduce this to pairwise net amounts.

    Pass ``currency`` when the caller already has the LineGroup loaded to
    avoid a redundant DB round-trip.
    """
    expense_repo = SharedExpenseRepository(db)
    if currency is None:
        group = await LineGroupRepository(db).get_group_by_id(group_id)
        if group is None:
            return GroupBalanceResponse(group_id=group_id, currency="TWD", balances=[])
        currency = group.currency

    # Load only expenses that have at least one unsettled split, avoiding a
    # full table scan on groups with many historical (fully-settled) entries.
    expenses = await expense_repo.get_expenses_with_unsettled_splits(group_id)

    # net[debtor][creditor] = amount debtor owes creditor
    net: dict[tuple[UUID, UUID], Decimal] = {}

    for expense in expenses:
        payer = expense.payer_id
        for split in expense.splits:
            if split.settled or split.user_id == payer:
                continue
            key = (split.user_id, payer)
            net[key] = net.get(key, Decimal("0")) + split.amount

    # Simplify: if A owes B and B owes A, net them out
    simplified: list[BalanceEntry] = []
    processed: set[tuple[UUID, UUID]] = set()

    for (debtor, creditor), amount in net.items():
        if (debtor, creditor) in processed:
            continue
        reverse = net.get((creditor, debtor), Decimal("0"))
        processed.add((debtor, creditor))
        processed.add((creditor, debtor))

        net_amount = amount - reverse
        if net_amount > Decimal("0.01"):
            simplified.append(
                BalanceEntry(
                    owed_by=debtor,
                    owed_to=creditor,
                    amount=net_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    currency=currency,
                )
            )
        elif net_amount < Decimal("-0.01"):
            simplified.append(
                BalanceEntry(
                    owed_by=creditor,
                    owed_to=debtor,
                    amount=(-net_amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    currency=currency,
                )
            )

    # Resolve UUIDs to display names for all users appearing in the balances
    all_user_ids = {
        uid
        for entry in simplified
        for uid in (entry.owed_by, entry.owed_to)
    }
    member_names: dict[str, str] = {}
    if all_user_ids:
        for row in await LineAccountRepository(db).get_links_by_user_ids(all_user_ids):
            member_names[str(row.user_id)] = row.display_name or str(row.user_id)[:8]

    return GroupBalanceResponse(
        group_id=group_id,
        currency=currency,
        balances=simplified,
        member_names=member_names,
    )


async def get_group_members_with_names(
    db: AsyncSession, group_id: UUID, current_user_id: UUID
) -> list:
    """
    Return all members of a LINE expense group with their display names.

    Joins LineGroupMember with LineUserLink so the frontend can render
    names instead of raw UUIDs.  Only members of the group are returned;
    the caller's membership is not enforced here — the router handles auth.
    """

    rows = await LineGroupRepository(db).get_members_with_names(group_id)
    return [
        MemberOut(
            user_id=member.user_id,
            display_name=display_name,
            line_user_id=member.line_user_id,
        )
        for member, display_name in rows
    ]


# ---------------------------------------------------------------------------
# Web write endpoints (authenticated REST mutations)
#
# These mirror the chat /add and /settle commands' ledger writes exactly by
# reusing _create_shared_expense / _settle_debt, so a group's books are
# identical regardless of whether an entry was made from LINE or the web.
# ---------------------------------------------------------------------------


def _http_error(status_code: int, detail: str):
    from fastapi import HTTPException

    return HTTPException(status_code=status_code, detail=detail)


async def _resolve_group_and_membership(
    db: AsyncSession, group_id: UUID, user_id: UUID
) -> tuple[LineGroup, list[LineGroupMember]]:
    """Authorize a web mutation against *group_id* for *user_id*.

    Raises 404 if the group does not exist, 403 if the group exists but the
    caller is not a linked member. On success returns the loaded group and its
    members so callers avoid a redundant round-trip.
    """
    group_repo = LineGroupRepository(db)
    group = await group_repo.get_group_by_id(group_id)
    if group is None:
        raise _http_error(404, "Group not found")
    members = await group_repo.get_members(group_id)
    if not any(m.user_id == user_id for m in members):
        raise _http_error(403, "Not a member of this group")
    return group, members


def _validate_custom_splits(
    amount: Decimal,
    splits: list[SplitInput],
    members: list[LineGroupMember],
) -> None:
    """Validate a custom split: every user must be a group member, no dupes,
    and the per-member amounts must sum to the expense total."""
    member_ids = {m.user_id for m in members}
    seen: set[UUID] = set()
    total = Decimal("0")
    for s in splits:
        if s.user_id not in member_ids:
            raise _http_error(422, f"User {s.user_id} is not a member of this group")
        if s.user_id in seen:
            raise _http_error(422, f"Duplicate split for user {s.user_id}")
        seen.add(s.user_id)
        total += s.amount
    if total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) != amount.quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    ):
        raise _http_error(
            422,
            f"Splits must sum to the total amount ({amount}); got {total}",
        )


async def _persist_custom_splits(
    db: AsyncSession,
    expense: SharedExpense,
    splits: list[SplitInput],
) -> None:
    """Write explicit per-member split rows for an expense."""
    expense_repo = SharedExpenseRepository(db)
    for s in splits:
        expense_repo.add_split(
            expense_id=expense.id,
            user_id=s.user_id,
            amount=s.amount,
        )
    await db.flush()


async def web_add_expense(
    db: AsyncSession,
    group_id: UUID,
    user_id: UUID,
    body: ExpenseCreateRequest,
) -> ExpenseOut:
    """Add a shared expense from the web. Mirrors the chat /add command."""
    group, members = await _resolve_group_and_membership(db, group_id, user_id)

    if len(members) < 2:
        raise _http_error(
            422,
            "Group needs at least 2 linked members before expenses can be split.",
        )

    payer_id = body.payer_id or user_id
    if not any(m.user_id == payer_id for m in members):
        raise _http_error(422, "Payer must be a member of this group")

    if body.splits:
        _validate_custom_splits(body.amount, body.splits, members)
        expense_repo = SharedExpenseRepository(db)
        expense = expense_repo.add_expense(
            group_id=group.id,
            payer_id=payer_id,
            amount=body.amount,
            currency=group.currency,
            description=body.description,
        )
        if body.note is not None:
            expense.note = body.note
        await db.flush()
        await _persist_custom_splits(db, expense, body.splits)
        await _log_activity(
            db,
            user_id,
            "add_expense",
            f"Added: {body.description} {group.currency} {body.amount:,.0f}",
            amount=body.amount,
            currency=group.currency,
        )
    else:
        expense, _split_desc = await _create_shared_expense(
            db,
            group=group,
            members=members,
            payer_id=payer_id,
            actor_user_id=user_id,
            amount=body.amount,
            description=body.description,
            note=body.note,
        )

    await db.commit()
    return await _expense_to_out(db, group.id, expense.id)


async def web_update_expense(
    db: AsyncSession,
    group_id: UUID,
    expense_id: UUID,
    user_id: UUID,
    body: ExpenseUpdateRequest,
) -> ExpenseOut:
    """Edit an existing shared expense from the web and recompute its splits."""
    group, members = await _resolve_group_and_membership(db, group_id, user_id)

    expense_repo = SharedExpenseRepository(db)
    expense = await expense_repo.get_expense_by_id(group.id, expense_id)
    if expense is None:
        raise _http_error(404, "Expense not found")

    # Apply scalar field changes.
    new_amount = body.amount if body.amount is not None else expense.amount
    if body.description is not None:
        expense.description = body.description
    if body.note is not None:
        expense.note = body.note
    if body.payer_id is not None:
        if not any(m.user_id == body.payer_id for m in members):
            raise _http_error(422, "Payer must be a member of this group")
        expense.payer_id = body.payer_id
    expense.amount = new_amount

    # Determine whether splits need recomputing: explicit splits, or an amount
    # change (which invalidates the previously stored shares).
    recompute = body.splits is not None or body.amount is not None

    if recompute:
        await expense_repo.delete_splits_for_expense(expense.id)
        await db.flush()
        if body.splits is not None:
            _validate_custom_splits(new_amount, body.splits, members)
            await _persist_custom_splits(db, expense, body.splits)
        else:
            # Re-split equally across all current members.
            amounts = _split_amounts_equal(new_amount, len(members))
            for member, split_amount in zip(members, amounts):
                expense_repo.add_split(
                    expense_id=expense.id,
                    user_id=member.user_id,
                    amount=split_amount,
                )
            await db.flush()

    await _log_activity(
        db,
        user_id,
        "edit_expense",
        f"Edited: {expense.description} {group.currency} {expense.amount:,.0f}",
        amount=expense.amount,
        currency=group.currency,
    )
    await db.commit()
    return await _expense_to_out(db, group.id, expense.id)


async def web_delete_expense(
    db: AsyncSession,
    group_id: UUID,
    expense_id: UUID,
    user_id: UUID,
) -> None:
    """Delete a shared expense (and its splits via cascade) from the web."""
    group, _members = await _resolve_group_and_membership(db, group_id, user_id)

    expense_repo = SharedExpenseRepository(db)
    expense = await expense_repo.get_expense_by_id(group.id, expense_id)
    if expense is None:
        raise _http_error(404, "Expense not found")

    desc = expense.description
    amount = expense.amount
    currency = expense.currency
    await expense_repo.delete_expense(expense)
    await db.flush()
    await _log_activity(
        db,
        user_id,
        "delete_expense",
        f"Removed: {desc} {currency} {amount:,.0f}",
        amount=amount,
        currency=currency,
    )
    await db.commit()


async def web_settle(
    db: AsyncSession,
    group_id: UUID,
    user_id: UUID,
    body: SettleRequest,
) -> SettleResponse:
    """Settle a debt between two members from the web. Mirrors chat /settle."""
    group, members = await _resolve_group_and_membership(db, group_id, user_id)

    member_ids = {m.user_id for m in members}
    if body.owed_by not in member_ids or body.owed_to not in member_ids:
        raise _http_error(422, "Both parties must be members of this group")
    if body.owed_by == body.owed_to:
        raise _http_error(422, "Cannot settle a debt with yourself")

    total = await _settle_debt(
        db,
        group=group,
        actor_user_id=user_id,
        owed_by=body.owed_by,
        owed_to=body.owed_to,
        amount=body.amount,
    )

    if total is None:
        raise _http_error(422, "No outstanding balance between these members")
    if total == 0:
        raise _http_error(
            422,
            "Requested amount is smaller than the smallest outstanding split; "
            "nothing could be settled.",
        )

    await db.commit()
    return SettleResponse(
        owed_by=body.owed_by,
        owed_to=body.owed_to,
        amount_settled=total,
        currency=group.currency,
    )


async def _expense_to_out(
    db: AsyncSession, group_id: UUID, expense_id: UUID
) -> ExpenseOut:
    """Reload an expense with its splits and serialize to ExpenseOut."""
    expense = await SharedExpenseRepository(db).get_expense_by_id(group_id, expense_id)
    if expense is None:  # pragma: no cover - defensive; just committed it
        raise _http_error(404, "Expense not found")
    return ExpenseOut(
        id=expense.id,
        group_id=expense.group_id,
        payer_id=expense.payer_id,
        amount=expense.amount,
        currency=expense.currency,
        description=expense.description,
        note=expense.note,
        created_at=expense.created_at,
        splits=[
            SplitOut(
                user_id=s.user_id,
                amount=s.amount,
                ratio=s.ratio,
                settled=s.settled,
                settled_at=s.settled_at,
            )
            for s in expense.splits
        ],
    )
