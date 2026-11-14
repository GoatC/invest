import UIKit
import WebKit

/// One place in the tab bar. It has no page of its own: the one web view moves into whichever is
/// chosen, so a tab opens from what the page already holds (components/preload.tsx on the web side).
/// Its navigation bar draws the top of the page on screen (proposal G02): the page's title as the
/// large title, which draws in to one line as the page scrolls, the controls the page lends as glass
/// buttons, and a back button on a page reached from inside another.
final class TabHost: UIViewController {
    /// Not `tab`: UIKit has a property of that name on every view controller.
    let place: ShellTab
    /// Called when the room the bars take from this place changes.
    var onInsets: (() -> Void)?
    /// The top last drawn, so the bar is built again only when it changes.
    private var drawn: ShellTop?
    /// White text over the poster's colour (and the launch colour before the page has spoken); the system's own otherwise.
    private var lightStatusBar = true
    /// The page's row of sub-tabs (proposal G03), kept while the row stays the same so a choice slides its lens.
    private var segmented: UISegmentedControl?
    /// Called with the index of the sub-tab chosen in the segmented control.
    var onSegment: ((Int) -> Void)?

    init(tab: ShellTab) {
        self.place = tab
        super.init(nibName: nil, bundle: nil)
        tabBarItem = UITabBarItem(title: tab.title, image: UIImage(systemName: tab.symbol), selectedImage: nil)
        navigationItem.largeTitleDisplayMode = .never
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { lightStatusBar ? .lightContent : .default }

    /// Draws `top` in the navigation bar; `run` answers a button (the page's control, or a sheet), `back`
    /// goes back a page. True when the title changed: a new page.
    @discardableResult
    func draw(_ top: ShellTop?, run: @escaping (ShellAction) -> Void, back: @escaping () -> Void) -> Bool {
        guard top != drawn else { return false }
        let newTitle = top?.title != drawn?.title
        drawn = top
        navigationItem.title = top?.title
        navigationItem.largeTitleDisplayMode = top?.title == nil ? .never : .always
        // The page lists its controls left to right; the bar fills from the right edge in.
        navigationItem.rightBarButtonItems = (top?.actions ?? []).reversed().map { action in
            let item = UIBarButtonItem(image: UIImage(systemName: action.symbol), primaryAction: UIAction { _ in run(action) })
            item.accessibilityLabel = action.label
            return item
        }
        if top?.back == true {
            let item = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), primaryAction: UIAction { _ in back() })
            item.accessibilityLabel = "返回 Back"
            navigationItem.leftBarButtonItem = item
        } else {
            navigationItem.leftBarButtonItem = nil
        }
        drawSegments(top)
        let light = top?.lightStatusBar ?? true
        if light != lightStatusBar {
            lightStatusBar = light
            setNeedsStatusBarAppearanceUpdate()
        }
        return newTitle
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    /// Behind the page: the launch colour until the page has drawn, then the grouped grey of the page's own ground.
    static var ground: UIColor = launchGround

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = TabHost.ground
    }

    /// The row of sub-tabs as iOS's segmented control: under the large title, or in the middle of the
    /// bar on the dashboard, whose poster has none; every sub-tab in one control, Allocation's five too.
    private func drawSegments(_ top: ShellTop?) {
        guard let top = top, top.segments.count > 1 else {
            segmented = nil
            navigationItem.largeSubtitleView = nil
            navigationItem.titleView = nil
            return
        }
        let labels = (0..<(segmented?.numberOfSegments ?? 0)).map { segmented?.titleForSegment(at: $0) ?? "" }
        let control: UISegmentedControl
        if let kept = segmented, labels == top.segments {
            control = kept
        } else {
            control = UISegmentedControl(items: top.segments)
            control.apportionsSegmentWidthsByContent = true
            control.addAction(UIAction { [weak self, weak control] _ in
                guard let index = control?.selectedSegmentIndex, index >= 0 else { return }
                self?.onSegment?(index)
            }, for: .valueChanged)
            segmented = control
        }
        if control.selectedSegmentIndex != top.segment { control.selectedSegmentIndex = top.segment }
        if top.title == nil {
            navigationItem.largeSubtitleView = nil
            navigationItem.titleView = control
        } else {
            navigationItem.titleView = nil
            navigationItem.largeSubtitleView = control
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        onInsets?()
    }
}

