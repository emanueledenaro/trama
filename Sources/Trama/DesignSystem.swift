import AppKit
import SwiftUI
import TramaCore

enum TramaSpacing {
    static let compact: CGFloat = 6
    static let control: CGFloat = 10
    static let related: CGFloat = 12
    static let section: CGFloat = 20
    static let content: CGFloat = 24
}

enum TramaRadius {
    static let control: CGFloat = 8
    static let card: CGFloat = 12
    /// Floating composer and window cards, 2xl in the reference.
    static let floating: CGFloat = 16
}

/// The neutral grays of the Codex window, per role, with the light and dark tone of each.
///
/// The names are roles, not numbers: `page` is white in light and near black in dark, as in
/// `docs/reference/design-app-codex.md`. Nothing here carries a hue except the informational blue.
enum TramaSurface {
    /// Main surface: the conversation column and the detail area.
    static let page = dynamic(light: 0xFFFFFF, dark: 0x181818)
    /// Secondary surface: sidebar, menus and the inspector header.
    static let secondary = dynamic(light: 0xF9F9F9, dark: 0x212121)
    /// Soft background for chips, active rows and the person's message.
    static let soft = dynamic(light: 0xEDEDED, dark: 0x303030)
    /// Filled primary button: near black on light, near black on dark, always with white text.
    static let primaryButton = dynamic(light: 0x181818, dark: 0x131313)
    /// Floating blocks that must read above the page: the composer and the cards.
    static let raised = dynamic(light: 0xFFFFFF, dark: 0x212121)
}

enum TramaText {
    static let primary = dynamic(light: 0x282828, dark: 0xDFDFDF)
    static let emphasis = dynamic(light: 0x0D0D0D, dark: 0xFFFFFF)
    static let secondary = dynamic(light: 0x5D5D5D, dark: 0x8F8F8F)
    static let tertiary = dynamic(light: 0x8F8F8F, dark: 0x5D5D5D)
}

enum TramaInfo {
    /// Informational text: links and selected rows.
    static let text = dynamic(light: 0x0169CC, dark: 0x66B5FF)
    /// Informational fill.
    static let solid = color(hex: 0x0285FF)
}

/// The three states of the window: an open decision, work under way, a verified candidate.
///
/// These are the only colours the window chrome uses beyond the grays; text and symbol always
/// accompany them, so the state never depends on colour alone.
enum TramaStateColor {
    static let pending = Color(nsColor: .systemOrange)
    static let building = Color(nsColor: .systemBlue)
    static let verified = Color(nsColor: .systemGreen)
    static let failed = Color(nsColor: .systemRed)
}

/// Border and hover of the flat controls, stronger when the system asks for more contrast.
enum TramaBorder {
    static func outline(_ contrast: ColorSchemeContrast) -> Color {
        contrast == .increased
            ? Color.primary.opacity(0.42)
            : dynamic(light: 0x000000, dark: 0xFFFFFF, lightAlpha: 0.16, darkAlpha: 0.25)
    }

    /// The standard outline, where the view has no contrast environment of its own.
    static func outline() -> Color { outline(.standard) }

    /// A hairline between blocks, quieter than a full outline.
    static func hairline(_ contrast: ColorSchemeContrast) -> Color {
        contrast == .increased
            ? Color.primary.opacity(0.30)
            : dynamic(light: 0x000000, dark: 0xFFFFFF, lightAlpha: 0.10, darkAlpha: 0.18)
    }

    static func hairline() -> Color { hairline(.standard) }

    /// Background of a flat control under the pointer.
    static func hover(_ contrast: ColorSchemeContrast) -> Color {
        contrast == .increased
            ? Color.primary.opacity(0.16)
            : dynamic(light: 0x000000, dark: 0xFFFFFF, lightAlpha: 0.08, darkAlpha: 0.12)
    }
}

/// The four shadow steps of the reference; all very light.
enum TramaShadow {
    struct Step {
        let radius: CGFloat
        let y: CGFloat
        let opacity: Double
    }

