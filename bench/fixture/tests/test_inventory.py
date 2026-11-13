import unittest

from shop.inventory import OutOfStock, low_stock, reserve, restock


class InventoryTests(unittest.TestCase):
    def test_reserve_and_restock(self):
        s = {"A": 2}
        reserve(s, "A", 2)
        restock(s, "A", 1)
        self.assertEqual(s, {"A": 1})

    def test_out_of_stock(self):
        with self.assertRaises(OutOfStock):
            reserve({"A": 1}, "A", 2)

    def test_low_stock(self):
        self.assertEqual(low_stock({"A": 1, "B": 10}), ["A"])
