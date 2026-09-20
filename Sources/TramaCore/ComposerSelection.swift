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
    public var effort: String? { modelSelection.reasoningEffort }
    public var thinking: Bool? { modelSelection.thinking }
    public var fastMode: Bool? { modelSelection.fastMode }
    public var autoCompactWindow: Int? { modelSelection.autoCompactWindow }

    public func withEffort(_ value: String?) -> ComposerSelection { ComposerSelection(modelSelection.changing(effort: .some(value))) }
    public func withThinking(_ value: Bool?) -> ComposerSelection { ComposerSelection(modelSelection.changing(thinking: .some(value))) }
    public func withFastMode(_ value: Bool?) -> ComposerSelection { ComposerSelection(modelSelection.changing(fastMode: .some(value))) }
    public func withAutoCompactWindow(_ value: Int?) -> ComposerSelection { ComposerSelection(modelSelection.changing(autoCompactWindow: .some(value))) }
}

public extension ModelSelection {
    var reasoningEffort: String? {
        switch self {
        case let .codex(_, options): return options?.reasoningEffort
        case let .claudeAgent(_, options): return options?.effort
        case let .grok(_, options): return options?.reasoningEffort
        case let .antigravity(_, options): return options?.reasoningEffort
        case let .droid(_, options): return options?.reasoningEffort
        case let .devin(_, options): return options?.reasoningEffort
        default: return nil
        }
    }

    var thinking: Bool? {
        switch self { case let .claudeAgent(_, options): return options?.thinking; case let .cursor(_, options): return options?.thinking; case let .devin(_, options): return options?.thinking; default: return nil }
    }

    var fastMode: Bool? {
        switch self { case let .codex(_, options): return options?.fastMode; case let .claudeAgent(_, options): return options?.fastMode; case let .cursor(_, options): return options?.fastMode; case let .devin(_, options): return options?.fastMode; default: return nil }
    }

    var autoCompactWindow: Int? { if case let .claudeAgent(_, options) = self { return options?.autoCompactWindow }; return nil }

    func changing(effort: String?? = nil, thinking: Bool?? = nil, fastMode: Bool?? = nil, autoCompactWindow: Int?? = nil) -> ModelSelection {
        switch self {
        case let .codex(model, options): return .codex(model: model, options: CodexModelOptions(reasoningEffort: effort ?? options?.reasoningEffort, fastMode: fastMode ?? options?.fastMode))
        case let .claudeAgent(model, options): return .claudeAgent(model: model, options: ClaudeModelOptions(thinking: thinking ?? options?.thinking, effort: effort ?? options?.effort, fastMode: fastMode ?? options?.fastMode, autoCompactWindow: autoCompactWindow ?? options?.autoCompactWindow, contextWindow: options?.contextWindow))
        default: return self
        }
    }
}