    static let small = Step(radius: 2, y: 1, opacity: 0.08)
    static let medium = Step(radius: 4, y: 2, opacity: 0.08)
    static let large = Step(radius: 8, y: 4, opacity: 0.10)
    static let extraLarge = Step(radius: 16, y: 8, opacity: 0.12)
}

extension View {
    /// Applies one of the four shadow steps of the reference.
    func tramaShadow(_ step: TramaShadow.Step) -> some View {
        shadow(color: .black.opacity(step.opacity), radius: step.radius, y: step.y)
    }
}

/// Resolves a light and a dark tone into one colour that follows the system appearance.
func dynamic(light: UInt32, dark: UInt32, lightAlpha: Double = 1, darkAlpha: Double = 1) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
        let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let value = isDark ? dark : light
        return NSColor(
            srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: CGFloat(isDark ? darkAlpha : lightAlpha)
        )
    })
}

/// One tone of the reference palette, the same in light and dark.
func color(hex: UInt32, alpha: Double = 1) -> Color {
    Color(
        .sRGB,
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255,
        opacity: alpha
    )
}

/// The window's own surfaces: a card, the flat row of the sidebar and the filled primary button.
///
/// They read `colorSchemeContrast` and `accessibilityReduceTransparency`, so Increase Contrast and
/// Reduce Transparency change the result instead of being ignored.
struct TramaPanel<Content: View>: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var raised = false
    var radius: CGFloat = TramaRadius.card
    @ViewBuilder var content: Content

    var body: some View {
        content
            .background(surfaceBackground)
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(TramaBorder.outline(contrast), lineWidth: reduceTransparency ? 1.2 : 1))
            .tramaShadow(TramaShadow.small)
    }

    /// A raised panel is translucent until the system asks for less transparency, then it is opaque.
    @ViewBuilder
    private var surfaceBackground: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if raised, !reduceTransparency {
            shape.fill(.regularMaterial)
        } else {
            (raised ? TramaSurface.raised : TramaSurface.secondary).clipShape(shape)
        }
    }
}

/// The filled primary action of the window.
///
/// On light it is near black with white text, as the reference asks; the system's own prominent
/// button would take the accent colour instead. It answers control size, the disabled state and
/// Increase Contrast.
struct TramaPrimaryButtonStyle: ButtonStyle {
    enum Shape {
        case rounded
        /// The circular icon-only send button of the composer.
        case circle
    }

    var shape: Shape = .rounded

    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.controlSize) private var controlSize
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let metrics = Metrics(controlSize)
        return configuration.label
            .font(metrics.font)
            .foregroundStyle(.white)
            .padding(.horizontal, shape == .circle ? 0 : metrics.horizontal)
            .frame(minWidth: shape == .circle ? metrics.height : nil, minHeight: metrics.height)
            .background(backgroundView(isPressed: configuration.isPressed))
            .opacity(isEnabled ? 1 : 0.45)
    }

    private func fill(isPressed: Bool) -> Color {
        TramaSurface.primaryButton.opacity(isPressed ? 0.82 : 1)
    }

    private func outlineWidth() -> CGFloat { contrast == .increased ? 1 : 0 }

    @ViewBuilder
    private func backgroundView(isPressed: Bool) -> some View {
        switch shape {
        case .rounded:
            let rounded = RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous)
            rounded.fill(fill(isPressed: isPressed))
                .overlay(rounded.strokeBorder(.white.opacity(contrast == .increased ? 0.45 : 0), lineWidth: outlineWidth()))
        case .circle:
            Circle().fill(fill(isPressed: isPressed))
                .overlay(Circle().strokeBorder(.white.opacity(contrast == .increased ? 0.45 : 0), lineWidth: outlineWidth()))
        }
    }

    private struct Metrics {
        let height: CGFloat
        let horizontal: CGFloat
        let font: Font

        init(_ size: ControlSize) {
            switch size {
            case .mini: self.init(height: 20, horizontal: 8, font: .caption)
            case .small: self.init(height: 24, horizontal: 10, font: .callout)
            case .large, .extraLarge: self.init(height: 36, horizontal: 18, font: .body)
            default: self.init(height: 28, horizontal: 12, font: .body)
            }
        }

        private init(height: CGFloat, horizontal: CGFloat, font: Font) {
            self.height = height
            self.horizontal = horizontal
            self.font = font
        }
    }
}

