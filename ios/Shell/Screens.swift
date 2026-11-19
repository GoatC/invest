import UIKit

/// The ground of the launch screen and of the web app's opening screen (lib/splash.ts SPLASH_GROUND):
/// opening screen B's ink black (Hugo, 2026-11-19), in light and dark alike.
let launchGround = UIColor(named: "LaunchGround") ?? UIColor(red: 0x07 / 255, green: 0x0B / 255, blue: 0x09 / 255, alpha: 1)

/// Opening screen B (Hugo, 2026-11-19; components/splash.tsx draws the same for the web app), kept over
/// the web view until the page has opened: the launch screen's mark on its ink ground, then a
/// forget-me-not glow from the top right fades in and the mark's rising line is drawn along its track,
/// once each. With Reduce Motion both are simply there. Nothing under it can be touched or scrolled.
final class CoverView: UIView {
    private var lifted = false
    private let mark = UIImageView(image: UIImage(named: "LaunchMark"))
    private let glow = CAGradientLayer()
    private let line = CAShapeLayer()
    private let name = UILabel()
    private var played = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = launchGround
        glow.type = .radial
        glow.colors = [
            UIColor(red: 0x6F / 255, green: 0xA3 / 255, blue: 0xDB / 255, alpha: 0.66).cgColor,
            UIColor(red: 0x34 / 255, green: 0x68 / 255, blue: 0x9C / 255, alpha: 0.30).cgColor,
            UIColor(red: 0x07 / 255, green: 0x0B / 255, blue: 0x09 / 255, alpha: 0).cgColor,
        ]
        glow.locations = [0, 0.38, 1]
        // The centre at the top-right corner, reaching most of the way across the screen.
        glow.startPoint = CGPoint(x: 1, y: 0)
        glow.endPoint = CGPoint(x: 0.05, y: 0.62)
        layer.addSublayer(glow)
        mark.translatesAutoresizingMaskIntoConstraints = false
        addSubview(mark)
        line.fillColor = nil
        line.strokeColor = UIColor.white.cgColor
        line.lineCap = .round
        line.lineJoin = .round
        layer.addSublayer(line)
        // 20-point bold with 0.14em between the characters, as on the web app's opening screen.
        name.attributedText = NSAttributedString(string: "長期投資", attributes: [.kern: 2.8, .font: UIFont.systemFont(ofSize: 20, weight: .bold), .foregroundColor: UIColor.white])
        name.translatesAutoresizingMaskIntoConstraints = false
        name.isAccessibilityElement = false
        addSubview(name)
        accessibilityLabel = "長期投資 載入中"
        isAccessibilityElement = true
        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: centerYAnchor),
            name.centerXAnchor.constraint(equalTo: centerXAnchor),
            // The image is a 168-point square around the 120-point mark: the name sits 20 points below the mark.
            name.topAnchor.constraint(equalTo: mark.bottomAnchor, constant: -4),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        glow.frame = bounds
        // The mark's 64-unit box is 120 points, centred in the 168-point image.
        let unit = 120.0 / 64
        let origin = CGPoint(x: mark.frame.midX - 60, y: mark.frame.midY - 60)
        let path = UIBezierPath()
        let points: [(CGFloat, CGFloat)] = [(12, 44), (26, 32), (36, 38), (52, 20)]
        for (index, point) in points.enumerated() {
            let at = CGPoint(x: origin.x + point.0 * unit, y: origin.y + point.1 * unit)
            if index == 0 { path.move(to: at) } else { path.addLine(to: at) }
        }
        line.path = path.cgPath
        line.lineWidth = 5 * unit
        CATransaction.commit()
        play()
    }

    /// The glow and the line, once, when the cover is first laid out.
    private func play() {
        guard !played, bounds.width > 0 else { return }
        played = true
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        let ease = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
        let draw = CABasicAnimation(keyPath: "strokeEnd")
        draw.fromValue = 0
        draw.toValue = 1
        draw.duration = 0.7
        draw.beginTime = CACurrentMediaTime() + 0.1
        draw.fillMode = .backwards
        draw.timingFunction = ease
        line.add(draw, forKey: "draw")
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0
        fade.toValue = 1
        fade.duration = 0.7
        fade.timingFunction = ease
        glow.add(fade, forKey: "fade")
        name.alpha = 0
        UIView.animate(withDuration: 0.5, delay: 0.3, options: [.curveEaseOut]) { self.name.alpha = 1 }
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
