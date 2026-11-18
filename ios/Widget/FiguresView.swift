import Charts
import SwiftUI
import WidgetKit

/// The medium home-screen widget (docs/superpowers/specs/2026-11-18-ios-widget-design.md), after the
/// dashboard's poster in the Liquid Glass spec: the poster's blue, white figures, the 7-day change on
/// a white chip, the line in white. Built into the app too, so ios/tests/look.sh can show it.
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

/// The poster's colour behind the widget, as on the dashboard (light and dark).
struct PosterGround: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        scheme == .dark ? Color(red: 0x1f / 255, green: 0x4f / 255, blue: 0x86 / 255) : Color(red: 0x34 / 255, green: 0x68 / 255, blue: 0x9c / 255)
    }
}

private struct FiguresBody: View {
    let figures: Figures
    let offline: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("總市值")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.86))
                Spacer(minLength: 0)
                Text(money(figures.totalTwd))
                    .font(.system(size: 26, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .privacySensitive()
                    .widgetAccentable()
                HStack(spacing: 6) {
                    Chip(change: figures.weekChange, redUp: figures.redUp)
                        .privacySensitive()
                    Text("近 7 天")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.82))
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 6) {
                Text(closeLabel)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.78))
                    .lineLimit(1)
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
                .privacySensitive()
                .widgetAccentable()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// "11/17 收盤", with ⚠︎ when the close is old or the site could not be reached.
    private var closeLabel: String {
        let parts = figures.asOf.split(separator: "-").compactMap { Int($0) }
        let date = parts.count == 3 ? "\(parts[1])/\(parts[2])" : figures.asOf
        return (figures.stale || offline ? "⚠︎ " : "") + "\(date) 收盤"
    }

    private func money(_ amount: Double) -> String {
        "NT$ " + amount.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: "zh_Hant_TW")))
    }
}

/// The 7-day change on a white chip, ▲ or ▼ beside it, red up unless green up was chosen.
private struct Chip: View {
    let change: Double?
    let redUp: Bool

    var body: some View {
        Text(label)
            .font(.system(size: 13, weight: .semibold).monospacedDigit())
            .foregroundStyle(tone)
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

    private var tone: Color {
        let red = Color(red: 0xc8 / 255, green: 0x10 / 255, blue: 0x2e / 255)
        let green = Color(red: 0x1f / 255, green: 0x7a / 255, blue: 0x35 / 255)
        guard let change, change != 0 else { return Color(red: 0x1b / 255, green: 0x26 / 255, blue: 0x33 / 255) }
        return (change > 0) == redUp ? red : green
    }
}

/// One short line for every state without figures.
private struct Line: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("總市值")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.86))
            Text(text)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
