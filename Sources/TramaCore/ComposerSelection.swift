import Foundation

/// The provider and model configuration shown by the Coordinator composer.
///
/// A selection is a value object. Capturing one on a queued request therefore keeps later
/// changes in the composer from changing work that has already been accepted.
public struct ComposerSelection: Codable, Equatable, Sendable {
    public var modelSelection: ModelSelection

    public init(_ modelSelection: ModelSelection) {
        self.modelSelection = modelSelection
    }

    public var provider: ProviderKind { modelSelection.provider }
    public var model: String { modelSelection.model }
}

/// A request accepted by the Coordinator runtime with its immutable composer choice.
public struct QueuedCoordinatorTurn: Codable, Equatable, Sendable {
    public var requestID: UUID
    public var selection: ComposerSelection

    public init(requestID: UUID, selection: ComposerSelection) {
        self.requestID = requestID
        self.selection = selection
    }
}

/// FIFO boundary used when requests wait for the active Coordinator turn.
public struct CoordinatorTurnQueue: Codable, Equatable, Sendable {
    public private(set) var turns: [QueuedCoordinatorTurn] = []

    public init() {}

    public var isEmpty: Bool { turns.isEmpty }
    public var count: Int { turns.count }

    public mutating func enqueue(requestID: UUID, selection: ComposerSelection) {
        turns.append(QueuedCoordinatorTurn(requestID: requestID, selection: selection))
    }

    public mutating func dequeue() -> QueuedCoordinatorTurn? {
        guard !turns.isEmpty else { return nil }
        return turns.removeFirst()
    }
}
