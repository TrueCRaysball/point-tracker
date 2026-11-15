// Draws every app icon from the Point Tracker logo (assets/logo.png, the "P" with transparent background):
//   assets/app-icon.png         1024×1024, rounded tile on the macOS icon grid (desktop apps)
//   assets/app-icon-demo.png    the same with an amber "DEMO" stamp (demo apps)
//   assets/app-icon-square.png  full-bleed square for phones, which round the corners themselves;
//                               the logo stays inside the central safe zone so circle crops don't clip it
// macOS only (uses AppKit). Run from the repo root:
//   swift tools/icons/make_icons.swift
//   npx tauri icon assets/app-icon.png -o src-tauri/icons
//   npx tauri icon assets/app-icon-demo.png -o src-tauri/icons-demo
//   sh tools/icons/web_icons.sh
import AppKit

let size: CGFloat = 1024
let logo = NSImage(contentsOfFile: "assets/logo.png")!
let logoAspect = logo.size.width / logo.size.height

// The header's colors: deep navy into blue, with a soft cyan glow behind the logo.
let navy = NSColor(red: 0x06 / 255, green: 0x17 / 255, blue: 0x2E / 255, alpha: 1)
let blue = NSColor(red: 0x00 / 255, green: 0x3E / 255, blue: 0x82 / 255, alpha: 1)
let glow = NSColor(red: 0x00 / 255, green: 0xCF / 255, blue: 1, alpha: 1)

func canvas(_ draw: () -> Void) -> NSBitmapImageRep {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  draw()
  NSGraphicsContext.restoreGraphicsState()
  return rep
}
func save(_ rep: NSBitmapImageRep, _ path: String) {
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
  print("Wrote \(path)")
}
/// Background, glow and logo inside `area` (already clipped by the caller).
func art(in area: NSRect, logoWidth: CGFloat) {
  NSGradient(colors: [navy, blue])!.draw(in: area, angle: -55)
  let c = NSPoint(x: area.midX, y: area.midY)
  NSGradient(colors: [glow.withAlphaComponent(0.42), glow.withAlphaComponent(0)])!
    .draw(fromCenter: c, radius: 0, toCenter: c, radius: area.width * 0.48, options: [])
  let lh = logoWidth / logoAspect
  logo.draw(in: NSRect(x: c.x - logoWidth / 2 + logoWidth * 0.02, y: c.y - lh / 2, width: logoWidth, height: lh))
}

// Desktop: 824pt rounded square centered in 1024, with a drop shadow.
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let tileShape = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
let icon = canvas {
  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow()
  shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
  shadow.shadowOffset = NSSize(width: 0, height: -10)
  shadow.shadowBlurRadius = 24
  shadow.set()
  NSColor.black.setFill()
  tileShape.fill()
  NSGraphicsContext.restoreGraphicsState()
  NSGraphicsContext.saveGraphicsState()
  tileShape.addClip()
  art(in: tile, logoWidth: 640)
  // Subtle highlight across the top half.
  NSGradient(colors: [NSColor.white.withAlphaComponent(0.10), NSColor.white.withAlphaComponent(0)])!
    .draw(in: NSRect(x: tile.minX, y: tile.midY, width: tile.width, height: tile.height / 2), angle: -90)
  NSGraphicsContext.restoreGraphicsState()
}
save(icon, "assets/app-icon.png")

// Demo: an amber "DEMO" stamp across the lower part of the logo, slightly tilted.
let demo = canvas {
  NSImage(data: icon.representation(using: .png, properties: [:])!)!.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
  let badge = NSRect(x: 222, y: 210, width: 580, height: 190)
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
  let text = NSAttributedString(string: "DEMO", attributes: [
    .font: NSFont.systemFont(ofSize: 150, weight: .black),
    .foregroundColor: NSColor(red: 0.03, green: 0.09, blue: 0.22, alpha: 1),
    .kern: 10,
  ])
  let ts = text.size()
  text.draw(at: NSPoint(x: badge.midX - ts.width / 2 + 5, y: badge.midY - ts.height / 2 + 4))
  ctx.restoreGState()
}
save(demo, "assets/app-icon-demo.png")

// Phones: full bleed, logo kept within the inner ~70% so round masks don't cut it.
let square = canvas { art(in: NSRect(x: 0, y: 0, width: size, height: size), logoWidth: 600) }
save(square, "assets/app-icon-square.png")
