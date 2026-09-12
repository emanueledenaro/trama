import Darwin
import Dispatch
import Foundation

@main
struct TramaMonitorMain {
    static func main() async {
        let signals = TerminationSignals()
        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await BackgroundMonitorProcess().run()
            }
            group.addTask {
                await signals.wait()
            }
            _ = await group.next()
            group.cancelAll()
        }
    }
}

private final class TerminationSignals: @unchecked Sendable {
    private let stream: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation
    private let sources: [DispatchSourceSignal]

    init() {
        var continuation: AsyncStream<Void>.Continuation!
        stream = AsyncStream { continuation = $0 }
        self.continuation = continuation

        Darwin.signal(SIGTERM, SIG_IGN)
        Darwin.signal(SIGINT, SIG_IGN)
        sources = [SIGTERM, SIGINT].map { signalNumber in
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .global(qos: .utility))
            source.setEventHandler { continuation.yield(()) }
            source.resume()
            return source
        }
    }

    func wait() async {
        for await _ in stream {
            return
        }
    }

    deinit {
        sources.forEach { $0.cancel() }
        continuation.finish()
    }
}
