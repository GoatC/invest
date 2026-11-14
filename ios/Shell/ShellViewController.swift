import UIKit
import WebKit

/// One place in the tab bar. It has no page of its own: the one web view moves into whichever is
/// chosen, so a tab opens from what the page already holds (components/preload.tsx on the web side).
final class TabHost: UIViewController {
    /// Not `tab`: UIKit has a property of that name on every view controller.
    let place: ShellTab
    /// Called when the room the bars take from this place changes.
    var onInsets: (() -> Void)?

    init(tab: ShellTab) {
        self.place = tab
        super.init(nibName: nil, bundle: nil)
        tabBarItem = UITabBarItem(title: tab.title, image: UIImage(systemName: tab.symbol), selectedImage: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = launchGround
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        onInsets?()
    }
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
    private let cover = CoverView()
    private let notice = NoticeView()
    private weak var popup: UIViewController?
    private weak var popupWeb: WKWebView?

    private lazy var web: WKWebView = {
        let configuration = WKWebViewConfiguration()
        // Cookies kept on the phone: signed in once, the session lasts through restarts and through
        // installing the app again over itself each week.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        let content = WKUserContentController()
        // The mark the page's style sheet reads (globals.css `html[data-shell]`), set before the page is read.
        content.addUserScript(WKUserScript(source: "document.documentElement.setAttribute('data-shell','ios');", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(self, name: "shell")
        configuration.userContentController = content

        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        // The page runs to every edge and keeps clear of the bars itself (--safe-top, --shell-bottom).
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

    /// White text in the status bar: the page keeps a band of the poster's colour behind it.
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

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
        open()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // The bar is laid out over what was added before it; these two cover it while they show.
        if !notice.isHidden { view.bringSubviewToFront(notice) }
        if cover.superview != nil { view.bringSubviewToFront(cover) }
        sayBottom()
    }

    // MARK: Opening the site

    private func open() {
        guard let root = Site.root else {
            notice.show(title: "尚未設定網站", detail: "請依 docs/ios-app.md 建立 ios/Local.xcconfig（執行 ios/setup.sh），再重新建置。", retry: nil)
            notice.isHidden = false
            cover.lift()
            return
        }
        load(root)
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
            let kept = key ?? (selectedViewController as? TabHost)?.place.key
            hosts = tabs.map { tab in
                let host = TabHost(tab: tab)
                host.onInsets = { [weak self] in self?.sayBottom() }
                return host
            }
            setViewControllers(hosts, animated: false)
            if let kept = kept, let index = hosts.firstIndex(where: { $0.place.key == kept }) { selectedIndex = index }
        } else if let key = key, let index = hosts.firstIndex(where: { $0.place.key == key }), selectedIndex != index {
            selectedIndex = index
        }
        if let host = selectedViewController as? TabHost { attach(to: host) }
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
            let host = (selectedViewController as? TabHost)?.view.safeAreaInsets.bottom ?? 0
            // The place's own safe area covers the bar; should a system version not say so, a usual bar's height.
            bottom = host >= device + 30 ? host : device + 62
            bottom = max(bottom, saidBottom)
        }
        bottom = bottom.rounded()
        guard bottom != saidBottom else { return }
        saidBottom = bottom
        web.evaluateJavaScript("document.documentElement.style.setProperty('--shell-bottom','\(Int(bottom))px')", completionHandler: nil)
    }

    private func heard(_ new: ShellState) {
        state = new
        show(tabs: new.tabs, choose: new.tab)
        if isTabBarHidden == new.signedIn {
            saidBottom = -1
            setTabBarHidden(!new.signedIn, animated: true)
        }
        notice.isHidden = true
        cover.lift()
        sayBottom()
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
        guard let host = viewController as? TabHost else { return }
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
        guard message.webView === web, message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == Site.root?.host,
              let new = ShellState(message: message.body)
        else { return }
        heard(new)
    }
}

// MARK: - Where a link may go

extension ShellViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !mainFrame || url.scheme == "about" { return .allow }
        if Site.holds(url) {
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
        // A new page has not been told the room at its foot.
        saidBottom = -1
        sayBottom()
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
