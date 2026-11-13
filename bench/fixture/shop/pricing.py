from decimal import Decimal

from .discounts import discount_for
from .money import percent, to_money

TAX_RATE = Decimal("20")  # percent


def subtotal(order) -> Decimal:
    return to_money(sum((li.line_total() for li in order.items), Decimal("0")))


def apply_discount(order) -> Decimal:
    """Compute the discount, store it on the order, and return it."""
    amount = discount_for(order, subtotal(order))
    order.discount_applied += amount
    return amount


def tax(amount: Decimal) -> Decimal:
    return percent(amount, TAX_RATE)


def total(order) -> Decimal:
    """Subtotal minus discount, plus tax."""
    net = subtotal(order) - apply_discount(order)
    return to_money(net + tax(net))
