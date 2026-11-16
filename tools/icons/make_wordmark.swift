// Cleans the wordmark (assets/wordmark.png: removes leftover background splatter and specks), crops it, and
// writes the header images: a dark-theme copy as is and a light-theme copy with the white "Point" in navy.
// macOS only (AppKit). Run from the repo root:
//   swift -O tools/icons/make_wordmark.swift assets/wordmark.png src/vendor/wordmark-dark.png src/vendor/wordmark-light.png 140 7
import AppKit
let a = CommandLine.arguments
let img = NSImage(contentsOfFile: a[1])!.cgImage(forProposedRect: nil, context: nil, hints: nil)!
let w = img.width, h = img.height, R = Int(a[5])!
let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w*4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
let p = ctx.data!.bindMemory(to: UInt8.self, capacity: w*h*4)
var m = [UInt8](repeating: 0, count: w*h)
for i in 0..<(w*h) { m[i] = p[i*4+3] > 127 ? 1 : 0 }
func minmax(_ src: [UInt8], _ isMin: Bool) -> [UInt8] {
  var t = src, o = src
  for y in 0..<h { for x in 0..<w { var v: UInt8 = isMin ? 1 : 0
    for dx in -R...R { let xx = x+dx; let s: UInt8 = (xx < 0 || xx >= w) ? 0 : src[y*w+xx]; if isMin { v = min(v, s) } else { v = max(v, s) } }
    t[y*w+x] = v } }
  for y in 0..<h { for x in 0..<w { var v: UInt8 = isMin ? 1 : 0
    for dy in -R...R { let yy = y+dy; let s: UInt8 = (yy < 0 || yy >= h) ? 0 : t[yy*w+x]; if isMin { v = min(v, s) } else { v = max(v, s) } }
    o[y*w+x] = v } }
  return o
}
m = minmax(minmax(m, true), false)
// Drop islands smaller than minArea.
let minArea = 2500
var label = [Int32](repeating: 0, count: w*h); var keep = [Bool](repeating: false, count: 1); var next: Int32 = 1
for i in 0..<(w*h) where m[i] == 1 && label[i] == 0 {
  var stack = [i]; label[i] = next; var area = 0
  while let j = stack.popLast() { area += 1; let x = j % w, y = j / w
    for (nx, ny) in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)] where nx >= 0 && nx < w && ny >= 0 && ny < h {
      let k = ny*w+nx; if m[k] == 1 && label[k] == 0 { label[k] = next; stack.append(k) } } }
  keep.append(area >= minArea); next += 1
}
var minX = w, minY = h, maxX = 0, maxY = 0
for i in 0..<(w*h) {
  if m[i] == 1 && keep[Int(label[i])] { let x = i % w, y = i / w; minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) }
  else { p[i*4] = 0; p[i*4+1] = 0; p[i*4+2] = 0; p[i*4+3] = 0 }
}
let cleaned = ctx.makeImage()!
let pad = 6
let crop = CGRect(x: max(0, minX-pad), y: max(0, minY-pad), width: min(w, maxX-minX+1+2*pad), height: min(h, maxY-minY+1+2*pad))
let cut = cleaned.cropping(to: crop)!
let outH = Int(a[4])!, outW = Int((Double(cut.width)/Double(cut.height)*Double(outH)).rounded())
func save(_ cg: CGImage, _ path: String) { try! NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path)) }
func scaled(_ src: CGImage) -> CGContext {
  let o = CGContext(data: nil, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: outW*4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  o.interpolationQuality = .high; o.draw(src, in: CGRect(x: 0, y: 0, width: outW, height: outH)); return o
}
save(scaled(cut).makeImage()!, a[2])
// Light copy: low-saturation light pixels (the white "Point") become navy #0f1e3d, keeping their alpha.
let lc = scaled(cut); let q = lc.data!.bindMemory(to: UInt8.self, capacity: outW*outH*4)
for i in 0..<(outW*outH) { let al = Int(q[i*4+3]); if al == 0 { continue }
  let r = Int(q[i*4])*255/al, g = Int(q[i*4+1])*255/al, b = Int(q[i*4+2])*255/al
  if min(r, g, b) > 170 && max(r, g, b) - min(r, g, b) < 60 { q[i*4] = UInt8(15*al/255); q[i*4+1] = UInt8(30*al/255); q[i*4+2] = UInt8(61*al/255) } }
save(lc.makeImage()!, a[3])
print("crop \(crop) -> \(outW)x\(outH)")
