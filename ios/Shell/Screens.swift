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

/// What waits on Hugo, in the tab bar's accessory (proposal G04): the first in-app banner, how many
/// more wait behind it, and a tap to where it is done; held down, 稍後再說. With nothing waiting, on
/// the day before this build runs out, the reminder to install it again (no tap: it is done on the Mac).
final class NextView: UIView, UIContextMenuInteractionDelegate {
    struct Content: Equatable {
        let text: String
        let more: Int
        let symbol: String
        let tint: UIColor
        let tappable: Bool
        let later: Bool
    }

    var onTap: (() -> Void)?
    var onLater: (() -> Void)?
    private(set) var content: Content?
    private let icon = UIImageView()
    private let label = UILabel()
    private let count = UILabel()
    private let chevron = UIImageView(image: UIImage(systemName: "chevron.forward"))

    override init(frame: CGRect) {
        super.init(frame: frame)
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body)
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.adjustsFontForContentSizeCategory = true
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        count.font = .preferredFont(forTextStyle: .subheadline)
        count.adjustsFontForContentSizeCategory = true
        count.textColor = .secondaryLabel
        chevron.tintColor = .tertiaryLabel
        chevron.preferredSymbolConfiguration = UIImage.SymbolConfiguration(textStyle: .footnote, scale: .small)
        // The text takes the room; the marks keep their own size.
        for mark in [icon, chevron] as [UIView] {
            mark.contentMode = .scaleAspectFit
            mark.setContentHuggingPriority(.required, for: .horizontal)
            mark.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
        count.setContentHuggingPriority(.required, for: .horizontal)
        label.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let stack = UIStackView(arrangedSubviews: [icon, label, count, chevron])
        stack.spacing = 8
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
        addInteraction(UIContextMenuInteraction(delegate: self))
        isAccessibilityElement = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    func show(_ new: Content) {
        guard new != content else { return }
        content = new
        icon.image = UIImage(systemName: new.symbol)
        icon.tintColor = new.tint
        label.text = new.text
        count.text = "＋\(new.more)"
        count.isHidden = new.more == 0
        chevron.isHidden = !new.tappable
        accessibilityLabel = new.more > 0 ? "\(new.text)，還有 \(new.more) 則" : new.text
        accessibilityTraits = new.tappable ? .button : .staticText
        accessibilityCustomActions = new.later ? [UIAccessibilityCustomAction(name: "稍後再說 Later") { [weak self] _ in
            self?.onLater?()
            return true
        }] : nil
    }

    @objc private func tapped() {
        if content?.tappable == true { onTap?() }
    }

    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? {
        guard content?.later == true else { return nil }
        return UIContextMenuConfiguration(actionProvider: { [weak self] _ in
            UIMenu(children: [UIAction(title: "稍後再說", image: UIImage(systemName: "clock")) { _ in self?.onLater?() }])
        })
    }
}
