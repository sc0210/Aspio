"""
Currency and number formatting utilities for Aspiro FastAPI Backend

Provides currency conversion, formatting, and localization functions
for Asian markets and international financial operations.
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Union


# Major Asian currencies and their properties
ASIAN_CURRENCIES = {
    "SGD": {"name": "Singapore Dollar", "symbol": "S$", "decimal_places": 2, "country": "Singapore"},
    "MYR": {"name": "Malaysian Ringgit", "symbol": "RM", "decimal_places": 2, "country": "Malaysia"}, 
    "THB": {"name": "Thai Baht", "symbol": "฿", "decimal_places": 2, "country": "Thailand"},
    "IDR": {"name": "Indonesian Rupiah", "symbol": "Rp", "decimal_places": 0, "country": "Indonesia"},
    "PHP": {"name": "Philippine Peso", "symbol": "₱", "decimal_places": 2, "country": "Philippines"},
    "VND": {"name": "Vietnamese Dong", "symbol": "₫", "decimal_places": 0, "country": "Vietnam"},
    "HKD": {"name": "Hong Kong Dollar", "symbol": "HK$", "decimal_places": 2, "country": "Hong Kong"},
    "TWD": {"name": "Taiwan Dollar", "symbol": "NT$", "decimal_places": 2, "country": "Taiwan"},
    "JPY": {"name": "Japanese Yen", "symbol": "¥", "decimal_places": 0, "country": "Japan"},
    "KRW": {"name": "South Korean Won", "symbol": "₩", "decimal_places": 0, "country": "South Korea"},
    "CNY": {"name": "Chinese Yuan", "symbol": "¥", "decimal_places": 2, "country": "China"},
    "USD": {"name": "US Dollar", "symbol": "$", "decimal_places": 2, "country": "United States"},
    "EUR": {"name": "Euro", "symbol": "€", "decimal_places": 2, "country": "European Union"},
    "GBP": {"name": "British Pound", "symbol": "£", "decimal_places": 2, "country": "United Kingdom"},
}


def get_currency_info(currency_code: str) -> Dict[str, Union[str, int]]:
    """Get currency information by code"""
    return ASIAN_CURRENCIES.get(currency_code.upper(), {
        "name": currency_code,
        "symbol": currency_code,
        "decimal_places": 2,
        "country": "Unknown"
    })


def get_currency_symbol(currency_code: str) -> str:
    """Get currency symbol by code"""
    return get_currency_info(currency_code).get("symbol", currency_code)


def get_decimal_places(currency_code: str) -> int:
    """Get number of decimal places for currency"""
    return get_currency_info(currency_code).get("decimal_places", 2)


def round_currency(amount: Union[float, Decimal], currency_code: str) -> Decimal:
    """Round amount to appropriate decimal places for currency"""
    decimal_places = get_decimal_places(currency_code)
    
    if isinstance(amount, float):
        amount = Decimal(str(amount))
    elif not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    
    if decimal_places == 0:
        return amount.quantize(Decimal('1'), rounding=ROUND_HALF_UP)
    else:
        quantizer = Decimal('0.1') ** decimal_places
        return amount.quantize(quantizer, rounding=ROUND_HALF_UP)


def format_currency(
    amount: Union[float, Decimal], 
    currency_code: str,
    format_type: str = "western",
    show_symbol: bool = True,
    show_code: bool = False
) -> str:
    """
    Format currency amount according to regional preferences
    
    Args:
        amount: Monetary amount
        currency_code: ISO currency code
        format_type: "western" or "asian"
        show_symbol: Whether to show currency symbol
        show_code: Whether to show currency code
    
    Returns:
        Formatted currency string
    """
    rounded_amount = round_currency(amount, currency_code)
    currency_info = get_currency_info(currency_code)
    
    if format_type == "asian":
        # Asian format: uses 4-digit grouping for large numbers
        if abs(rounded_amount) >= 10000:
            formatted = format_asian_number(rounded_amount)
        else:
            formatted = format_western_number(rounded_amount, get_decimal_places(currency_code))
    else:
        # Western format: standard 3-digit grouping
        formatted = format_western_number(rounded_amount, get_decimal_places(currency_code))
    
    # Add currency symbol/code
    result = formatted
    if show_symbol:
        symbol = currency_info.get("symbol", currency_code)
        if currency_code in ["JPY", "KRW", "CNY"]:
            result = f"{symbol}{formatted}"  # Symbol before for Asian currencies
        else:
            result = f"{symbol}{formatted}"  # Symbol before for most currencies
    
    if show_code:
        result = f"{result} {currency_code}"
    
    return result


def format_western_number(amount: Decimal, decimal_places: int) -> str:
    """Format number with western 3-digit grouping (1,000.00)"""
    if decimal_places == 0:
        return f"{amount:,.0f}"
    else:
        format_str = f"{{:,.{decimal_places}f}}"
        return format_str.format(float(amount))


def format_asian_number(amount: Decimal) -> str:
    """Format number with Asian 4-digit grouping for large amounts"""
    abs_amount = abs(amount)
    
    if abs_amount >= 100000000:  # 1억 (100 million)
        formatted = f"{float(amount) / 100000000:.1f}억"
    elif abs_amount >= 10000:  # 1만 (10 thousand)
        formatted = f"{float(amount) / 10000:.1f}만"
    else:
        formatted = f"{amount:,.0f}"
    
    return formatted


# Exchange rate helpers
__all__ = [
    "ASIAN_CURRENCIES",
    "get_currency_info",
    "get_currency_symbol", 
    "get_decimal_places",
    "round_currency",
    "format_currency",
    "format_western_number",
    "format_asian_number",
]