#!/usr/bin/env swift

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

private struct RasterFrame {
    let width: Int
    let height: Int
    var pixels: [UInt8]

    var visibleBounds: CGRect {
        var minX = width
        var minY = height
        var maxX = -1
        var maxY = -1

        for y in 0..<height {
            for x in 0..<width {
                if pixels[(y * width + x) * 4 + 3] > 12 {
                    minX = min(minX, x)
                    minY = min(minY, y)
                    maxX = max(maxX, x)
                    maxY = max(maxY, y)
                }
            }
        }

        guard maxX >= minX, maxY >= minY else { return .zero }
        return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    func cropped(to rect: CGRect) -> RasterFrame {
        let x0 = Int(rect.minX)
        let y0 = Int(rect.minY)
        let outputWidth = Int(rect.width)
        let outputHeight = Int(rect.height)
        var output = [UInt8](repeating: 0, count: outputWidth * outputHeight * 4)

        for y in 0..<outputHeight {
            let sourceStart = ((y0 + y) * width + x0) * 4
            let outputStart = y * outputWidth * 4
            output.replaceSubrange(
                outputStart..<(outputStart + outputWidth * 4),
                with: pixels[sourceStart..<(sourceStart + outputWidth * 4)]
            )
        }
        return RasterFrame(width: outputWidth, height: outputHeight, pixels: output)
    }

    func cgImage() throws -> CGImage {
        let data = Data(pixels) as CFData
        guard let provider = CGDataProvider(data: data),
              let image = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(
                    rawValue: CGImageAlphaInfo.premultipliedLast.rawValue
                        | CGBitmapInfo.byteOrder32Big.rawValue
                ),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ) else {
            throw BuildError("Could not create a frame image.")
        }
        return image
    }
}

private struct BuildError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

private func decode(_ url: URL) throws -> RasterFrame {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw BuildError("Could not read \(url.path).")
    }

    let width = image.width
    let height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo(
        rawValue: CGImageAlphaInfo.premultipliedLast.rawValue
            | CGBitmapInfo.byteOrder32Big.rawValue
    )

    let created = pixels.withUnsafeMutableBytes { bytes -> Bool in
        guard let context = CGContext(
            data: bytes.baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        ) else { return false }
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard created else { throw BuildError("Could not decode \(url.path).") }
    return RasterFrame(width: width, height: height, pixels: pixels)
}

private func removeSmallComponents(from frame: inout RasterFrame) {
    let pixelCount = frame.width * frame.height
    let minimumSize = max(64, pixelCount / 4_000)
    var visited = [Bool](repeating: false, count: pixelCount)
    let neighborOffsets = [
        (-1, -1), (0, -1), (1, -1),
        (-1, 0),            (1, 0),
        (-1, 1),  (0, 1),   (1, 1)
    ]

    for start in 0..<pixelCount where !visited[start] {
        visited[start] = true
        guard frame.pixels[start * 4 + 3] > 12 else { continue }
        var component = [start]
        var cursor = 0

        while cursor < component.count {
            let current = component[cursor]
            cursor += 1
            let x = current % frame.width
            let y = current / frame.width

            for (dx, dy) in neighborOffsets {
                let nextX = x + dx
                let nextY = y + dy
                guard nextX >= 0, nextX < frame.width, nextY >= 0, nextY < frame.height else {
                    continue
                }
                let next = nextY * frame.width + nextX
                guard !visited[next] else { continue }
                visited[next] = true
                if frame.pixels[next * 4 + 3] > 12 { component.append(next) }
            }
        }

        guard component.count < minimumSize else { continue }
        for pixel in component {
            let offset = pixel * 4
            frame.pixels[offset] = 0
            frame.pixels[offset + 1] = 0
            frame.pixels[offset + 2] = 0
            frame.pixels[offset + 3] = 0
        }
    }
}

