import Foundation

/// The result of one finished `claude` command of the access check.
public struct ClaudeCommandResult: Equatable, Sendable {
    public var stdout: String
    public var stderr: String
    public var code: Int32
    /// True when Trama stopped the process because the check took too long.
    public var timedOut: Bool
    /// False when the process never started, for example because the binary is missing.
    public var didLaunch: Bool

    public init(stdout: String = "", stderr: String = "", code: Int32 = 0, timedOut: Bool = false, didLaunch: Bool = true) {
        self.stdout = stdout
        self.stderr = stderr
        self.code = code
        self.timedOut = timedOut
        self.didLaunch = didLaunch
    }

    public var combinedLowercased: String {
        "\(stdout)\n\(stderr)".lowercased()
    }

    /// The sentence shown when a command failed, as `detailFromResult` builds it.
    public var detail: String? {
        if timedOut { return "La verifica ha superato il tempo massimo." }
        let error = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        if !error.isEmpty { return error }
        let output = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        if !output.isEmpty { return output }
        if code != 0 { return "Il comando è uscito con codice \(code)." }
        return nil
    }
}

/// The verdict of `parseClaudeAuthStatusFromOutput`: a screen state, the access state and a message.
public struct ClaudeAuthVerdict: Equatable, Sendable {
    public enum ScreenState: String, Equatable, Sendable {
        case ready, warning, error
    }

    public var status: ScreenState
    public var authStatus: ProviderAccessState
    public var message: String?

    public init(status: ScreenState, authStatus: ProviderAccessState, message: String? = nil) {
        self.status = status
        self.authStatus = authStatus
        self.message = message
    }
}

/// The four rules of Synara's `parseClaudeAuthStatusFromOutput`, in order, as pure functions.
///
/// The command text is lowercased once and matched against the same phrases. A JSON body that
/// carries an auth boolean anywhere in the tree decides before the exit code does.
public enum ClaudeAuthStatusParser {
    public static func parse(_ result: ClaudeCommandResult) -> ClaudeAuthVerdict {
        if result.timedOut {
            return ClaudeAuthVerdict(
                status: .warning,
                authStatus: .unknown,
                message: "Non è stato possibile verificare l'accesso di Claude. La verifica ha superato il tempo massimo."
            )
        }
        if hasUnsupportedAuthStatusText(result) {
            return ClaudeAuthVerdict(
                status: .warning,
                authStatus: .unknown,
                message: "Il comando di stato dell'accesso di Claude Agent non è disponibile in questa versione di Claude."
            )
        }
        if hasLoginRequiredText(result) {
            return ClaudeAuthVerdict(
                status: .error,
                authStatus: .unauthenticated,
                message: "Claude non è autenticato. Esegui `claude auth login` e riprova."
            )
        }
        let marker = jsonAuthMarker(result)
        if marker.auth == true {
            return ClaudeAuthVerdict(status: .ready, authStatus: .authenticated)
        }
        if marker.auth == false {
            return ClaudeAuthVerdict(
                status: .error,
                authStatus: .unauthenticated,
                message: "Claude non è autenticato. Esegui `claude auth login` e riprova."
            )
        }
        if marker.attempted {
            return ClaudeAuthVerdict(
                status: .warning,
                authStatus: .unknown,
                message: "Non è stato possibile verificare l'accesso di Claude dall'output JSON (manca il marcatore di accesso)."
            )
        }
        if result.code == 0 {
            return ClaudeAuthVerdict(status: .ready, authStatus: .authenticated)
        }
        let detail = result.detail
        return ClaudeAuthVerdict(
            status: .warning,
            authStatus: .unknown,
            message: detail.map { "Non è stato possibile verificare l'accesso di Claude. \($0)" }
                ?? "Non è stato possibile verificare l'accesso di Claude."
        )
    }

    /// A `loggedIn:false` with exit code 0 and no login-required text is the rotation race.
    public static func isStructuredFalseNegative(_ result: ClaudeCommandResult, _ parsed: ClaudeAuthVerdict) -> Bool {
        parsed.authStatus == .unauthenticated
            && result.code == 0
            && jsonAuthMarker(result).auth == false
            && !hasLoginRequiredText(result)
    }

    public static func hasUnsupportedAuthStatusText(_ result: ClaudeCommandResult) -> Bool {
        let output = result.combinedLowercased
        return output.contains("unknown command")
            || output.contains("unrecognized command")
            || output.contains("unexpected argument")
    }

