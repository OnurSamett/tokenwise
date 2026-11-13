from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional


@dataclass
class Product:
    sku: str
    name: str
    price: Decimal
    category: str = "general"


@dataclass
class LineItem:
    product: Product
    quantity: int = 1

    def line_total(self) -> Decimal:
        return self.product.price * self.quantity


@dataclass
class Order:
    id: str
    customer: str
    items: List[LineItem] = field(default_factory=list)
    discount_code: Optional[str] = None
    discount_applied: Decimal = Decimal("0")
    status: str = "open"

    def add(self, product: Product, quantity: int = 1) -> None:
        self.items.append(LineItem(product, quantity))
