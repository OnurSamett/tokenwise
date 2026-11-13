import unittest
from decimal import Decimal

from shop.pricing import subtotal, tax
from tests.helpers import make_order


class PricingTests(unittest.TestCase):
    def test_subtotal(self):
        self.assertEqual(subtotal(make_order()), Decimal("50.00"))

    def test_tax(self):
        self.assertEqual(tax(Decimal("50.00")), Decimal("10.00"))