    public static func hasLoginRequiredText(_ result: ClaudeCommandResult) -> Bool {
        let output = result.combinedLowercased
        return output.contains("not logged in")
            || output.contains("login required")
            || output.contains("authentication required")
            || output.contains("run `claude login`")
            || output.contains("run claude login")
    }

    /// `claude auth status` prints JSON with a `loggedIn` boolean. A body that is not JSON is not
    /// an attempt; a JSON body without an auth marker is an attempt with no answer.
    public static func jsonAuthMarker(_ result: ClaudeCommandResult) -> (attempted: Bool, auth: Bool?) {
        let trimmed = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.hasPrefix("{") || trimmed.hasPrefix("[") else {
            return (false, nil)
        }
        guard let data = trimmed.data(using: .utf8),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            return (true, nil)
        }
        return (true, extractAuthBoolean(value))
    }

    /// The auth boolean anywhere in the JSON tree, as `extractAuthBoolean` walks it.
    public static func extractAuthBoolean(_ value: JSONValue) -> Bool? {
        if case let .array(entries) = value {
            for entry in entries {
                if let nested = extractAuthBoolean(entry) { return nested }
            }
            return nil
        }
        guard let object = value.objectValue else { return nil }
        for key in ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] {
            if let flag = object[key]?.boolValue { return flag }
        }
        for key in ["auth", "status", "session", "account"] {
            if let nested = object[key], let flag = extractAuthBoolean(nested) { return flag }
        }
        return nil
    }

    public static func subscriptionType(from result: ClaudeCommandResult) -> String? {
        guard let root = decodeJSON(result.stdout) else { return nil }
        return findString(root, keys: ["subscriptionType", "subscription_type", "subscription", "planType", "plan"])
    }

    public static func authMethod(from result: ClaudeCommandResult) -> String? {
        guard let root = decodeJSON(result.stdout) else { return nil }
        return findString(root, keys: ["authMethod", "auth_method", "authenticationMethod", "apiProvider"])
    }

    private static func decodeJSON(_ text: String) -> JSONValue? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    private static func findString(_ value: JSONValue, keys: [String]) -> String? {
        if case let .array(entries) = value {
            for entry in entries {
                if let found = findString(entry, keys: keys) { return found }
            }
            return nil
        }
        guard let object = value.objectValue else { return nil }
        for key in keys {
            if let text = object[key]?.stringValue?.trimmingCharacters(in: .whitespaces), !text.isEmpty {
                return text
            }
        }
        for key in ["auth", "status", "session", "account", "claudeAiOauth"] {
            if let nested = object[key], let found = findString(nested, keys: keys) { return found }
        }
        return nil
    }
}

/// The subscription and API-key labels of `claudeAuthMetadata`.
public enum ClaudeAuthMetadata {
    public static func metadata(subscriptionType: String?, authMethod: String?) -> (type: String, label: String)? {
        if normalize(authMethod) == "apikey" {
            return (type: "apiKey", label: "Claude API Key")
        }
        guard let subscriptionType, !subscriptionType.trimmingCharacters(in: .whitespaces).isEmpty else {
            return nil
        }
        let label = subscriptionLabel(subscriptionType) ?? titleCaseWords(subscriptionType)
        return (type: subscriptionType, label: "Claude \(label) Subscription")
    }

    /// `max`, `max plan`, `max5`, `max20` all read "Max"; an unknown value keeps its words.
    public static func subscriptionLabel(_ value: String) -> String? {
        let normalized = normalize(value)
        guard !normalized.isEmpty else { return nil }
        switch normalized {
        case "max", "maxplan", "max5", "max20": return "Max"
        case "enterprise": return "Enterprise"
        case "team": return "Team"
        case "pro": return "Pro"
        case "free": return "Free"
        default: return titleCaseWords(value)
        }
    }

    static func normalize(_ value: String?) -> String {
        (value ?? "")
            .lowercased()
            .components(separatedBy: CharacterSet(charactersIn: " _-"))
            .joined()
    }

    static func titleCaseWords(_ value: String) -> String {
        value
            .components(separatedBy: CharacterSet(charactersIn: " _-"))
            .filter { !$0.isEmpty }
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }
}

