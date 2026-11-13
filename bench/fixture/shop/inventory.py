class OutOfStock(Exception):
    pass


def reserve(stock: dict, sku: str, quantity: int) -> None:
    available = stock.get(sku, 0)
    if quantity > available:
        raise OutOfStock(f"{sku}: wanted {quantity}, have {available}")
    stock[sku] = available - quantity


def restock(stock: dict, sku: str, quantity: int) -> None:
    stock[sku] = stock.get(sku, 0) + quantity


def low_stock(stock: dict, threshold: int = 3):
    return sorted(sku for sku, qty in stock.items() if qty <= threshold)
