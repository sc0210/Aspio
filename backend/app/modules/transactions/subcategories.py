"""The details a category offers (Beauty under Shopping), stored in ``transaction.subcategory``.

Mirrors SUBCATEGORIES in the web form (frontend TransactionFormFields.tsx); a
test keeps the two equal. A category not listed here has no details.
"""

from typing import Optional

# transaction.subcategory is String(100).
MAX_LENGTH = 100

SUBCATEGORIES: dict[str, tuple[str, ...]] = {
    "Shopping": ("Clothing", "Beauty", "Electronics", "Household", "Subscriptions"),
    "Transportation": ("Public Transit", "Fuel", "Car Maintenance", "Parking", "Car Rental"),
    "Travel": ("Flights", "Lodging", "Activities", "Souvenirs"),
}


def listed_detail(value: Optional[str]) -> Optional[str]:
    """`value` spelled as stored, if it is any category's detail (case-insensitive); else None."""
    wanted = (value or "").strip().lower()
    return next((d for details in SUBCATEGORIES.values() for d in details if d.lower() == wanted), None)


def is_detail_of(category_names: tuple[Optional[str], ...], detail: str) -> bool:
    """Whether `detail` is listed under a category with one of these names (case-insensitive)."""
    names = {n.strip().lower() for n in category_names if n}
    return any(c.lower() in names and detail in details for c, details in SUBCATEGORIES.items())


def imported_detail(value: Optional[str]) -> Optional[str]:
    """A CSV cell as a detail: a listed one spelled as stored, other text kept
    (this app's export writes the free text older rows carry), cut to fit the
    column so a hand-edited cell cannot fail the row. None when blank."""
    text = (value or "").strip()
    return listed_detail(text) or (text[:MAX_LENGTH].rstrip() or None)
