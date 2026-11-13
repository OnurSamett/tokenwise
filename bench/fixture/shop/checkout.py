from decimal import Decimal

from .inventory import reserve
from .pricing import apply_discount, total


class CheckoutError(Exception):
    pass


def checkout(order, stock) -> Decimal:
    """Reserve stock, apply the discount, and close the order. Returns the amount charged."""
    if order.status != "open":
        raise CheckoutError("order is not open")
    if not order.items:
        raise CheckoutError("order is empty")
    for li in order.items:
        reserve(stock, li.product.sku, li.quantity)
    apply_discount(order)
    charged = total(order)
    order.status = "paid"
    return charged
