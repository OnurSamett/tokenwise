from decimal import Decimal

from .money import percent

# code -> (kind, value)
CODES = {
    "WELCOME10": ("percent", Decimal("10")),
    "FLAT5": ("flat", Decimal("5")),
    "BOOKS20": ("category_percent", Decimal("20")),
}


def discount_for(order, subtotal: Decimal) -> Decimal:
    """Return the discount amount for the order's code (0 if none/invalid)."""
    if not order.discount_code or order.discount_code not in CODES:
        return Decimal("0")
    kind, value = CODES[order.discount_code]
    if kind == "percent":
        return percent(subtotal, value)
    if kind == "flat":
        return min(value, subtotal)
    if kind == "category_percent":
        books = sum((li.line_total() for li in order.items if li.product.category == "books"), Decimal("0"))
        return percent(books, value)
    return Decimal("0")
