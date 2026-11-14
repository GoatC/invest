import UIKit

/// The ground of the launch screen and of the web app's opening screen (lib/splash.ts SPLASH_GROUND).
let launchGround = UIColor(named: "LaunchGround") ?? .systemBlue

/// The launch screen again, kept over the web view until the page has drawn its own opening screen
/// (components/splash.tsx), which looks the same: the three read as one screen.
final class CoverView: UIView {
    private var lifted = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = launchGround
        let mark = UIImageView(image: UIImage(named: "LaunchMark"))
        mark.translatesAutoresizingMaskIntoConstraints = false
        addSubview(mark)
        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    func lift() {
        guard !lifted else { return }
        lifted = true
        UIView.animate(withDuration: 0.25, animations: { self.alpha = 0 }, completion: { _ in self.removeFromSuperview() })
    }
}

/// Shown in place of the page when it cannot be fetched, or when the app does not know its site yet.
final class NoticeView: UIView {
    private let title = UILabel()
    private let detail = UILabel()
    private let button = UIButton(configuration: .filled())
    private var action: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        // On the launch colour, so the status bar's white text reads here too.
        backgroundColor = launchGround
        title.textColor = .white
        button.configuration?.baseBackgroundColor = .white
        button.configuration?.baseForegroundColor = launchGround
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0
        detail.font = .preferredFont(forTextStyle: .body)
        detail.adjustsFontForContentSizeCategory = true
        detail.textColor = UIColor.white.withAlphaComponent(0.85)
        detail.textAlignment = .center
        detail.numberOfLines = 0
        button.addAction(UIAction { [weak self] _ in self?.action?() }, for: .primaryActionTriggered)
        let stack = UIStackView(arrangedSubviews: [title, detail, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: layoutMarginsGuide.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: layoutMarginsGuide.trailingAnchor, constant: -12),
            // Nothing to tap is smaller than 44 points.
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 120),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    /// `retry` nil: nothing to try again (the site is not set), so no button.
    func show(title: String, detail: String, retry: (() -> Void)?) {
        self.title.text = title
        self.detail.text = detail
        action = retry
        button.configuration?.title = "重試"
        button.isHidden = retry == nil
    }
}
