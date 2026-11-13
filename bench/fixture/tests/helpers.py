from decimal import Decimal

from shop.models import Order, Product

BOOK = Product("B1", "Novel", Decimal("20.00"), "books")
MUG = Product("M1", "Mug", Decimal("10.00"), "kitchen")


def make_order(code=None):
    o = Order(id="o1", customer="ada", discount_code=code)
    o.add(BOOK, 2)
    o.add(MUG, 1)
    return o
