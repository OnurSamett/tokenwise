from decimal import Decimal

from .pricing import subtotal


def daily_summary(orders):
    paid = [o for o in orders if o.status == "paid"]
    return {
        "orders": len(paid),
        "gross": sum((subtotal(o) for o in paid), Decimal("0")),
        "discounts": sum((o.discount_applied for o in paid), Decimal("0")),
    }