/// The CLI version and the minimum that supports Auto, `2.1.111`.
public enum ClaudeCLIVersion {
    public static let minimumAutoMode = "2.1.111"

    /// Reads the first `x.y.z` run in `claude --version` output.
    public static func parse(_ text: String) -> String? {
        let pattern = try? NSRegularExpression(pattern: "(\\d+)\\.(\\d+)\\.(\\d+)")
        let range = NSRange(text.startIndex..., in: text)
        guard let match = pattern?.firstMatch(in: text, range: range),
              let swiftRange = Range(match.range, in: text) else { return nil }
        return String(text[swiftRange])
    }

    /// Negative when `lhs` is older, positive when newer, zero when equal.
    public static func compare(_ lhs: String, _ rhs: String) -> Int {
        let left = lhs.split(separator: ".").compactMap { Int($0) }
        let right = rhs.split(separator: ".").compactMap { Int($0) }
        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a != b { return a < b ? -1 : 1 }
        }
        return 0
    }

    public static func supportsAutoMode(_ version: String?) -> Bool {
        guard let version else { return false }
        return compare(version, minimumAutoMode) >= 0
    }
}

/// The local OAuth record, read to tell a real logout from the refresh-token rotation race.
///
/// On macOS the CLI keeps OAuth in the Keychain, so the file is usually absent and the summary is
/// not usable; the check then falls back to the runtime probe.
public struct ClaudeCredentialsSummary: Equatable, Sendable {
    public var isUsable: Bool
    public var subscriptionType: String?

    public init(isUsable: Bool = false, subscriptionType: String? = nil) {
        self.isUsable = isUsable
        self.subscriptionType = subscriptionType
    }

    public static func paths(environment: [String: String], home: URL) -> [URL] {
        var paths: [URL] = []
        if let configDirectory = environment["CLAUDE_CONFIG_DIR"]?.trimmingCharacters(in: .whitespaces), !configDirectory.isEmpty {
            paths.append(URL(fileURLWithPath: configDirectory).appendingPathComponent(".credentials.json"))
        }
        paths.append(home.appendingPathComponent(".claude").appendingPathComponent(".credentials.json"))
        var seen = Set<String>()
        return paths.filter { seen.insert($0.path).inserted }
    }

    public static func read(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        home: URL = FileManager.default.homeDirectoryForCurrentUser,
        now: Date = Date(),
        readFile: (URL) -> String? = { try? String(contentsOf: $0, encoding: .utf8) }
    ) -> ClaudeCredentialsSummary {
        for path in paths(environment: environment, home: home) {
            guard let content = readFile(path) else { continue }
            let summary = parse(content, now: now)
            if summary.isUsable { return summary }
        }
        return ClaudeCredentialsSummary()
    }

    public static func parse(_ content: String, now: Date = Date()) -> ClaudeCredentialsSummary {
        guard let data = content.data(using: .utf8),
              let root = try? JSONDecoder().decode(JSONValue.self, from: data),
              let oauth = root.objectValue?["claudeAiOauth"]?.objectValue else {
            return ClaudeCredentialsSummary()
        }
        let accessToken = oauth["accessToken"]?.stringValue
        let refreshToken = oauth["refreshToken"]?.stringValue
        guard accessToken != nil || refreshToken != nil else { return ClaudeCredentialsSummary() }
        let expiresAt = oauth["expiresAt"]?.intValue
        let usable = expiresAt == nil
            || Double(expiresAt!) > now.timeIntervalSince1970 * 1_000
            || refreshToken != nil
        return ClaudeCredentialsSummary(isUsable: usable, subscriptionType: oauth["subscriptionType"]?.stringValue)
    }
}

/// The process-wide FIFO mutex around `claude auth status`.
///
/// The command can redeem a single-use rotating OAuth refresh token. Two concurrent invocations
/// make the loser observe an already-rotated token and answer `{"loggedIn":false}` while the
/// account is authenticated. One invocation at a time removes the race.
public actor ClaudeAuthStatusLock {
    private var isBusy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    public init() {}

    public func acquire() async {
        if !isBusy {
            isBusy = true
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    public func release() {
        guard !waiters.isEmpty else {
            isBusy = false
            return
        }
        let next = waiters.removeFirst()
        next.resume()
    }

    public func withLock<T>(_ body: () async -> T) async -> T {
        await acquire()
        let value = await body()
        release()
        return value
    }
}
