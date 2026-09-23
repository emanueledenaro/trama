public enum PaymentStore {
    public static func payment(for orderID: String) -> Payment {
        Payment(orderID: orderID, status: .paid)
    }
}
