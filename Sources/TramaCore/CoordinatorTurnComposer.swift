import Foundation

/// The input of one Coordinator turn, built from what the person wrote and attached.
public struct ComposedCoordinatorTurn: Equatable, Sendable {
    public var input: [CodexClient.TurnInputItem]
    public var mentions: [ResolvedMention]
    public var skills: [CodexClient.LoadedSkill]
    /// Italian summary for the conversation activity; nil for a plain message.
    public var summary: String?
}

/// Builds Coordinator turns in Synara's order: text, attachments, skills.
/// Trama's text is the study update, the mentioned context and the message.
public enum CoordinatorTurnComposer {
    /// The prompt Codex receives when the person sends images without text.
    public static let imageOnlyPrompt = "Look at the attached images and tell me what you see that matters for this project."

    public static func compose(
        message: String,
        imagePaths: [String],
        moduleLine: String?,
        contextUpdate: String?,
        sources: MentionSources,
        skills available: [CodexClient.LoadedSkill]
    ) -> ComposedCoordinatorTurn {
        // Mentions and skills count only in what the person typed, not in pasted text.
        let parts = PastedText.extractTrailing(from: message)
        let mentions = ComposerMentions.resolve(in: parts.prompt, sources: sources)
        let skills = ComposerSkills.invocations(in: parts.prompt, skills: available)
        let prompt = parts.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        var text = ComposerSkills.codexText(prompt, skills: available)
        if text.isEmpty, !imagePaths.isEmpty { text = imageOnlyPrompt }
        if !parts.texts.isEmpty {
            text = PastedText.serialize(prompt: text, pastes: parts.texts.map { PastedText(text: $0) })
        }
        if let moduleLine, !moduleLine.isEmpty { text = moduleLine + "\n\n" + text }

        var input: [CodexClient.TurnInputItem] = []
        if let contextUpdate { input.append(.text(contextUpdate)) }
        if let block = ComposerMentions.contextBlock(for: mentions, sources: sources) { input.append(.text(block)) }
        input.append(.text(text))
        input += imagePaths.map { .localImage(path: $0) }
        input += skills.map { .skill(name: $0.name, path: $0.path) }

        var summary: [String] = []
        if !mentions.isEmpty { summary.append("riferimenti: " + mentions.map(\.label).joined(separator: ", ")) }
        if !skills.isEmpty { summary.append("skill: " + skills.map(\.name).joined(separator: ", ")) }
        if !imagePaths.isEmpty { summary.append(imagePaths.count == 1 ? "1 immagine" : "\(imagePaths.count) immagini") }
        if !parts.texts.isEmpty { summary.append(parts.texts.count == 1 ? "1 testo incollato" : "\(parts.texts.count) testi incollati") }
        return ComposedCoordinatorTurn(input: input, mentions: mentions, skills: skills, summary: summary.isEmpty ? nil : summary.joined(separator: " · "))
    }
}
