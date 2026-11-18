import Charts
import SwiftUI
import WidgetKit

/// The medium home-screen widget (docs/superpowers/specs/2026-11-18-ios-widget-design.md), in the look
/// Hugo chose on 2026-11-18 ("B, glow by the week"): a near-black card lit from the lower left by a
/// glow whose colour follows the 7-day change (red up, green down in Taiwan's convention, swapped in
/// green-up; the app's blue when flat or without figures), the change on a white chip, a large rounded
/// amount with a small "NT$", a thin white line. Dark in light and dark mode alike. Built into the app
/// too, so ios/tests/look.sh can show it.
struct FiguresView: View {
    let state: WidgetState

    var body: some View {
        switch state {
        case let .figures(figures, offline):
            FiguresBody(figures: figures, offline: offline)
        case .empty:
            Line(text: "尚無資料")
        case .noKey:
            Line(text: "長按 → 編輯小工具，貼上鑰匙")
        case .badKey:
            Line(text: "鑰匙已失效，請到 更多 → 推播 換一把")
        case .unreachable:
            Line(text: "連不上網站")
        }
    }
}

/// Which way the week went, as a colour: the glow and the chip's text follow it.
enum WeekTone {
    case rise, fall, flat

    init(_ state: WidgetState) {
        guard case let .figures(figures, _) = state, let change = figures.weekChange, change != 0 else {
            self = .flat
            return
        }
        // Red is "up" in Taiwan's convention (config sectors); green-up swaps the two.
        self = (change > 0) == figures.redUp ? .rise : .fall
    }

    /// The glow's colour.
    var glow: Color {
        switch self {
        case .rise: return Color(red: 1.0, green: 0x56 / 255, blue: 0x5c / 255)
        case .fall: return Color(red: 0x34 / 255, green: 0xd3 / 255, blue: 0x6a / 255)
        case .flat: return Color(red: 0x6f / 255, green: 0xa3 / 255, blue: 0xdb / 255)
        }
    }

    /// The deeper colour the glow fades through.
    var deep: Color {
        switch self {
        case .rise: return Color(red: 0xc8 / 255, green: 0x10 / 255, blue: 0x2e / 255)
        case .fall: return Color(red: 0x1f / 255, green: 0x7a / 255, blue: 0x35 / 255)
        case .flat: return Color(red: 0x34 / 255, green: 0x68 / 255, blue: 0x9c / 255)
        }
    }

    /// The card's near-black, tinted toward the glow.
    var base: Color {
        switch self {
        case .rise: return Color(red: 0x0e / 255, green: 0x0b / 255, blue: 0x10 / 255)
        case .fall: return Color(red: 0x09 / 255, green: 0x0d / 255, blue: 0x0b / 255)
        case .flat: return Color(red: 0x0b / 255, green: 0x10 / 255, blue: 0x18 / 255)
        }
    }

    /// The change's text on the white chip (strong enough on white: 5.9:1 and 5.3:1).
    var ink: Color {
        switch self {
        case .rise: return Color(red: 0xc8 / 255, green: 0x10 / 255, blue: 0x2e / 255)
        case .fall: return Color(red: 0x1f / 255, green: 0x7a / 255, blue: 0x35 / 255)
        case .flat: return Color(red: 0x1b / 255, green: 0x26 / 255, blue: 0x33 / 255)
        }
    }
}

/// The card behind the widget: its near-black, lit from the lower left by the week's glow.
struct GlowGround: View {
    let state: WidgetState

    var body: some View {
        let tone = WeekTone(state)
        ZStack {
            tone.base
            RadialGradient(
                stops: [
                    .init(color: tone.glow.opacity(0.78), location: 0),
                    .init(color: tone.deep.opacity(0.32), location: 0.42),
                    .init(color: tone.base.opacity(0), location: 0.75),
                ],
                center: UnitPoint(x: 0, y: 1.2),
                startRadius: 0,
                endRadius: 300
            )
        }
    }
}

private struct FiguresBody: View {
    let figures: Figures
    let offline: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Chip(change: figures.weekChange, tone: WeekTone(.figures(figures, offline: offline)))
                    .privacySensitive()
                Spacer(minLength: 8)
                Text(closeLabel)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("NT$")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.8))
                        Text(amount(figures.totalTwd))
                            .font(.system(size: 36, weight: .bold, design: .rounded).monospacedDigit())
                            .foregroundStyle(.white)
                            .minimumScaleFactor(0.55)
                            .lineLimit(1)
                    }
                    .privacySensitive()
                    .widgetAccentable()
                    Text("總市值")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.72))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Chart(Array(figures.points.enumerated()), id: \.offset) { point in
                    LineMark(x: .value("日", point.offset), y: .value("漲跌", point.element))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .foregroundStyle(.white)
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .chartLegend(.hidden)
                .frame(width: 96, height: 48)
                .padding(.bottom, 6)
                .privacySensitive()
                .widgetAccentable()
            }
        }
    }

    /// "近 7 天 · 11/17 收盤", with ⚠︎ when the close is old or the site could not be reached.
    private var closeLabel: String {
        let parts = figures.asOf.split(separator: "-").compactMap { Int($0) }
        let date = parts.count == 3 ? "\(parts[1])/\(parts[2])" : figures.asOf
        return "近 7 天 · " + (figures.stale || offline ? "⚠︎ " : "") + "\(date) 收盤"
    }

    private func amount(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: "zh_Hant_TW")))
    }
}

/// The 7-day change on a white chip, ▲ or ▼ beside it, in the week's colour.
private struct Chip: View {
    let change: Double?
    let tone: WeekTone

    var body: some View {
        Text(label)
            .font(.system(size: 13, weight: .bold).monospacedDigit())
            .foregroundStyle(tone.ink)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(Capsule().fill(.white))
    }

    private var label: String {
        guard let change else { return "—" }
        let percent = abs(change * 100).formatted(.number.precision(.fractionLength(2)))
        if change > 0 { return "▲ \(percent)%" }
        if change < 0 { return "▼ \(percent)%" }
        return "\(percent)%"
    }
}

/// One short line for every state without figures.
private struct Line: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("總市值")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.72))
            Text(text)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