/// A place's navigation stack: one page deep, its bar drawing the top of the page with large titles.
/// The status bar's colour is the place's own (white over the poster, the system's elsewhere).
final class PlaceNavigation: UINavigationController {
    init(host: TabHost) {
        super.init(rootViewController: host)
        navigationBar.prefersLargeTitles = true
        tabBarItem = host.tabBarItem
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    override var childForStatusBarStyle: UIViewController? { topViewController }
}

/// The whole app: the system's tab bar (Liquid Glass, drawn by iOS) over one web view showing the
/// site. The page says which tab it belongs to and which tabs there are (lib/shell.ts); a tap on a
/// tab asks the page to open it (components/shell-bridge.tsx).
final class ShellViewController: UITabBarController {
    private var hosts: [TabHost] = []
    /// What the page last said.
    private var state: ShellState?
    /// The last main-frame page asked for, to try again after a failure.
    private var asked: URL?
    /// The room at the foot last told to the page, in points; -1 when a new page has not been told.
    private var saidBottom: CGFloat = -1
    /// The room the navigation bar takes with its large title, last told to the page (--shell-top); -1 when not yet told.
    private var saidTop: CGFloat = -1
    /// Where the thing waiting above the tab bar is done (a path of the site); nil while nothing waits there to be tapped.
    private var nextPath: String?
    private lazy var nextView: NextView = {
        let next = NextView()
        next.onTap = { [weak self] in
            guard let self = self, let path = self.nextPath else { return }
            self.open(path: path)
        }
        next.onLater = { [weak self] in self?.web.evaluateJavaScript("window.longview&&window.longview.later()", completionHandler: nil) }
        return next
    }()
    /// A new page whose large title waits for the page to be back at its top (the page scrolls there just after it says it is new).
    private var titleWaits = false
    private var scrollWatch: NSKeyValueObservation?
    private let cover = CoverView()
    private let notice = NoticeView()
    /// Scheduling the reminders, one list after another, so an older list never lands over a newer one.
    private var scheduling: Task<Void, Never>?
    private weak var popup: UIViewController?
    private weak var popupWeb: WKWebView?
    /// The page a glass button opened in a sheet (proposal G05); it stays there until it is done.
    private weak var sheetWeb: WKWebView?

