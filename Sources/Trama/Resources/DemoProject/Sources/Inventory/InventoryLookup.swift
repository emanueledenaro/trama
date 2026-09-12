public enum InventoryLookup {
    public static func stock(for productID: String) -> Stock {
        Stock(productID: productID, availableUnits: 12)
    }
}
