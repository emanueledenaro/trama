// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DemoProject",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "Users", targets: ["Users"]),
        .library(name: "Catalog", targets: ["Catalog"]),
        .library(name: "Payments", targets: ["Payments"]),
        .library(name: "Inventory", targets: ["Inventory"]),
        .library(name: "Orders", targets: ["Orders"])
    ],
    targets: [
        .target(name: "Users"),
        .target(name: "Catalog"),
        .target(name: "Payments"),
        .target(name: "Inventory"),
        .target(name: "Orders", dependencies: ["Users", "Catalog", "Payments"]),
        .testTarget(name: "OrdersTests", dependencies: ["Users", "Catalog", "Payments", "Inventory", "Orders"])
    ]
)
