// Draws a full-bleed square version of the castle icon (no rounded corners or margin) for phones,
// which round the corners themselves. Writes assets/castle-icon-square.png (1024×1024).
// macOS only (uses AppKit). Run from the repo root: swift tools/icons/make_square_icon.swift
import AppKit

let size: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let full = NSRect(x: 0, y: 0, width: size, height: size)
NSGradient(colors: [NSColor(red: 0.03, green: 0.11, blue: 0.27, alpha: 1),
                    NSColor(red: 0.005, green: 0.025, blue: 0.08, alpha: 1)])!.draw(in: full, angle: -90)
NSGradient(colors: [NSColor(red: 0.15, green: 0.5, blue: 1, alpha: 0.45), NSColor(red: 0.15, green: 0.5, blue: 1, alpha: 0)])!
    .draw(fromCenter: NSPoint(x: 512, y: 500), radius: 0, toCenter: NSPoint(x: 512, y: 500), radius: 460, options: [])
let castle = NSImage(contentsOfFile: "assets/castle-icon.png")!
let crop = NSRect(x: 230, y: 30, width: 1076, height: 994)
// Keep the castle inside the central safe zone so "maskable" crops (circles) don't clip it.
let h: CGFloat = 640, w = h * crop.width / crop.height
let r = NSRect(x: (size - w) / 2, y: 175, width: w, height: h)
castle.draw(in: r, from: crop, operation: .sourceOver, fraction: 1)
castle.draw(in: r, from: crop, operation: .plusLighter, fraction: 0.35)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "assets/castle-icon-square.png"))
print("Wrote assets/castle-icon-square.png")
