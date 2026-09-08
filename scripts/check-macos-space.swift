// Run while another app is full screen; pass Electron to check pnpm dev.
// Read-only WindowServer check. No screen capture or permission request.
import CoreGraphics
import Foundation
let owner = CommandLine.arguments.dropFirst().first ?? "T3 Code Notched"
let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
let matches = windows.filter { ($0[kCGWindowOwnerName as String] as? String) == owner && ($0[kCGWindowLayer as String] as? Int) == 25 }
let visible = matches.contains { ($0[kCGWindowIsOnscreen as String] as? Bool) == true }
print("\(owner) on current Space: \(visible)")
exit(visible ? 0 : 1)
