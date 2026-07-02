// Extract the DARK frame of a macOS dynamic wallpaper .heic (it embeds a light
// + dark image) and write it downscaled to a PNG. Salem is always in dark mode,
// so the darkest frame is what the desktop actually shows.
// Usage: swift extract_dark.swift <input.heic> <output.png>
import Foundation
import ImageIO
import CoreGraphics
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else { exit(1) }
guard let s = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil) else { exit(1) }
let n = CGImageSourceGetCount(s)

func luma(_ img: CGImage) -> Double {
    let cs = CGColorSpaceCreateDeviceRGB()
    var px = [UInt8](repeating: 0, count: 4)
    guard let c = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8,
                            bytesPerRow: 4, space: cs,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 1e9 }
    c.interpolationQuality = .high
    c.draw(img, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    return 0.299*Double(px[0]) + 0.587*Double(px[1]) + 0.114*Double(px[2])
}

var best: CGImage? = nil
var bestL = 1e9
for i in 0..<n {
    if let img = CGImageSourceCreateImageAtIndex(s, i, nil) {
        let l = luma(img)
        if l < bestL { bestL = l; best = img }
    }
}
guard let img = best else { exit(1) }

let scale = 1600.0 / Double(img.width)
let w = Int(Double(img.width) * scale), h = Int(Double(img.height) * scale)
let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                          bytesPerRow: 0, space: cs,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
ctx.interpolationQuality = .high
ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
guard let out = ctx.makeImage() else { exit(1) }
let rep = NSBitmapImageRep(cgImage: out)
if let d = rep.representation(using: .png, properties: [:]) {
    try? d.write(to: URL(fileURLWithPath: args[2]))
} else { exit(1) }
