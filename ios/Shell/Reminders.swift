import Foundation
import UserNotifications

/// One reminder the page hands over (lib/shell.ts `RemindersMessage`, version 1).
struct Reminder {
    let id: String
    let at: Date
    let title: String
    let body: String
    let url: String

    /// Reads the body of a script message; nil for anything that is not a version 1 list.
    static func message(_ body: Any) -> (items: [Reminder], expiry: Bool)? {
        guard let fields = body as? [String: Any], (fields["v"] as? Int) == 1 else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        let items = (fields["items"] as? [[String: Any]] ?? []).compactMap { item -> Reminder? in
            guard let id = item["id"] as? String,
                  let at = item["at"] as? String,
                  let date = fractional.date(from: at) ?? plain.date(from: at),
                  let title = item["title"] as? String,
                  let body = item["body"] as? String
            else { return nil }
            return Reminder(id: id, at: date, title: title, body: body, url: item["url"] as? String ?? "/")
        }
        return (items, fields["expiry"] as? Bool ?? true)
    }
}

/// The notifications the phone schedules for itself (PRD Section 5, step 8): a free-signed app gets
/// no push, so what can be known ahead is scheduled here, from the list the page hands over
/// (lib/models/local-reminders.ts), plus the evening before this build runs out, which only the app
/// itself knows. Every one of ours carries the prefix, so a new list replaces the old one whole.
enum Reminders {
    static let prefix = "longview."

    struct Status {
        let allowed: Bool
        let scheduled: Int
        let expires: Date?
    }

    /// When this build runs out: the date in the provisioning profile Xcode signed it with (none in the simulator).
    static let expiry: Date? = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), format: nil) as? [String: Any]
        else { return nil }
        return plist["ExpirationDate"] as? Date
    }()

    /// 20:00 on the evening before the build runs out; nil once that has passed.
    static func reinstallTime(_ expiry: Date, now: Date = Date()) -> Date? {
        let calendar = Calendar.current
        guard let dayBefore = calendar.date(byAdding: .day, value: -1, to: expiry),
              let evening = calendar.date(bySettingHour: 20, minute: 0, second: 0, of: dayBefore)
        else { return nil }
        return evening > now ? evening : nil
    }

    /// Asks once whether notifications may show (iOS remembers the answer), then puts `items`, and
    /// the reinstall reminder when `expiryWanted`, in place of everything of ours scheduled before.
    static func schedule(_ items: [Reminder], expiryWanted: Bool) async -> Status {
        let center = UNUserNotificationCenter.current()
        var settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            settings = await center.notificationSettings()
        }
        let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
        let ours = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: ours)
        guard allowed else { return Status(allowed: false, scheduled: 0, expires: expiry) }

        var requests = items.compactMap { request(id: $0.id, at: $0.at, title: $0.title, body: $0.body, url: $0.url) }
        if expiryWanted, let expiry = expiry, let at = reinstallTime(expiry) {
            let clock = DateFormatter()
            clock.dateFormat = "M/d HH:mm"
            if let reinstall = request(id: "reinstall", at: at, title: "長期投資明天到期", body: "\(clock.string(from: expiry)) 起打不開：接上 Mac，執行重新安裝。", url: nil) {
                requests.append(reinstall)
            }
        }
        var scheduled = 0
        for request in requests {
            do {
                try await center.add(request)
                scheduled += 1
            } catch {
                // One that iOS refuses does not hold back the rest.
            }
        }
        return Status(allowed: true, scheduled: scheduled, expires: expiry)
    }

    private static func request(id: String, at: Date, title: String, body: String, url: String?) -> UNNotificationRequest? {
        let wait = at.timeIntervalSinceNow
        guard wait > 5 else { return nil }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let url = url { content.userInfo = ["url": url] }
        return UNNotificationRequest(identifier: prefix + id, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false))
    }
}

/// Where a tapped reminder or a `longview://open?path=…` address goes: a page of the site, opened in
/// the web view once it is there (ShellViewController picks up what came before it).
@MainActor
enum Router {
    static weak var shell: ShellViewController?
    /// A page asked for before the web view was ready.
    static var pending: String?

    /// A page of the site: a path that starts with one slash (lib/shell.ts `sitePath`).
    static func sitePath(_ raw: String?) -> String? {
        guard let raw = raw, raw.hasPrefix("/"), !raw.hasPrefix("//"), !raw.contains("\\") else { return nil }
        return raw
    }

    static func open(_ raw: String?) {
        guard let path = sitePath(raw) else { return }
        if let shell = shell { shell.open(path: path) } else { pending = path }
    }

    /// `longview://open?path=%2Fvolatility` (lib/shell.ts `shellOpenUrl`); any other address is ignored.
    static func handle(_ url: URL) {
        guard url.scheme == "longview", url.host == "open",
              let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value
        else { return }
        open(path)
    }
}
