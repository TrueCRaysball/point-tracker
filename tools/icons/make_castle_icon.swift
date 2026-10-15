// Draws the app icon from the castle artwork and writes assets/castle-app-icon.png (1024×1024).
// macOS only (uses AppKit). Run from the repo root: swift tools/icons/make_castle_icon.swift
// Then: npx tauri icon assets/castle-app-icon.png -o src-tauri/icons
import AppKit

let size: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// macOS icon grid: 824pt rounded square centered in 1024.
let rect = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: rect, xRadius: 185, yRadius: 185)

NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
shadow.shadowOffset = NSSize(width: 0, height: -10)
shadow.shadowBlurRadius = 24
shadow.set()
NSColor.black.setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()

// Night-sky gradient matching the dark header.
NSGradient(colors: [NSColor(red: 0.03, green: 0.11, blue: 0.27, alpha: 1),
                    NSColor(red: 0.005, green: 0.025, blue: 0.08, alpha: 1)])!
    .draw(in: shape, angle: -90)

NSGraphicsContext.saveGraphicsState()
shape.addClip()
// Soft glow behind the castle.
NSGradient(colors: [NSColor(red: 0.15, green: 0.5, blue: 1, alpha: 0.45), NSColor(red: 0.15, green: 0.5, blue: 1, alpha: 0)])!
    .draw(fromCenter: NSPoint(x: 512, y: 500), radius: 0, toCenter: NSPoint(x: 512, y: 500), radius: 380, options: [])
// The castle (with its own glow), trimmed of empty space and fitted into the square.
let castle = NSImage(contentsOfFile: "assets/castle-icon.png")!
let crop = NSRect(x: 230, y: 30, width: 1076, height: 994) // castle plus glow, in image points (bottom-left origin)
let h: CGFloat = 660, w = h * crop.width / crop.height
let castleRect = NSRect(x: (size - w) / 2, y: 175, width: w, height: h)
castle.draw(in: castleRect, from: crop, operation: .sourceOver, fraction: 1)
// Draw again with "plus lighter" to brighten the castle so it glows against the night sky.
castle.draw(in: castleRect, from: crop, operation: .plusLighter, fraction: 0.35)
// Subtle top highlight.
NSGradient(colors: [NSColor.white.withAlphaComponent(0.10), NSColor.white.withAlphaComponent(0)])!
    .draw(in: NSRect(x: rect.minX, y: rect.midY, width: rect.width, height: rect.height / 2), angle: -90)
NSGraphicsContext.restoreGraphicsState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "assets/castle-app-icon.png"))
print("Wrote assets/castle-app-icon.png")
