import Foundation

public enum PaymentStatus: String, Sendable {
    case paid
    case pending
}

public struct Payment: Sendable, Equatable {
    public let orderID: String
    public let status: PaymentStatus
}
