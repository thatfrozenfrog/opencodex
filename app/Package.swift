// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenCodexDesktopNative",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "NativeTray", type: .static, targets: ["NativeTray"]),
        .executable(name: "NativeTrayTests", targets: ["NativeTrayTests"]),
    ],
    targets: [
        .target(name: "NativeTray", path: "Sources/NativeTray"),
        .executableTarget(name: "NativeTrayTests", dependencies: ["NativeTray"], path: "Sources/NativeTrayTests"),
    ],
    swiftLanguageVersions: [.v5]
)
