import Foundation

/// The static Claude Agent catalogue of Synara's `packages/contracts/src/model.ts`, used only when
/// the runtime does not answer. The runtime list from `supportedModels` always wins.
public enum ClaudeStaticCatalogue {
    public static let defaultModel = "claude-sonnet-5"

    private static let noFastXHigh: [String] = ["low", "medium", "high", "xhigh", "max"]
    private static let noXHigh: [String] = ["low", "medium", "high", "max"]
    private static let lowHigh: [String] = ["low", "medium", "high"]

    public static let models: [ProviderModelDescriptor] = [
        ProviderModelDescriptor(slug: "claude-fable-5-1", name: "Claude Fable 5.1", supportedReasoningEfforts: noFastXHigh),
        ProviderModelDescriptor(slug: "claude-fable-5", name: "Claude Fable 5", supportedReasoningEfforts: noFastXHigh),
        ProviderModelDescriptor(slug: "claude-opus-5", name: "Claude Opus 5", supportedReasoningEfforts: noFastXHigh, supportsFastMode: true),
        ProviderModelDescriptor(slug: "claude-opus-4-8", name: "Claude Opus 4.8", supportedReasoningEfforts: noFastXHigh, supportsFastMode: true),
        ProviderModelDescriptor(slug: "claude-opus-4-7", name: "Claude Opus 4.7", supportedReasoningEfforts: noFastXHigh, supportsFastMode: true),
        ProviderModelDescriptor(slug: "claude-opus-4-6", name: "Claude Opus 4.6", supportedReasoningEfforts: noXHigh, supportsFastMode: true),
        ProviderModelDescriptor(slug: "claude-opus-4-5", name: "Claude Opus 4.5", supportedReasoningEfforts: lowHigh),
        ProviderModelDescriptor(slug: "claude-sonnet-5", name: "Claude Sonnet 5", supportedReasoningEfforts: noFastXHigh, isDefault: true),
        ProviderModelDescriptor(slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", supportedReasoningEfforts: noXHigh),
        ProviderModelDescriptor(slug: "claude-haiku-4-5", name: "Claude Haiku 4.5")
    ]

    /// The auto-compaction windows the CLI accepts: auto, 200k, 1M.
    public static let autoCompactWindows = ["auto", "200k", "1m"]
}
