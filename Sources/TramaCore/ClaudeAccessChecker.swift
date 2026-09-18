import Foundation

/// Runs one `claude` command with a timeout, as `probeProviderCliVersion` does for the health check.
public enum ClaudeCommandRunner {
    public static func run(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        timeout: TimeInterval
    ) async -> ClaudeCommandResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                let process = Process()
                let stdout = Pipe()
                let stderr = Pipe()
                process.executableURL = executable
                process.arguments = arguments
                process.standardOutput = stdout
                process.standardError = stderr
                process.standardInput = FileHandle.nullDevice
                process.environment = ClaudeProcessTransport.environment(
                    for: executable,
                    overrides: environment
                )
                do {
                    try process.run()
                } catch {
                    continuation.resume(returning: ClaudeCommandResult(stderr: error.localizedDescription, code: -1, didLaunch: false))
                    return
                }
                let deadline = Date().addingTimeInterval(timeout)
                while process.isRunning && Date() < deadline {
                    Thread.sleep(forTimeInterval: 0.05)
                }
                var timedOut = false
                if process.isRunning {
                    timedOut = true
                    process.terminate()
                    let stopDeadline = Date().addingTimeInterval(2)
                    while process.isRunning && Date() < stopDeadline { Thread.sleep(forTimeInterval: 0.05) }
                    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                }
                process.waitUntilExit()
                let out = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                let err = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                continuation.resume(returning: ClaudeCommandResult(
                    stdout: out,
                    stderr: err,
                    code: process.terminationStatus,
                    timedOut: timedOut
                ))
            }
        }
    }
}

/// The Claude Agent access check of Synara's `makeCheckClaudeProviderStatus`, ported.
///
/// Two commands run with a twenty-second cap: `claude --version` and `claude auth status`. The
/// second goes through the process-wide FIFO lock, because the command can redeem a single-use
/// rotating refresh token. A structured `loggedIn:false` with a clean exit is re-probed once, and
/// then rescued by the runtime probe, which reads the account from initialization without spending
/// a model call.
public struct ClaudeAccessChecker: Sendable {
    public typealias CommandRunner = @Sendable (URL, [String], [String: String], TimeInterval) async -> ClaudeCommandResult
    public typealias RuntimeProbe = @Sendable (ClaudeSessionOptions) async -> ClaudeRuntimeProbe.Outcome

    public var binaryURL: URL
    public var home: URL
    public var environment: [String: String]
    public var timeout: TimeInterval
    public var falseNegativeRetryDelay: TimeInterval
    public var commandRunner: CommandRunner
    public var runtimeProbe: RuntimeProbe
    public var lock: ClaudeAuthStatusLock
    public var now: @Sendable () -> Date
    /// Reads the local OAuth record. Injectable so the rotation-race branch is testable.
    public var credentialsReader: @Sendable () -> ClaudeCredentialsSummary

    public init(
        binaryURL: URL = ClaudeClient.defaultBinaryURL(),
        home: URL = FileManager.default.homeDirectoryForCurrentUser,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        timeout: TimeInterval = 20,
        falseNegativeRetryDelay: TimeInterval = 1,
        lock: ClaudeAuthStatusLock = ClaudeAuthStatusLock(),
        commandRunner: @escaping CommandRunner = { executable, arguments, environment, timeout in
            await ClaudeCommandRunner.run(executable: executable, arguments: arguments, environment: environment, timeout: timeout)
        },
        runtimeProbe: @escaping RuntimeProbe = { options in
            await ClaudeRuntimeProbe.run(options: options)
        },
        now: @escaping @Sendable () -> Date = { Date() },
        credentialsReader: (@Sendable () -> ClaudeCredentialsSummary)? = nil
    ) {
        self.binaryURL = binaryURL
        self.home = home
        self.environment = environment
        self.timeout = timeout
        self.falseNegativeRetryDelay = falseNegativeRetryDelay
        self.lock = lock
        self.credentialsReader = credentialsReader ?? {
            ClaudeCredentialsSummary.read(environment: environment, home: home)
        }
        self.commandRunner = commandRunner
        self.runtimeProbe = runtimeProbe
        self.now = now
    }

    public func check() async -> ProviderAccessStatus {
        let checkedAt = now()
        let versionResult = await commandRunner(binaryURL, ["--version"], environment, timeout)
        guard versionResult.didLaunch else {
            return ProviderAccessStatus(
                provider: .claudeAgent,
                state: .unknown,
                isAvailable: false,
                message: "Il programma `claude` non è installato o non è nel PATH.",
                checkedAt: checkedAt
            )
        }
        if versionResult.timedOut || versionResult.code != 0 {
            let detail = versionResult.detail
            return ProviderAccessStatus(
                provider: .claudeAgent,
                state: .unknown,
                isAvailable: false,
                message: detail.map { "Il programma `claude` è installato ma non si avvia. \($0)" }
                    ?? "Il programma `claude` è installato ma non si avvia.",
                checkedAt: checkedAt
            )
        }
        let version = ClaudeCLIVersion.parse("\(versionResult.stdout)\n\(versionResult.stderr)")

        var authResult = await runAuthStatus()
        var parsed = ClaudeAuthStatusParser.parse(authResult)
        let credentials = credentialsReader()

        // A structured false negative without a local credential record to rescue it is the
        // signature of a lost refresh-token rotation race. Re-probe once after it settles.
        if !credentials.isUsable, ClaudeAuthStatusParser.isStructuredFalseNegative(authResult, parsed) {
            if falseNegativeRetryDelay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(falseNegativeRetryDelay * 1_000_000_000))
            }
            authResult = await runAuthStatus()
            parsed = ClaudeAuthStatusParser.parse(authResult)
        }

        let structuredFalseNegative = ClaudeAuthStatusParser.isStructuredFalseNegative(authResult, parsed)
        var subscriptionType = ClaudeAuthStatusParser.subscriptionType(from: authResult)
        var authMethod = ClaudeAuthStatusParser.authMethod(from: authResult)
        var effective = parsed

        // The credential file proves a login the command failed to see; the runtime probe proves it
        // is still live. No model call is made: only the initialize control request.
        if credentials.isUsable, structuredFalseNegative {
            if case let .authenticated(probedSubscription) = await probeRuntime() {
                effective = ClaudeAuthVerdict(status: .ready, authStatus: .authenticated)
                subscriptionType = subscriptionType ?? probedSubscription ?? credentials.subscriptionType
                authMethod = authMethod ?? "claude.ai"
            }
        }
        if subscriptionType == nil, effective.authStatus == .authenticated {
            if case let .authenticated(probedSubscription) = await probeRuntime() {
                subscriptionType = probedSubscription
                authMethod = authMethod ?? "claude.ai"
            }
        }

        let metadata = ClaudeAuthMetadata.metadata(subscriptionType: subscriptionType, authMethod: authMethod)
        return ProviderAccessStatus(
            provider: .claudeAgent,
            state: effective.authStatus,
            isAvailable: true,
            authType: metadata?.type,
            authLabel: metadata?.label,
            version: version,
            message: effective.message,
            checkedAt: checkedAt
        )
    }

    private func runAuthStatus() async -> ClaudeCommandResult {
        await lock.withLock { [self] in
            await commandRunner(binaryURL, ["auth", "status"], environment, timeout)
        }
    }

    private func probeRuntime() async -> ClaudeRuntimeProbe.Outcome {
        let options = ClaudeSessionOptions(
            binaryURL: binaryURL,
            workingDirectory: home,
            permissionMode: .default,
            includePartialMessages: false,
            environment: environment
        )
        return await runtimeProbe(options)
    }
}
