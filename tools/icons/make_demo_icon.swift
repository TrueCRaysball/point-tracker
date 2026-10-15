// Draws the demo app icon: the castle app icon with an amber "DEMO" badge over the castle.
// macOS only (uses AppKit). Run from the repo root after make_castle_icon.swift: swift tools/icons/make_demo_icon.swift
// Then: npx tauri icon assets/castle-app-icon-demo.png -o src-tauri/icons-demo
import AppKit

let size: CGFloat = 1024
let base = NSImage(contentsOfFile: "assets/castle-app-icon.png")!
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
base.draw(in: NSRect(x: 0, y: 0, width: size, height: size))

// Badge across the lower middle of the castle, slightly tilted like a stamp.
let badge = NSRect(x: 222, y: 330, width: 580, height: 190)
let ctx = NSGraphicsContext.current!.cgContext
ctx.saveGState()
ctx.translateBy(x: badge.midX, y: badge.midY)
ctx.rotate(by: -8 * .pi / 180)
ctx.translateBy(x: -badge.midX, y: -badge.midY)

let shape = NSBezierPath(roundedRect: badge, xRadius: 42, yRadius: 42)
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.55)
shadow.shadowOffset = NSSize(width: 0, height: -8)
shadow.shadowBlurRadius = 22
shadow.set()
NSColor(red: 0.98, green: 0.72, blue: 0.20, alpha: 1).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()
NSColor(red: 1, green: 0.86, blue: 0.5, alpha: 1).setStroke()
shape.lineWidth = 8
shape.stroke()

let font = NSFont.systemFont(ofSize: 150, weight: .black)
let text = NSAttributedString(string: "DEMO", attributes: [
    .font: font,
    .foregroundColor: NSColor(red: 0.03, green: 0.09, blue: 0.22, alpha: 1),
    .kern: 10,
])
let ts = text.size()
text.draw(at: NSPoint(x: badge.midX - ts.width / 2 + 5, y: badge.midY - ts.height / 2 + 4))
ctx.restoreGState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "assets/castle-app-icon-demo.png"))
print("Wrote assets/castle-app-icon-demo.png")
