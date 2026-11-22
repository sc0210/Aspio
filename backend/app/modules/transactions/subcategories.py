"""The details a category offers (Beauty under Shopping), stored in ``transaction.subcategory``.

Mirrors SUBCATEGORIES in the web form (frontend TransactionFormFields.tsx);
change both together. A category not listed here has no details.
"""

from typing import Optional

SUBCATEGORIES: dict[str, tuple[str, ...]] = {
    "Shopping": ("Clothing", "Beauty", "Electronics", "Household"),
    "Transportation": ("Public Transit", "Car Maintenance", "Parking", "Car Rental"),
}


def known_subcategory(category_name: Optional[str], value: Optional[str]) -> Optional[str]:
    """`value` spelled as stored, if it is one of `category_name`'s details; else None.

    Case-insensitive on both, so a hand-edited "shopping, beauty" still matches.
    """
    if not category_name or not value:
        return None
    for category, details in SUBCATEGORIES.items():
        if category.lower() == category_name.strip().lower():
            return next((d for d in details if d.lower() == value.strip().lower()), None)
    return None