    private lazy var web: WKWebView = {
        let configuration = WKWebViewConfiguration()
        // Cookies kept on the phone: signed in once, the session lasts through restarts and through
        // installing the app again over itself each week.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        let content = WKUserContentController()
        // The mark the page's style sheet reads (globals.css `html[data-shell]`), set before the page is read.
        // `data-shell-top`: this shell draws the top of the page itself (proposal G02), so the page draws no header of its own;
        // `data-shell-next`: it shows what waits above the tab bar (G04), so the page shows no banner;
        // `data-shell-segmented`: it draws the page's row of sub-tabs as a segmented control (G03).
        content.addUserScript(WKUserScript(source: "document.documentElement.setAttribute('data-shell','ios');document.documentElement.setAttribute('data-shell-top','1');document.documentElement.setAttribute('data-shell-next','1');document.documentElement.setAttribute('data-shell-segmented','1');", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(self, name: "shell")
        content.add(self, name: "reminders")
        content.add(self, name: "haptic")
        configuration.userContentController = content

        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        // The page runs to every edge and keeps clear of the bars itself (--shell-top, --shell-bottom).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = true
        web.allowsLinkPreview = false
        // The launch colour until the page has drawn, not a white flash.
        web.isOpaque = false
        web.backgroundColor = launchGround
        web.scrollView.backgroundColor = launchGround
        #if DEBUG
        web.isInspectable = true
        #endif
        return web
    }()

    /// White text over the launch colour, until a place's page says otherwise (PlaceNavigation).
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override var childForStatusBarStyle: UIViewController? { selectedViewController }

    /// The place on screen.
    private var selectedHost: TabHost? { (selectedViewController as? UINavigationController)?.viewControllers.first as? TabHost }

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        view.backgroundColor = launchGround
        // Scrolling down draws the bar in to its icons, as the web tab bar does.
        tabBarMinimizeBehavior = .onScrollDown
        show(tabs: ShellTab.fallback, choose: ShellTab.home)
        // No tabs on the login page: the bar comes once the page says it is signed in.
        setTabBarHidden(true, animated: false)

        for layer in [notice, cover] as [UIView] {
            layer.frame = view.bounds
            layer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(layer)
        }
        notice.isHidden = true
        Router.shell = self
        // A pull down at the top of the page reads it again (proposal G06); the page says when it is on screen.
        let refresh = UIRefreshControl()
        refresh.addAction(UIAction { [weak self] _ in self?.pullToRefresh() }, for: .valueChanged)
        web.scrollView.refreshControl = refresh
        scrollWatch = web.scrollView.observe(\.contentOffset, options: [.new]) { [weak self] scroll, _ in
            let y = scroll.contentOffset.y
            MainActor.assumeIsolated { self?.scrolled(to: y) }
        }
        open()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // The bar is laid out over what was added before it; these two cover it while they show.
        if !notice.isHidden { view.bringSubviewToFront(notice) }
        if cover.superview != nil { view.bringSubviewToFront(cover) }
        sayBottom()
        sayTop()
    }

    // MARK: Opening the site

    private func open() {
        guard let root = Site.root else {
            notice.show(title: "尚未設定網站", detail: "請依 docs/ios-app.md 建立 ios/Local.xcconfig（執行 ios/setup.sh），再重新建置。", retry: nil)
            notice.isHidden = false
            cover.lift()
            return
        }
        // A page asked for before the app was open (a tapped reminder, a `longview://` address), or the dashboard.
        let first = Router.pending.flatMap(Site.page) ?? root
        Router.pending = nil
        load(first)
        // Whatever happens, the launch screen does not stay for good.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.cover.lift() }
    }

    private func load(_ url: URL) {
        notice.isHidden = true
        asked = url
        web.load(URLRequest(url: url))
    }

    private func failed(_ error: Error) {
        notice.show(title: "連不上網站", detail: error.localizedDescription, retry: { [weak self] in
            guard let self = self, let url = self.asked ?? Site.root else { return }
            self.load(url)
        })
        notice.isHidden = false
        view.bringSubviewToFront(notice)
        cover.lift()
    }

    // MARK: Tabs

    /// Shows `tabs` in the bar (built again only when the list itself changes) and chooses `key`, if it is one of them.
    private func show(tabs: [ShellTab], choose key: String?) {
        if hosts.map(\.place) != tabs {
            let kept = key ?? selectedHost?.place.key
            hosts = tabs.map { tab in
                let host = TabHost(tab: tab)
                host.onSegment = { [weak self] index in
                    UISelectionFeedbackGenerator().selectionChanged()
                    self?.web.evaluateJavaScript("window.longview&&window.longview.segment(\(index))", completionHandler: nil)
                }
                host.onInsets = { [weak self] in
                    self?.sayBottom()
                    self?.sayTop()
                }
                return host
            }
            setViewControllers(hosts.map { PlaceNavigation(host: $0) }, animated: false)
            if let kept = kept, let index = hosts.firstIndex(where: { $0.place.key == kept }) { selectedIndex = index }
        } else if let key = key, let index = hosts.firstIndex(where: { $0.place.key == key }), selectedIndex != index {
            selectedIndex = index
        }
        if let host = selectedHost { attach(to: host) }
    }

    /// Moves the web view into the chosen tab's place; the bar follows its scrolling from there.
    private func attach(to host: TabHost) {
        host.loadViewIfNeeded()
        if web.superview !== host.view {
            web.frame = host.view.bounds
            web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            host.view.addSubview(web)
        }
        host.setContentScrollView(web.scrollView)
    }

    /// Tells the page how much of the foot of the screen the bar takes (--shell-bottom), so its own
    /// floating parts (the "+", the foot of a page) stay clear of it. The largest seen while the bar
    /// shows is kept: the page does not jump when the bar draws in on scrolling.
    private func sayBottom() {
        guard isViewLoaded else { return }
        let device = view.safeAreaInsets.bottom
        var bottom = device
        if !isTabBarHidden {
            let host = selectedHost?.view.safeAreaInsets.bottom ?? 0
            // The place's own safe area covers the bar; should a system version not say so, a usual bar's height.
            bottom = host >= device + 30 ? host : device + 62
            bottom = max(bottom, saidBottom)
        }
        bottom = bottom.rounded()
        guard bottom != saidBottom else { return }
        saidBottom = bottom
        web.evaluateJavaScript("document.documentElement.style.setProperty('--shell-bottom','\(Int(bottom))px')", completionHandler: nil)
    }

    /// Tells the page how much of the top of the screen the navigation bar takes (--shell-top, where a
    /// page starts below its large title) and how much once drawn in to one line (--shell-top-inline,
    /// where a row of the page sticks). Measured only while the page is at its top, with the large
    /// title out; the largest is kept, so the page does not jump as the title draws in.
    private func sayTop() {
        guard isViewLoaded, let bar = selectedHost?.navigationController?.navigationBar, web.scrollView.contentOffset.y <= 0 else { return }
        let top = max(bar.convert(bar.bounds, to: view).maxY.rounded(), saidTop)
        guard top != saidTop else { return }
        saidTop = top
        let inline = (view.safeAreaInsets.top + 44).rounded()
        web.evaluateJavaScript("document.documentElement.style.setProperty('--shell-top','\(Int(top))px');document.documentElement.style.setProperty('--shell-top-inline','\(Int(inline))px')", completionHandler: nil)
    }

    /// A pull down at the top: the page reads itself again from the server (not the nightly job, which
    /// the refresh button runs); a page that cannot is loaded again whole.
    private func pullToRefresh() {
        let refresh = web.scrollView.refreshControl
        web.callAsyncJavaScript("if (window.longview && window.longview.refresh) { await window.longview.refresh(); return true } return false", arguments: [:], in: nil, in: .page) { [weak self] result in
            if case .success(let done) = result, (done as? Bool) == true {
                refresh?.endRefreshing()
            } else {
                refresh?.endRefreshing()
                self?.web.reload()
            }
        }
    }

    /// Draws the top the page sent in the place on screen: its title, its controls, a back button.
    /// A new page at its top shows its large title again, though the page before had drawn it in.
    private func drawTop(_ top: ShellTop?) {
        guard let host = selectedHost else { return }
        let newPage = host.draw(top, run: { [weak self] action in
            if let path = action.sheet { self?.presentSheet(path, title: action.label) } else { self?.press(action.key) }
        }, back: { [weak self] in self?.goBack() })
        // The spinner in white over the poster, in the system's colour over the grey ground.
        web.scrollView.refreshControl?.tintColor = top?.lightStatusBar ?? true ? .white : nil
        if newPage {
            titleWaits = true
            scrolled(to: web.scrollView.contentOffset.y)
        }
        sayTop()
        // The bar may settle its height after this pass; measure it again then.
        DispatchQueue.main.async { [weak self] in self?.sayTop() }
    }

    /// What waits on Hugo, in the tab bar's accessory (proposal G04); with nothing waiting, the day
    /// before this build runs out, the reminder to install it again; else no accessory at all.
    private func showNext(_ next: ShellNext?, signedIn: Bool) {
        var content: NextView.Content?
        if let next = next {
            nextPath = next.href
            content = NextView.Content(text: next.text, more: next.more, symbol: next.act ? "exclamationmark.circle.fill" : "info.circle.fill", tint: next.act ? .systemOrange : .tintColor, tappable: true, later: next.later)
        } else {
            nextPath = nil
            if signedIn, let expiry = Reminders.expiry, expiry > Date(), expiry.timeIntervalSinceNow < 24 * 60 * 60 {
                let format = DateFormatter()
                format.locale = Locale(identifier: "zh_Hant_TW")
                format.dateFormat = "M 月 d 日 HH:mm"
                content = NextView.Content(text: "這版 App 將於 \(format.string(from: expiry)) 到期，記得重裝", more: 0, symbol: "clock.badge.exclamationmark", tint: .systemOrange, tappable: false, later: false)
            }
        }
        guard let content = content else {
            if bottomAccessory != nil { bottomAccessory = nil }
            return
        }
        nextView.show(content)
        if bottomAccessory == nil { bottomAccessory = UITabAccessory(contentView: nextView) }
    }

    /// The page at its top again after a new page: the large title comes out, and the bar's room is measured.
    private func scrolled(to y: CGFloat) {
        guard titleWaits, y <= 0, let bar = selectedHost?.navigationController?.navigationBar else { return }
        titleWaits = false
        bar.sizeToFit()
        view.layoutIfNeeded()
        sayTop()
    }

    /// Once the page has drawn, the grey of its ground shows behind and around it (and through the
    /// bars' glass), not the launch colour.
    private func settleGround() {
        guard TabHost.ground != .systemGroupedBackground else { return }
        TabHost.ground = .systemGroupedBackground
        web.backgroundColor = .systemGroupedBackground
        web.scrollView.backgroundColor = .systemGroupedBackground
        for host in hosts where host.isViewLoaded { host.view.backgroundColor = .systemGroupedBackground }
    }

    /// A page of the site in a sheet over the page on screen (proposal G05): half the screen, pulled up
    /// to all of it, swiped down or cancelled to leave. Its page draws no header of its own; the sheet's
    /// bar carries the name of the button that opened it.
    private func presentSheet(_ path: String, title: String) {
        guard let url = Site.page(path), presentedViewController == nil else { return }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: "document.documentElement.setAttribute('data-shell','ios');document.documentElement.setAttribute('data-shell-top','1');", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = content
        let page = WKWebView(frame: .zero, configuration: configuration)
        page.navigationDelegate = self
        page.uiDelegate = self
        page.isOpaque = false
        page.backgroundColor = .systemGroupedBackground
        page.scrollView.backgroundColor = .systemGroupedBackground
        let holder = UIViewController()
        holder.view = page
        // The button's name says what it opens, e.g. 新增交易 (the label is Chinese first, then English).
        holder.navigationItem.title = title.split(separator: " ").first.map(String.init) ?? title
        let cancel = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.closeSheet() })
        cancel.accessibilityLabel = "取消 Cancel"
        holder.navigationItem.leftBarButtonItem = cancel
        let sheet = UINavigationController(rootViewController: holder)
        if let presentation = sheet.sheetPresentationController {
            presentation.detents = [.medium(), .large()]
            presentation.prefersGrabberVisible = true
        }
        sheetWeb = page
        page.load(URLRequest(url: url))
        present(sheet, animated: true)
    }

