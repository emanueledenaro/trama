import Foundation

/// A model or effort the person chose for the next message only.
public struct TurnOverride: Equatable, Sendable {
    public var model: String?
    public var effort: String?

    public init(model: String? = nil, effort: String? = nil) {
        self.model = model
        self.effort = effort
    }

    public var isEmpty: Bool { model == nil && effort == nil }
}

/// The model and effort one Coordinator turn is sent with.
public struct TurnSelection: Equatable, Sendable {
    public var model: String
    /// Always explicit when known: Codex keeps a `turn/start` effort for the following turns too.
    public var effort: String?
    public var overridesModel: Bool
    public var overridesEffort: Bool

    public init(model: String, effort: String?, overridesModel: Bool, overridesEffort: Bool) {
        self.model = model
        self.effort = effort
        self.overridesModel = overridesModel
        self.overridesEffort = overridesEffort
    }
}

public enum ReasoningEffortSupport: Equatable, Sendable {
    case supported, unsupported, unknown
}

/// Which model the Coordinator uses, and what one turn sends to Codex.
public enum CoordinatorModelChoice {
    /// Trama's model when the project has none: decision of 16 September 2026 (#70).
    public static let preferredModel = "gpt-5.6-luna"

    public static let preferredUnavailableMessage = "Il modello \(preferredModel) non è nel catalogo Codex di questo account. Scegli un modello per il Coordinatore: partirà solo dopo la tua scelta."

    public enum Preselection: Equatable, Sendable {
        /// The project already has a model, available or not.
        case saved(String)
        /// No model was chosen: Trama selects its preferred model.
        case preselected(String)
        /// The catalogue has not arrived yet.
        case catalogueLoading
        /// No model was chosen and the preferred model is missing: the person must choose.
        case preferredUnavailable

        public var model: String? {
            switch self {
            case let .saved(model), let .preselected(model): model
            case .catalogueLoading, .preferredUnavailable: nil
            }
        }
    }

    /// The Coordinator model of a project. The catalogue default is never taken on its own.
    public static func preselect(saved: String?, models: [CodexClient.Model]) -> Preselection {
        if let saved, !saved.isEmpty { return .saved(saved) }
        guard !models.isEmpty else { return .catalogueLoading }
        return models.contains(where: { $0.model == preferredModel }) ? .preselected(preferredModel) : .preferredUnavailable
    }

    /// Synara's `classifyProviderReasoningEffortSupport`, with the runtime catalogue only.
    public static func effortSupport(_ effort: String, model: CodexClient.Model?) -> ReasoningEffortSupport {
        guard let model, !model.supportedReasoningEfforts.isEmpty else { return .unknown }
        return model.supportedReasoningEfforts.contains(effort) ? .supported : .unsupported
    }

    /// The model and effort of the next turn; nil when the model is not in the catalogue.
    /// The Coordinator model itself does not change.
    public static func turnSelection(coordinatorModel: String, override: TurnOverride, models: [CodexClient.Model]) -> TurnSelection? {
        let name = override.model ?? coordinatorModel
        guard !name.isEmpty, let model = models.first(where: { $0.model == name }) else { return nil }
        var effort = model.defaultReasoningEffort
        var overridesEffort = false
        if let requested = override.effort, effortSupport(requested, model: model) != .unsupported {
            overridesEffort = requested != model.defaultReasoningEffort
            effort = requested
        }
        return TurnSelection(model: model.model, effort: effort, overridesModel: override.model != nil && name != coordinatorModel, overridesEffort: overridesEffort)
    }

    public static func effortLabel(_ effort: String) -> String {
        switch effort {
        case "none": "Nessuno"
        case "minimal": "Minimo"
        case "low": "Basso"
        case "medium": "Medio"
        case "high": "Alto"
        case "xhigh": "Molto alto"
        default: effort
        }
    }
}
