import AppKit

// Geometry only. No Accessibility permission or interaction with other apps.
let notches: [[String: Any]] = NSScreen.screens.compactMap { screen in
    guard #available(macOS 12.0, *), screen.safeAreaInsets.top > 0,
          let left = screen.auxiliaryTopLeftArea,
          let right = screen.auxiliaryTopRightArea,
          let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    else { return nil }
    return ["id": id.intValue, "width": right.minX - left.maxX,
            "height": screen.safeAreaInsets.top,
            "centerX": (left.maxX + right.minX) / 2 - screen.frame.minX]
}
let data = try JSONSerialization.data(withJSONObject: notches)
FileHandle.standardOutput.write(data)