    private func closeSheet() {
        guard sheetWeb != nil else { return }
        sheetWeb = nil
        dismiss(animated: true)
    }

    /// Whether a page belongs in the sheet: the sheet's own page (`sheet=` in its address), or adding a
    /// security on the way. Anything else (Holdings after a save) closes the sheet and opens behind it.
    private static func staysInSheet(_ url: URL) -> Bool {
        (url.query ?? "").contains("sheet=") || url.path.hasPrefix("/securities/")
    }

    /// A tap on a glass button: the page presses its own control that lent it (components/shell-bridge.tsx).
    private func press(_ key: String) {
        guard let argument = try? JSONSerialization.data(withJSONObject: [key]), let list = String(data: argument, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.longview&&window.longview.action(\(list)[0])", completionHandler: nil)
    }

    /// Back a page, as the edge swipe does; with nothing behind, the place's own page.
    private func goBack() {
        if web.canGoBack {
            web.goBack()
        } else if let key = state?.tab, let url = Site.page(key) {
            load(url)
        }
    }

    private func heard(_ new: ShellState) {
        state = new
        settleGround()
        show(tabs: new.tabs, choose: new.tab)
        drawTop(new.top)
        showNext(new.signedIn ? new.next : nil, signedIn: new.signedIn)
        if isTabBarHidden == new.signedIn {
            saidBottom = -1
            setTabBarHidden(!new.signedIn, animated: true)
        }
        notice.isHidden = true
        cover.lift()
        sayBottom()
    }

    /// Opens a page of the site: through the page itself when it is there (from what it holds), else fetched whole.
    func open(path: String) {
        guard let url = Site.page(path) else { return }
        closePopup()
        guard state != nil, let argument = try? JSONSerialization.data(withJSONObject: [path]), let list = String(data: argument, encoding: .utf8) else {
            load(url)
            return
        }
        let script = "(function(p){if(window.longview&&window.longview.open){window.longview.open(p);return true}return false})(\(list)[0])"
        web.evaluateJavaScript(script) { [weak self] result, _ in
            if (result as? Bool) != true { self?.load(url) }
        }
    }

    /// Schedules the list the page handed over, then tells the page how it went (components/shell-reminders.tsx shows it).
    private func schedule(_ items: [Reminder], expiryWanted: Bool) {
        let previous = scheduling
        scheduling = Task { [weak self] in
            _ = await previous?.value
            let status = await Reminders.schedule(items, expiryWanted: expiryWanted)
            self?.tell(status)
        }
    }

    private func tell(_ status: Reminders.Status) {
        var detail: [String: Any] = ["allowed": status.allowed, "scheduled": status.scheduled]
        detail["expires"] = status.expires.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull()
        guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.longview&&window.longview.remindersStatus(\(json))", completionHandler: nil)
    }

    private func closePopup() {
        popup?.dismiss(animated: true)
        popup = nil
        popupWeb = nil
    }

    private func confirm(_ message: String, cancel: Bool, answer: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        if cancel { alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in answer(false) }) }
        alert.addAction(UIAlertAction(title: "確定", style: .default) { _ in answer(true) })
        (presentedViewController ?? self).present(alert, animated: true)
    }
}

