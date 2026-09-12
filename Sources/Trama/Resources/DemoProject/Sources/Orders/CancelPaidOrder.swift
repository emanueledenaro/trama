import Payments

public struct ReviewRequest: Sendable, Equatable {
    public let orderID: String
    public let reason: String
}

public enum CancelPaidOrder {
    public static func requestReview(for order: inout Order, payment: Payment) -> ReviewRequest? {
        guard payment.status == .paid else { return nil }
        order.state = .reviewRequested
        return ReviewRequest(orderID: order.id, reason: "Richiesta di revisione dopo il pagamento")
    }
}
