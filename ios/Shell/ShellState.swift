import Foundation

/// One tab of the bar, as the page names it (lib/shell.ts): the path of its page, or "more".
struct ShellTab: Equatable {
    let key: String
    let title: String

    static let more = "more"

    /// Shown until the page has sent its own list: the same five, so nothing moves when it does.
    static let fallback: [ShellTab] = [
        ShellTab(key: "/holdings", title: "持倉"),
        ShellTab(key: "/performance", title: "績效"),
        ShellTab(key: "/", title: "儀表板"),
        ShellTab(key: "/allocation", title: "配置"),
        ShellTab(key: more, title: "更多"),
    ]

    /// The tab chosen when the app opens: the dashboard, which the site opens on.
    static let home = "/"

    /// The system symbol for a tab. A tab the page adds later gets a plain mark until one is chosen here.
    var symbol: String {
        switch key {
        case "/holdings": return "list.bullet.rectangle"
        case "/performance": return "chart.line.uptrend.xyaxis"
        case "/": return "house"
        case "/allocation": return "chart.pie"
        case ShellTab.more: return "ellipsis"
        default: return "circle"
        }
    }
}

/// What the page tells the shell each time it changes (lib/shell.ts `ShellState`, version 1).
struct ShellState: Equatable {
    let signedIn: Bool
    let path: String
    /// The tab the page belongs to; nil on a page of none (the bar keeps its choice).
    let tab: String?
    let tabs: [ShellTab]

    /// Reads the body of a script message; nil for anything that is not a version 1 state.
    init?(message body: Any) {
        guard let fields = body as? [String: Any],
              (fields["v"] as? Int) == 1,
              let signedIn = fields["signedIn"] as? Bool,
              let path = fields["path"] as? String
        else { return nil }
        self.signedIn = signedIn
        self.path = path
        self.tab = fields["tab"] as? String
        let listed = (fields["tabs"] as? [[String: Any]] ?? []).compactMap { tab -> ShellTab? in
            guard let key = tab["key"] as? String, let title = tab["title"] as? String else { return nil }
            return ShellTab(key: key, title: title)
        }
        self.tabs = listed.isEmpty ? ShellTab.fallback : listed
    }
}

/// Where the site is: the host named in ios/Local.xcconfig (SITE_HOST), which is not in git.
enum Site {
    /// nil until Local.xcconfig names a host (docs/ios-app.md).
    static let root: URL? = {
        guard let host = (Bundle.main.object(forInfoDictionaryKey: "SiteHost") as? String)?.trimmingCharacters(in: .whitespaces),
              !host.isEmpty
        else { return nil }
        // A local server while developing; the site itself is always HTTPS.
        let scheme = host.hasPrefix("localhost") || host.hasPrefix("127.0.0.1") ? "http" : "https"
        return URL(string: "\(scheme)://\(host)/")
    }()

    /// Whether `url` is a page of the site (same host and port): those stay in the app.
    static func holds(_ url: URL) -> Bool {
        guard let root = root else { return false }
        return url.host == root.host && url.port == root.port && (url.scheme == root.scheme)
    }

    /// The address of a tab's page.
    static func page(_ path: String) -> URL? {
        guard let root = root else { return nil }
        return URL(string: path, relativeTo: root)?.absoluteURL
    }
}