// MARK: - A tap on a tab

extension ShellViewController: UITabBarControllerDelegate {
    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        guard let host = (viewController as? UINavigationController)?.viewControllers.first as? TabHost else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        attach(to: host)
        let key = host.place.key
        guard let argument = try? JSONSerialization.data(withJSONObject: [key]), let list = String(data: argument, encoding: .utf8) else { return }
        // The page opens the tab from what it holds. A page that is not there to ask (still loading,
        // an error page) is passed over: the tab's page is fetched whole, and "More" goes back.
        let script = "(function(k){if(window.longview){window.longview.select(k);return true}return false})(\(list)[0])"
        web.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self = self, (result as? Bool) != true else { return }
            if key != ShellTab.more, let url = Site.page(key) {
                self.load(url)
            } else {
                self.show(tabs: self.hosts.map(\.place), choose: self.state?.tab)
            }
        }
    }
}

// MARK: - What the page says

extension ShellViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the site's own page in the main web view is listened to.
        guard message.webView === web, message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == Site.root?.host else { return }
        if message.name == "reminders" {
            if let list = Reminder.message(message.body) { schedule(list.items, expiryWanted: list.expiry) }
        } else if message.name == "haptic" {
            // A save confirmed, or something refused (components/shell-bridge.tsx).
            switch message.body as? String {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            default: break
            }
        } else if let new = ShellState(message: message.body) {
            heard(new)
        }
    }
}

