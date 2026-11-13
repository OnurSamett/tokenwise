import unittest
from decimal import Decimal

from shop.checkout import checkout
from tests.helpers import make_order


class CheckoutTests(unittest.TestCase):
    def setUp(self):
        self.stock = {"B1": 5, "M1": 5}

    def test_checkout_without_code(self):
        self.assertEqual(checkout(make_order(), self.stock), Decimal("60.00"))

    def test_checkout_with_percent_code(self):
        order = make_order("WELCOME10")
        # 50.00 - 10% = 45.00, + 20% tax = 54.00
        self.assertEqual(checkout(order, self.stock), Decimal("54.00"))
        self.assertEqual(order.discount_applied, Decimal("5.00"))

    def test_checkout_reserves_stock(self):
        checkout(make_order(), self.stock)
        self.assertEqual(self.stock, {"B1": 3, "M1": 4})
