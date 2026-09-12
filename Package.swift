// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Trama",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Trama", targets: ["Trama"]),
        .executable(name: "TramaMonitor", targets: ["TramaMonitor"]),
        .library(name: "TramaCore", targets: ["TramaCore"])
    ],
    targets: [
        .target(name: "TramaCore"),
        .executableTarget(name: "TramaMonitor", dependencies: ["TramaCore"]),
        .executableTarget(name: "Trama", dependencies: ["TramaCore"], resources: [.copy("Resources/DemoProject"), .copy("Resources/AIHero")]),
        .testTarget(name: "TramaCoreTests", dependencies: ["TramaCore"])
    ],
    swiftLanguageModes: [.v5]
)