// MARK: - Where a link may go

extension ShellViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !mainFrame || url.scheme == "about" { return .allow }
        if Site.holds(url) {
            if webView === sheetWeb, sheetWeb != nil, !Self.staysInSheet(url) {
                // Done in the sheet (a trade saved): close it and show where the form sent Hugo behind it.
                var path = url.path
                if let query = url.query { path += "?\(query)" }
                if let fragment = url.fragment { path += "#\(fragment)" }
                closeSheet()
                open(path: path)
                return .cancel
            }
            if webView === web { asked = url }
            return .allow
        }
        // Another site (a source, a news story): Safari opens it; the app stays on its page.
        if ["http", "https", "mailto", "tel"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return .cancel
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === web else { return }
        // A new page has not been told the room at its foot, nor at its top.
        saidBottom = -1
        saidTop = -1
        sayBottom()
        sayTop()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === web else { return }
        // A page that never reports (a server's error page) still gets shown.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.cover.lift() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === web else { return }
        let code = (error as NSError).code
        // Not failures: a load given up for a newer one, or one handed to Safari.
        if code == NSURLErrorCancelled || code == 102 { return }
        failed(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS took the page's memory back while the app was away.
        webView.reload()
    }
}

// MARK: - Dialogs and new windows

extension ShellViewController: WKUIDelegate {
    /// `window.confirm` (deleting a row): without this a web view answers "no" without asking.
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { continuation in
            confirm(message, cancel: true) { continuation.resume(returning: $0) }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            confirm(message, cancel: false) { _ in continuation.resume() }
        }
    }

    /// A link that asks for a new window: another site goes to Safari; a page of the site (the
    /// import page's "add this security") opens as a sheet over the page, which keeps what was typed.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        guard Site.holds(url) else {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return nil
        }
        let page = WKWebView(frame: .zero, configuration: configuration)
        page.navigationDelegate = self
        page.uiDelegate = self
        let holder = UIViewController()
        holder.view = page
        holder.navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.closePopup() })
        let sheet = UINavigationController(rootViewController: holder)
        popup = sheet
        popupWeb = page
        present(sheet, animated: true)
        return page
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === popupWeb { closePopup() }
    }
}