private func splitAndKey(_ sheet: RasterFrame, columnCount: Int, rowCount: Int) -> [RasterFrame] {
    let cellWidth = sheet.width / columnCount
    let cellHeight = sheet.height / rowCount
    let columns = (0..<columnCount).map { column in (column * cellWidth, cellWidth) }
    // Core Graphics exposes decoded pixel rows bottom-up. Read the visual top row first.
    let rows = (0..<rowCount).map { visualRow in
        ((rowCount - visualRow - 1) * cellHeight, cellHeight)
    }

    return rows.flatMap { y, height in
        columns.map { x, width in
            let inset = 12
            guard width > inset * 2, height > inset * 2 else {
                return RasterFrame(width: 1, height: 1, pixels: [0, 0, 0, 0])
            }
            var frame = sheet.cropped(to: CGRect(
                x: x + inset,
                y: y + inset,
                width: width - inset * 2,
                height: height - inset * 2
            ))
            for index in stride(from: 0, to: frame.pixels.count, by: 4) {
                let red = Double(frame.pixels[index])
                let green = Double(frame.pixels[index + 1])
                let blue = Double(frame.pixels[index + 2])
                let excess = green - max(red, blue)
                let saturationFloor = green - min(red, blue)
                let isChroma = (green > 170 && excess > 25)
                    || (green > 100 && saturationFloor > 80)

                guard isChroma else {
                    frame.pixels[index + 3] = 255
                    continue
                }

                let opacity = max(red, blue, 255 - green) / 255
                if opacity < 0.45 {
                    frame.pixels[index] = 0
                    frame.pixels[index + 1] = 0
                    frame.pixels[index + 2] = 0
                    frame.pixels[index + 3] = 0
                    continue
                }
                let alpha = UInt8((opacity * 255).rounded())
                if alpha == 0 {
                    frame.pixels[index] = 0
                    frame.pixels[index + 1] = 0
                    frame.pixels[index + 2] = 0
                    frame.pixels[index + 3] = 0
                    continue
                }

                // Remove the green-screen contribution while keeping RGB premultiplied by alpha.
                frame.pixels[index] = UInt8(min(red, Double(alpha)).rounded())
                frame.pixels[index + 1] = UInt8(
                    max(0, min(Double(alpha), green - Double(255 - alpha))).rounded()
                )
                frame.pixels[index + 2] = UInt8(min(blue, Double(alpha)).rounded())
                frame.pixels[index + 3] = alpha
            }
            removeSmallComponents(from: &frame)
            return frame
        }
    }
}

private func renderRegistered(_ frames: [RasterFrame], size: Int = 256, margin: Int = 10) throws -> [CGImage] {
    let bounds = frames.map(\.visibleBounds)
    guard bounds.allSatisfy({ !$0.isEmpty }) else {
        throw BuildError("At least one sprite quadrant contains no visible subject.")
    }
    guard let first = frames.first,
          frames.allSatisfy({ $0.width == first.width && $0.height == first.height }) else {
        throw BuildError("Sprite cells must have identical dimensions for stable registration.")
    }
    let subjectBounds = bounds.dropFirst().reduce(bounds[0]) { $0.union($1) }
    let registrationPadding = max(4, min(first.width, first.height) / 40)
    let registeredBounds = CGRect(
        x: max(0, Int(subjectBounds.minX) - registrationPadding),
        y: max(0, Int(subjectBounds.minY) - registrationPadding),
        width: min(first.width, Int(subjectBounds.maxX) + registrationPadding)
            - max(0, Int(subjectBounds.minX) - registrationPadding),
        height: min(first.height, Int(subjectBounds.maxY) + registrationPadding)
            - max(0, Int(subjectBounds.minY) - registrationPadding)
    )
    let scale = min(
        CGFloat(size - margin * 2) / registeredBounds.width,
        CGFloat(size - margin * 2) / registeredBounds.height
    )
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo(
        rawValue: CGImageAlphaInfo.premultipliedLast.rawValue
            | CGBitmapInfo.byteOrder32Big.rawValue
    )

    return try frames.map { frame in
        let registeredFrame = frame.cropped(to: registeredBounds)
        let source = try registeredFrame.cgImage()
        var pixels = [UInt8](repeating: 0, count: size * size * 4)
        let created = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(
                data: bytes.baseAddress,
                width: size,
                height: size,
                bitsPerComponent: 8,
                bytesPerRow: size * 4,
                space: colorSpace,
                bitmapInfo: bitmapInfo.rawValue
            ) else { return false }
            context.translateBy(x: 0, y: CGFloat(size))
            context.scaleBy(x: 1, y: -1)
            context.interpolationQuality = .high
            let drawWidth = CGFloat(registeredFrame.width) * scale
            let drawHeight = CGFloat(registeredFrame.height) * scale
            let x = (CGFloat(size) - drawWidth) / 2
            let y = (CGFloat(size) - drawHeight) / 2
            context.draw(source, in: CGRect(x: x, y: y, width: drawWidth, height: drawHeight))
            return true
        }
        guard created else { throw BuildError("Could not render a registered frame.") }
        return try RasterFrame(width: size, height: size, pixels: pixels).cgImage()
    }
}

