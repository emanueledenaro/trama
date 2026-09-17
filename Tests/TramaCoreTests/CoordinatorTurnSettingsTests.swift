import Foundation
import Testing
@testable import TramaCore

@Suite("Coordinator model and effort")
struct CoordinatorTurnSettingsTests {
    static func model(_ id: String, isDefault: Bool = false, efforts: [String] = ["low", "medium", "high", "xhigh"], defaultEffort: String? = "medium") -> CodexClient.Model {
        CodexClient.Model(id: id, model: id, displayName: id, description: "", isDefault: isDefault, supportedReasoningEfforts: efforts, defaultReasoningEffort: defaultEffort)
    }

    static let astra = model("gpt-6-astra", isDefault: true, defaultEffort: "high")
    static let luna = model("gpt-5.6-luna")
    static let terra = model("gpt-5.6-terra", efforts: ["low", "medium"])

    @Test("Without a saved model Trama preselects gpt-5.6-luna rather than the catalogue default")
    func preselectsLuna() {
        #expect(CoordinatorModelChoice.preferredModel == "gpt-5.6-luna")
        #expect(CoordinatorModelChoice.preselect(saved: nil, models: [Self.astra, Self.luna]) == .preselected("gpt-5.6-luna"))
        #expect(CoordinatorModelChoice.preselect(saved: "", models: [Self.luna, Self.astra]) == .preselected("gpt-5.6-luna"))
    }

    @Test("Without Luna the person must choose; the catalogue default is never taken")
    func lunaUnavailable() {
        let choice = CoordinatorModelChoice.preselect(saved: nil, models: [Self.astra, Self.terra])
        #expect(choice == .preferredUnavailable)
        #expect(choice.model == nil)
        #expect(CoordinatorModelChoice.preferredUnavailableMessage.contains("gpt-5.6-luna"))
        #expect(CoordinatorModelChoice.preferredUnavailableMessage.contains("Scegli"))
    }

    @Test("A saved model is kept, and an empty catalogue decides nothing yet")
    func savedAndLoading() {
        #expect(CoordinatorModelChoice.preselect(saved: "gpt-6-astra", models: [Self.astra, Self.luna]) == .saved("gpt-6-astra"))
        #expect(CoordinatorModelChoice.preselect(saved: "gone", models: [Self.luna]) == .saved("gone"))
        #expect(CoordinatorModelChoice.preselect(saved: nil, models: []) == .catalogueLoading)
        #expect(CoordinatorModelChoice.preselect(saved: "gpt-5.6-luna", models: []) == .saved("gpt-5.6-luna"))
    }

    @Test("Effort support follows the runtime catalogue; an unknown model lets the value through")
    func effortSupport() {
        #expect(CoordinatorModelChoice.effortSupport("high", model: Self.luna) == .supported)
        #expect(CoordinatorModelChoice.effortSupport("xhigh", model: Self.terra) == .unsupported)
        #expect(CoordinatorModelChoice.effortSupport("high", model: nil) == .unknown)
        #expect(CoordinatorModelChoice.effortSupport("high", model: Self.model("bare", efforts: [], defaultEffort: nil)) == .unknown)
    }

    @Test("A turn uses the Coordinator model with its default effort, sent explicitly")
    func defaultTurn() {
        let selection = CoordinatorModelChoice.turnSelection(coordinatorModel: "gpt-5.6-luna", override: .init(), models: [Self.astra, Self.luna])
        #expect(selection == TurnSelection(model: "gpt-5.6-luna", effort: "medium", overridesModel: false, overridesEffort: false))
    }

    @Test("A one-turn effort override is sent when the model supports it, otherwise the default is")
    func effortOverride() {
        let high = CoordinatorModelChoice.turnSelection(coordinatorModel: "gpt-5.6-luna", override: .init(effort: "high"), models: [Self.luna])
        #expect(high == TurnSelection(model: "gpt-5.6-luna", effort: "high", overridesModel: false, overridesEffort: true))
        let unsupported = CoordinatorModelChoice.turnSelection(coordinatorModel: "gpt-5.6-terra", override: .init(effort: "xhigh"), models: [Self.terra])
        #expect(unsupported == TurnSelection(model: "gpt-5.6-terra", effort: "medium", overridesModel: false, overridesEffort: false))
        let unknown = CoordinatorModelChoice.turnSelection(coordinatorModel: "bare", override: .init(effort: "high"), models: [Self.model("bare", efforts: [], defaultEffort: nil)])
        #expect(unknown?.effort == "high")
        let sameAsDefault = CoordinatorModelChoice.turnSelection(coordinatorModel: "gpt-5.6-luna", override: .init(effort: "medium"), models: [Self.luna])
        #expect(sameAsDefault?.overridesEffort == false)
    }

    @Test("A one-turn model override must be in the catalogue and brings its own default effort")
    func modelOverride() {
        let other = CoordinatorModelChoice.turnSelection(coordinatorModel: "gpt-5.6-luna", override: .init(model: "gpt-5.6-terra"), models: [Self.luna, Self.terra])
        #expect(other == TurnSelection(model: "gpt-5.6-terra", effort: "medium", overridesModel: true, overridesEffort: false))
        let missing = CoordinatorModelChoice.turnSelection(coordinatorModel: "gpt-5.6-luna", override: .init(model: "gone"), models: [Self.luna])
        #expect(missing == nil)
        #expect(CoordinatorModelChoice.turnSelection(coordinatorModel: "gone", override: .init(), models: [Self.luna]) == nil)
        #expect(CoordinatorModelChoice.turnSelection(coordinatorModel: "", override: .init(), models: [Self.luna]) == nil)
    }

    @Test("Effort labels are Italian and keep unknown runtime values")
    func effortLabels() {
        #expect(CoordinatorModelChoice.effortLabel("low") == "Basso")
        #expect(CoordinatorModelChoice.effortLabel("medium") == "Medio")
        #expect(CoordinatorModelChoice.effortLabel("high") == "Alto")
        #expect(CoordinatorModelChoice.effortLabel("xhigh") == "Molto alto")
        #expect(CoordinatorModelChoice.effortLabel("turbo") == "turbo")
    }

    @Test("A model saved without effort fields still decodes")
    func modelDecodesWithoutEfforts() throws {
        let data = Data(#"{"id":"m","model":"m","displayName":"M","description":"d","isDefault":true}"#.utf8)
        let model = try JSONDecoder().decode(CodexClient.Model.self, from: data)
        #expect(model.supportedReasoningEfforts == [])
        #expect(model.defaultReasoningEffort == nil)
    }
}
