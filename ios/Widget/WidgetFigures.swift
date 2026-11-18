import CryptoKit
import Foundation

/// The widget's figures as /shell/widget answers them (lib/widget-api.ts `WidgetReplyFigures`): the
/// portfolio's value at the last close (both pools), the dashboard poster's 7-day change and its line.
struct Figures: Codable, Hashable {
    let asOf: String
    let totalTwd: Double
    let weekChange: Double?
    let points: [Double]
    let redUp: Bool
    let stale: Bool

    /// What the widget gallery and a placeholder show: invented, never anyone's figures.
    static let demo = Figures(asOf: "2026-11-17", totalTwd: 1_234_567, weekChange: 0.0123,
                              points: [0, 0.01, 0.006, 0.02, 0.031, 0.025, 0.04, 0.052, 0.047, 0.061], redUp: true, stale: false)

    /// The same, after a falling week: the look test shows the green glow with it.
    static let demoFall = Figures(asOf: "2026-11-17", totalTwd: 1_224_180, weekChange: -0.0084,
                                  points: [0, 0.012, 0.03, 0.026, 0.041, 0.035, 0.028, 0.022, 0.019, 0.014], redUp: true, stale: false)
}

/// What the widget shows.
enum WidgetState: Hashable {
    /// The figures; `offline` when the site could not be reached and these are the last ones drawn.
    case figures(Figures, offline: Bool)
    /// The key is right, but nothing has been saved yet (before the first nightly run).
    case empty
    /// No key pasted into the widget yet.
    case noKey
    /// The key was replaced or is wrong.
    case badKey
    /// The site could not be reached and nothing was drawn before.
    case unreachable
}

private struct Reply: Decodable {
    let figures: Figures?
}

/// Asks the site for the figures with the widget's own key (no App Group under free signing: the
/// key lives in the widget's configuration), and keeps the last answer in the widget's own storage.
enum FiguresSource {
    /// https://<SiteHost>/shell/widget, the host from ios/Local.xcconfig as the app reads it.
    static var endpoint: URL? {
        guard let host = (Bundle.main.object(forInfoDictionaryKey: "SiteHost") as? String)?.trimmingCharacters(in: .whitespaces),
              !host.isEmpty
        else { return nil }
        let scheme = host.hasPrefix("localhost") || host.hasPrefix("127.0.0.1") ? "http" : "https"
        return URL(string: "\(scheme)://\(host)/shell/widget")
    }

    static func state(for raw: String?) async -> WidgetState {
        let key = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !key.isEmpty else { return .noKey }
        guard let url = endpoint else { return .unreachable }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        if let (data, response) = try? await URLSession.shared.data(for: request),
           let status = (response as? HTTPURLResponse)?.statusCode {
            if status == 401 { return .badKey }
            if status == 200, let reply = try? JSONDecoder().decode(Reply.self, from: data) {
                guard let figures = reply.figures else { return .empty }
                remember(figures, for: key)
                return .figures(figures, offline: false)
            }
        }
        if let last = recall(for: key) { return .figures(last, offline: true) }
        return .unreachable
    }

    /// When to ask again: after tonight's nightly job (it starts 22:23 Taipei), or in three hours, whichever comes first.
    static func nextRefresh(after now: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei") ?? .current
        let later = now.addingTimeInterval(3 * 3600)
        let night = calendar.nextDate(after: now, matching: DateComponents(hour: 23, minute: 30), matchingPolicy: .nextTime) ?? later
        return min(night, later)
    }

    // The last figures, under a name made from the key's hash (never the key itself).
    private static func slot(for key: String) -> String {
        let digest = SHA256.hash(data: Data(key.utf8))
        return "figures." + digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    private static func remember(_ figures: Figures, for key: String) {
        guard let data = try? JSONEncoder().encode(figures) else { return }
        UserDefaults.standard.set(data, forKey: slot(for: key))
    }

    private static func recall(for key: String) -> Figures? {
        guard let data = UserDefaults.standard.data(forKey: slot(for: key)) else { return nil }
        return try? JSONDecoder().decode(Figures.self, from: data)
    }
}
