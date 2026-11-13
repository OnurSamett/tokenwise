from decimal import Decimal, ROUND_HALF_UP


def to_money(value) -> Decimal:
    """Round any number to 2 decimal places as Decimal."""
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def percent(value: Decimal, pct: Decimal) -> Decimal:
    return to_money(value * pct / Decimal(100))