/// A bordered action that leaves the primary button as the only filled one.
struct TramaSecondaryButtonStyle: ButtonStyle {
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body)
            .foregroundStyle(TramaText.primary)
            .padding(.horizontal, TramaSpacing.related)
            .frame(minHeight: 28)
            .background(configuration.isPressed ? TramaBorder.hover(contrast) : .clear, in: RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous).strokeBorder(TramaBorder.outline(contrast), lineWidth: 1))
    }
}

/// How much room a shared header takes: full screens breathe, the panels of the inspector do not.
enum TramaHeaderDensity {
    case screen, panel
}

private struct TramaHeaderDensityKey: EnvironmentKey {
    static let defaultValue: TramaHeaderDensity = .screen
}

extension EnvironmentValues {
    var tramaHeaderDensity: TramaHeaderDensity {
        get { self[TramaHeaderDensityKey.self] }
        set { self[TramaHeaderDensityKey.self] = newValue }
    }
}

struct TramaScreenHeader<Actions: View>: View {
    @Environment(\.tramaHeaderDensity) private var density
    let title: String
    let subtitle: String
    @ViewBuilder let actions: Actions

    init(_ title: String, subtitle: String, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.subtitle = subtitle
        self.actions = actions()
    }

    var body: some View {
        if density == .panel {
            panelBar
        } else {
            screenHeader
        }
    }

    /// Inside the inspector the title is already in the pane's own header, so the shared header
    /// becomes one quiet status line with the actions on the same guide.
    private var panelBar: some View {
        HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.related) {
            Text(subtitle).font(.callout).foregroundStyle(TramaText.secondary)
            Spacer(minLength: 0)
            actions.fixedSize(horizontal: true, vertical: false)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TramaSpacing.section)
        .padding(.vertical, TramaSpacing.control)
    }

    private var screenHeader: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TramaSpacing.section) {
                titleBlock
                Spacer(minLength: TramaSpacing.related)
                actions.fixedSize(horizontal: true, vertical: false)
            }
            VStack(alignment: .leading, spacing: TramaSpacing.related) {
                titleBlock
                actions
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TramaSpacing.content)
        .padding(.vertical, TramaSpacing.section)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text(title).font(.title2.weight(.semibold)).foregroundStyle(TramaText.emphasis)
            Text(subtitle).font(.callout).foregroundStyle(TramaText.secondary)
        }
    }
}

struct TramaAdaptiveActions<Content: View>: View {
    @ViewBuilder let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TramaSpacing.control) { content }
            VStack(alignment: .leading, spacing: TramaSpacing.control) { content }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TramaSupportingText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(TramaText.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct TramaLabeledText: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text(label).font(.caption.weight(.medium)).foregroundStyle(TramaText.secondary)
            Text(value).font(.body).textSelection(.enabled).foregroundStyle(TramaText.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct TramaTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, TramaSpacing.control)
            .padding(.vertical, 4)
            .background(TramaSurface.soft, in: Capsule())
            .accessibilityLabel("Etichetta: \(text)")
    }
}

struct TramaStatusBadge: View {
    let label: String
    let symbol: String
    let color: Color

    init(label: String, symbol: String, color: Color) {
        self.label = label
        self.symbol = symbol
        self.color = color
    }

    init(state: RequestState) {
        self.init(label: state.label, symbol: state.symbol, color: Self.color(for: state.tone))
    }

    var body: some View {
        Label(label, systemImage: symbol)
            .font(.caption.weight(.medium))
            .foregroundStyle(color)
            .padding(.horizontal, TramaSpacing.control)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
            .accessibilityLabel("Stato: \(label)")
    }

    static func color(for tone: RequestState.Tone) -> Color {
        switch tone {
        case .neutral: .secondary
        case .waiting, .attention: TramaStateColor.pending
        case .working: TramaStateColor.building
        case .success: TramaStateColor.verified
        case .failure: TramaStateColor.failed
        }
    }
}
