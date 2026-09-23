import Catalog
import Users

public struct Order: Sendable, Equatable {
    public let id: String
    public let user: User
    public let product: Product
    public var state: State

    public init(id: String, user: User, product: Product, state: State) {
        self.id = id
        self.user = user
        self.product = product
        self.state = state
    }

    public enum State: Sendable, Equatable {
        case open
        case reviewRequested
    }
}
