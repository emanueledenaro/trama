public enum Catalogue {
    public static func product(id: String) -> Product {
        Product(id: id, title: "Prodotto \(id)")
    }
}
