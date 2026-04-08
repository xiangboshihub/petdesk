// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "PetClawCatTyper",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "PetClawCatTyper",
            targets: ["PetClawCatTyper"]
        )
    ],
    targets: [
        .executableTarget(
            name: "PetClawCatTyper",
            resources: [
                .copy("../../Resources")
            ]
        )
    ]
)
