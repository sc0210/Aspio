"""
Plain-text bookkeeping for the LINE bot: "午餐 120", "120 咖啡", "+50000 薪水".

Pure functions only — parsing and the built-in keyword guess — so they can be
tested without a database. The service decides what to do with the result and
looks up the user's own history first; the keywords here are the fallback.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Optional

# Upper bound for one chat-typed entry. Above this a typo ("1200000" for 1200)
# is far likelier than a real line item, and the web app is the place for it.
MAX_QUICK_AMOUNT = Decimal("10000000")
MAX_DESCRIPTION_LEN = 100

_CURRENCY_PREFIX = r"(?:NT\$|NTD|TWD|\$)?"
_UNIT_SUFFIX = r"(?:元|塊|圓|NTD|TWD)?"
_NUMBER = r"\d[\d,]*(?:\.\d+)?"

# "<desc> <amount>" — the amount ends the message; desc may hold digits ("7-11 80").
_DESC_THEN_AMOUNT = re.compile(
    rf"^(?P<desc>.*?\S)\s*(?P<sign>[+＋-])?\s*{_CURRENCY_PREFIX}\s*(?P<amt>{_NUMBER})\s*{_UNIT_SUFFIX}$",
    re.IGNORECASE,
)
# "<amount> <desc>" — needs whitespace after the amount so "3點到" never parses.
_AMOUNT_THEN_DESC = re.compile(
    rf"^(?P<sign>[+＋-])?\s*{_CURRENCY_PREFIX}\s*(?P<amt>{_NUMBER})\s*{_UNIT_SUFFIX}\s+(?P<desc>.+)$",
    re.IGNORECASE,
)
# A description must name something: at least one letter or CJK character...
_HAS_WORD = re.compile(r"[A-Za-z㐀-鿿]")
# ...or be the convenience store everyone writes in digits.
_DIGIT_NAMES = re.compile(r"^7\s*-?\s*11$")


@dataclass(frozen=True)
class QuickEntry:
    amount: Decimal
    description: str
    is_income: bool


def parse_quick_entry(text: str) -> Optional[QuickEntry]:
    """Read one bookkeeping line, or None when the text is not one.

    A leading or trailing "+" marks income; anything else is an expense. Full-width
    digits and signs are normalised first, since phone keyboards produce them.
    """
    if not text:
        return None
    normalized = unicodedata.normalize("NFKC", text).strip()
    if not normalized or "\n" in normalized or normalized.startswith("/"):
        return None

    # Either order can match text it does not really describe ("80 7-11" also reads
    # as "80 7" minus 11), so take the first reading that is a valid entry.
    for pattern in (_DESC_THEN_AMOUNT, _AMOUNT_THEN_DESC):
        match = pattern.match(normalized)
        if match is not None:
            entry = _entry_from(match)
            if entry is not None:
                return entry
    return None


def _entry_from(match: re.Match[str]) -> Optional[QuickEntry]:
    description = match.group("desc").strip(" :：-")
    if not description or not (_HAS_WORD.search(description) or _DIGIT_NAMES.match(description)):
        return None
    if len(description) > MAX_DESCRIPTION_LEN:
        return None
    try:
        amount = Decimal(match.group("amt").replace(",", ""))
    except InvalidOperation:
        return None
    if amount <= 0 or amount > MAX_QUICK_AMOUNT:
        return None
    return QuickEntry(
        amount=amount,
        description=description,
        is_income=match.group("sign") in ("+", "＋"),
    )


# Category name (TransactionCategory.name, as seeded) → words that suggest it.
# Matched as substrings of the lower-cased description, longest keyword first.
EXPENSE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Dining": (
        "早餐", "午餐", "晚餐", "宵夜", "早午餐", "點心", "下午茶", "咖啡", "飲料", "手搖",
        "便當", "麵", "飯", "餐", "粥", "小吃", "火鍋", "燒肉", "拉麵", "壽司", "滷味", "鹽酥雞",
        "麻辣燙", "臭豆腐", "雞排", "珍奶",
        "麥當勞", "肯德基", "摩斯", "星巴克", "路易莎", "85度c", "50嵐", "清心",
        "7-11", "711", "全家", "萊爾富", "ok超商", "超商", "便利商店",
        "foodpanda", "ubereats", "uber eats", "breakfast", "lunch", "dinner", "brunch",
        "coffee", "cafe", "tea", "restaurant", "snack", "meal",
    ),
    "Groceries": ("全聯", "家樂福", "好市多", "costco", "超市", "菜市場", "買菜", "水果", "grocery", "supermarket"),
    "Transportation": (
        "捷運", "公車", "客運", "計程車", "小黃", "高鐵", "台鐵", "火車", "加油", "油錢", "停車",
        "悠遊卡", "一卡通", "etc", "uber", "taxi", "mrt", "bus", "train", "parking", "gas", "fuel",
    ),
    "Shopping": ("蝦皮", "momo", "淘寶", "衣服", "褲子", "鞋", "包包", "日用品", "amazon", "shopee", "clothes", "shoes"),
    "Entertainment": ("電影", "唱歌", "ktv", "遊戲", "演唱會", "netflix", "spotify", "youtube", "disney", "steam", "movie", "game", "concert"),
    "Healthcare": ("看醫生", "掛號", "診所", "醫院", "藥局", "藥", "牙醫", "健保", "doctor", "clinic", "hospital", "pharmacy", "dentist"),
    "Utilities": ("電費", "水費", "瓦斯", "電話費", "手機費", "網路費", "第四台", "electricity", "water bill", "internet", "phone bill"),
    "Housing": ("房租", "租金", "管理費", "rent"),
    "Personal Care": ("剪髮", "理髮", "美髮", "美甲", "保養", "haircut", "salon"),
    "Education": ("課程", "學費", "補習", "書", "udemy", "course", "tuition", "book"),
    "Gift": ("禮物", "紅包", "禮金", "gift"),
    "Travel": ("機票", "住宿", "飯店", "旅館", "民宿", "訂房", "flight", "hotel", "airbnb"),
}

INCOME_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Salary": ("薪水", "薪資", "月薪", "salary", "payroll", "wage"),
    "Bonus": ("獎金", "年終", "分紅", "bonus"),
    "Freelance": ("接案", "外包", "稿費", "freelance"),
}

FALLBACK_CATEGORY = "Others"


def guess_category_name(description: str, is_income: bool) -> str:
    """The seeded category a description most likely belongs to, else "Others"."""
    text = description.lower()
    table = INCOME_KEYWORDS if is_income else EXPENSE_KEYWORDS
    best: tuple[int, str] | None = None
    for category, words in table.items():
        for word in words:
            if word in text and (best is None or len(word) > best[0]):
                best = (len(word), category)
    return best[1] if best else FALLBACK_CATEGORY