private func writeGIF(_ frames: [CGImage], to url: URL, delay: Double, mode: String) throws {
    let sequence: [Int]
    switch mode {
    case "forward":
        sequence = Array(frames.indices)
    case "pingpong":
        sequence = Array(frames.indices)
            + Array(frames.indices.dropFirst().dropLast().reversed())
    default:
        throw BuildError("Loop mode must be 'forward' or 'pingpong'.")
    }
    guard !frames.isEmpty,
          let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.gif.identifier as CFString,
            sequence.count,
            nil
          ) else {
        throw BuildError("Could not create \(url.path).")
    }

    let containerProperties = [
        kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
    ] as CFDictionary
    let frameProperties = [
        kCGImagePropertyGIFDictionary: [
            kCGImagePropertyGIFDelayTime: delay,
            kCGImagePropertyGIFUnclampedDelayTime: delay
        ]
    ] as CFDictionary

    CGImageDestinationSetProperties(destination, containerProperties)
    for index in sequence {
        CGImageDestinationAddImage(destination, frames[index], frameProperties)
    }
    guard CGImageDestinationFinalize(destination) else {
        throw BuildError("Could not finalize \(url.path).")
    }
}

private func main() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard (2...6).contains(arguments.count) else {
        throw BuildError(
            "Usage: build-companion-gif.swift INPUT_SHEET OUTPUT_GIF "
                + "[FRAME_DELAY_SECONDS] [COLUMNS] [ROWS] [forward|pingpong]"
        )
    }

    let inputURL = URL(fileURLWithPath: arguments[0])
    let outputURL = URL(fileURLWithPath: arguments[1])
    let delay = arguments.count >= 3 ? Double(arguments[2]) ?? 0.2 : 0.2
    let columnCount = arguments.count >= 4 ? Int(arguments[3]) ?? 2 : 2
    let rowCount = arguments.count >= 5 ? Int(arguments[4]) ?? 2 : 2
    let mode = arguments.count >= 6 ? arguments[5] : "pingpong"
    guard delay > 0, columnCount > 0, rowCount > 0 else {
        throw BuildError("Frame delay, columns, and rows must be positive.")
    }
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )

    let sheet = try decode(inputURL)
    let keyedFrames = splitAndKey(sheet, columnCount: columnCount, rowCount: rowCount)
    let renderedFrames = try renderRegistered(keyedFrames)
    try writeGIF(renderedFrames, to: outputURL, delay: delay, mode: mode)
    print(outputURL.path)
}

do {
    try main()
} catch {
    FileHandle.standardError.write(Data("error: \(error.localizedDescription)\n".utf8))
    exit(1)
}
