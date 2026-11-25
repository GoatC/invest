import Charts
import SwiftUI
import UIKit

/// A chart the page hands over to be drawn with Swift Charts (lib/native-chart.ts `NativeSpec`): the
/// page keeps building it, and keeps its place, its legend and its table; the shell draws it in that
/// place, over the page, with Apple's own charts (native, not a look-alike).
struct NativeChartSpec {
    enum Mark { case line, bar, point }

    struct Series {
        let name: String
        let mark: Mark
        let color: Color
        let values: [Double?]
        let colors: [Color?]
        let stack: String?
        let dashed: Bool
    }

    struct Rule {
        let onX: Bool
        let value: Double
        let color: Color
        let dashed: Bool
    }

    let spark: Bool
    /// The x of each value: its index for categories and dates, the value itself on a value axis.
    let xs: [Double]
    let xTicks: [(at: Double, label: String)]
    let yMin: Double?
    let yMax: Double?
    let yTicks: [(value: Double, label: String)]
    let series: [Series]
    let rules: [Rule]
    let readouts: [String]
    let area: Bool
    let lineWidth: CGFloat
    /// Draws itself left to right as it appears: the poster's opening sequence (docs/design-handoff/04-motion.md).
    let reveal: Bool

    init?(_ body: Any?) {
        guard let fields = body as? [String: Any], (fields["v"] as? Int) == 1,
              let x = fields["x"] as? [String: Any], let values = x["values"] as? [Any],
              let list = fields["series"] as? [[String: Any]]
        else { return nil }
        let kind = x["kind"] as? String ?? "category"
        spark = fields["spark"] as? Bool ?? false
        xs = values.enumerated().map { index, value in kind == "value" ? (value as? Double ?? Double(index)) : Double(index) }
        xTicks = (fields["xTicks"] as? [[String: Any]] ?? []).compactMap { tick in
            guard let at = tick["at"] as? Double, let label = tick["label"] as? String else { return nil }
            return (at: at, label: label)
        }
        let y = fields["y"] as? [String: Any] ?? [:]
        yMin = y["min"] as? Double
        yMax = y["max"] as? Double
        yTicks = (y["ticks"] as? [[String: Any]] ?? []).compactMap { tick in
            guard let value = tick["value"] as? Double, let label = tick["label"] as? String else { return nil }
            return (value: value, label: label)
        }
        series = list.map { entry in
            let mark: Mark = entry["mark"] as? String == "bar" ? .bar : entry["mark"] as? String == "point" ? .point : .line
            let raw = entry["values"] as? [Any] ?? []
            return Series(
                name: entry["name"] as? String ?? "",
                mark: mark,
                color: Color(css: entry["color"] as? String) ?? .accentColor,
                values: raw.map { $0 as? Double },
                colors: (entry["colors"] as? [Any] ?? []).map { Color(css: $0 as? String) },
                stack: entry["stack"] as? String,
                dashed: entry["dashed"] as? Bool ?? false
            )
        }
        rules = (fields["rules"] as? [[String: Any]] ?? []).compactMap { rule in
            guard let value = rule["value"] as? Double else { return nil }
            return Rule(onX: rule["axis"] as? String == "x", value: value, color: Color(css: rule["color"] as? String) ?? .secondary, dashed: rule["dashed"] as? Bool ?? false)
        }
        readouts = fields["readouts"] as? [String] ?? []
        area = fields["area"] as? Bool ?? false
        lineWidth = CGFloat(fields["lineWidth"] as? Double ?? 2)
        reveal = fields["reveal"] as? Bool ?? false
    }

    /// Half the gap between neighbouring xs: a bar's half width.
    var halfBar: Double {
        let gaps = zip(xs.dropFirst(), xs).map { $0 - $1 }.filter { $0 > 0 }
        return (gaps.min() ?? 1) * 0.36
    }

    /// Each bar's bottom and top: bars of one stack pile up away from zero in series order, positives up, negatives down.
    func barRanges() -> [[(Double, Double)?]] {
        var up: [String: [Double]] = [:]
        var down: [String: [Double]] = [:]
        return series.enumerated().map { index, entry in
            guard entry.mark == .bar else { return entry.values.map { _ in nil } }
            let key = entry.stack ?? "#\(index)"
            var ups = up[key] ?? Array(repeating: 0, count: xs.count)
            var downs = down[key] ?? Array(repeating: 0, count: xs.count)
            let ranges: [(Double, Double)?] = entry.values.enumerated().map { at, value in
                guard let value = value, at < xs.count else { return nil }
                if value >= 0 {
                    defer { ups[at] += value }
                    return (ups[at], ups[at] + value)
                }
                defer { downs[at] += value }
                return (downs[at] + value, downs[at])
            }
            up[key] = ups
            down[key] = downs
            return ranges
        }
    }

    /// The index of the x nearest to `x`.
    func nearest(_ x: Double) -> Int? {
        xs.indices.min { abs(xs[$0] - x) < abs(xs[$1] - x) }
    }
}

/// A chart drawing itself in, left to right: a mask that widens from the leading edge. Only on a chart that asks, so
/// no other chart is clipped; the mask reaches past the edges, so today's dot at the end is never cut.
private struct Reveal: ViewModifier {
    let drawn: CGFloat
    let on: Bool

    func body(content: Content) -> some View {
        if on {
            content.mask(alignment: .leading) {
                Rectangle().padding(-24).scaleEffect(x: drawn, y: 1, anchor: .leading)
            }
        } else {
            content
        }
    }
}

/// One point to draw, with what Swift Charts needs to tell the series and the bars apart.
private struct Plot: Identifiable {
    let id: String
    let series: Int
    let x: Double
    let y: Double
    let low: Double
    let high: Double
    let color: Color
}

/// The chart, drawn with Swift Charts: the page's colours and axis labels, the value axis on the
/// trailing side with dashed grid lines, and, held down on it, a rule at the nearest x with the
/// page's own read-out above it. A sparkline has no axes and no read-out.
struct NativeChartView: View {
    let spec: NativeChartSpec
    @State private var selected: Int?
    /// How much of the chart shows, left to right: 0 → 1 as a revealed chart appears, else 1 throughout. A chart set
    /// again in place (a theme change) keeps its state, so it does not draw in twice.
    @State private var drawn: CGFloat

    init(spec: NativeChartSpec) {
        self.spec = spec
        _drawn = State(initialValue: spec.reveal && !UIAccessibility.isReduceMotionEnabled ? 0 : 1)
    }

    private var plots: [Plot] {
        let ranges = spec.barRanges()
        var out: [Plot] = []
        for (index, entry) in spec.series.enumerated() {
            for (at, value) in entry.values.enumerated() {
                guard let value = value, at < spec.xs.count else { continue }
                let range = ranges[index][at] ?? (0, value)
                let tint = at < entry.colors.count ? entry.colors[at] ?? entry.color : entry.color
                out.append(Plot(id: "\(index)-\(at)", series: index, x: spec.xs[at], y: value, low: range.0, high: range.1, color: tint))
            }
        }
        return out
    }

    private var base: Double { spec.yMin ?? min(0, spec.series.flatMap { $0.values.compactMap { $0 } }.min() ?? 0) }

    var body: some View {
        drawing
            .modifier(Reveal(drawn: drawn, on: spec.reveal))
            .onAppear {
                guard drawn < 1 else { return }
                // 04-motion.md row 3: 900 ms after 260 ms, cubic-bezier(.3, .6, .2, 1).
                withAnimation(.timingCurve(0.3, 0.6, 0.2, 1, duration: 0.9).delay(0.26)) { drawn = 1 }
            }
    }

    @ViewBuilder private var drawing: some View {
        let plots = self.plots
        let half = spec.halfBar
        let chart = Chart {
            if spec.area, let line = spec.series.first(where: { $0.mark == .line }) {
                ForEach(plots.filter { spec.series[$0.series].mark == .line }) { plot in
                    AreaMark(x: .value("x", plot.x), yStart: .value("y", base), yEnd: .value("y", plot.y))
                        .foregroundStyle(LinearGradient(colors: [line.color.opacity(0.22), line.color.opacity(0)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                }
            }
            ForEach(plots) { plot in
                let entry = spec.series[plot.series]
                switch entry.mark {
                case .line:
                    LineMark(x: .value("x", plot.x), y: .value("y", plot.y), series: .value("s", "\(plot.series)"))
                        .foregroundStyle(entry.color)
                        .lineStyle(StrokeStyle(lineWidth: spec.lineWidth, lineCap: .round, lineJoin: .round, dash: entry.dashed ? [4, 4] : []))
                        .interpolationMethod(spec.spark ? .monotone : .linear)
                case .bar:
                    RectangleMark(xStart: .value("x", plot.x - half), xEnd: .value("x", plot.x + half), yStart: .value("y", plot.low), yEnd: .value("y", plot.high))
                        .foregroundStyle(plot.color)
                        .cornerRadius(3)
                case .point:
                    PointMark(x: .value("x", plot.x), y: .value("y", plot.y))
                        .foregroundStyle(plot.color)
                        .symbolSize(36)
                }
            }
            ForEach(Array(spec.rules.enumerated()), id: \.offset) { _, rule in
                if rule.onX {
                    RuleMark(x: .value("x", rule.value))
                        .foregroundStyle(rule.color)
                        .lineStyle(StrokeStyle(lineWidth: rule.dashed ? 1.5 : 2, dash: rule.dashed ? [2, 5] : []))
                } else {
                    RuleMark(y: .value("y", rule.value))
                        .foregroundStyle(rule.color)
                        .lineStyle(StrokeStyle(lineWidth: rule.dashed ? 1.5 : 2, dash: rule.dashed ? [2, 5] : []))
                }
            }
            if let selected = selected, selected < spec.xs.count {
                RuleMark(x: .value("x", spec.xs[selected]))
                    .foregroundStyle(Color.secondary)
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        Text(selected < spec.readouts.count ? spec.readouts[selected] : "")
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                            .multilineTextAlignment(.leading)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
            }
        }
        .chartLegend(.hidden)
        .chartXScale(domain: xDomain)

        if spec.spark {
            chart
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: yDomain)
        } else {
            chart
                .chartYScale(domain: yDomain)
                .chartYAxis {
                    if spec.yTicks.isEmpty {
                        AxisMarks(position: .trailing) { _ in
                            AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 4]))
                            AxisValueLabel()
                        }
                    } else {
                        AxisMarks(position: .trailing, values: spec.yTicks.map { $0.value }) { value in
                            AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 4]))
                            AxisValueLabel {
                                Text(label(y: value.as(Double.self)))
                            }
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: spec.xTicks.map { $0.at }) { value in
                        // Labels that would run into each other give way, as Swift Charts' own do.
                        AxisValueLabel(collisionResolution: .greedy) {
                            Text(label(x: value.as(Double.self)))
                        }
                    }
                }
                .chartOverlay { proxy in
                    GeometryReader { geometry in
                        Rectangle().fill(.clear).contentShape(Rectangle())
                            .gesture(
                                LongPressGesture(minimumDuration: 0.2)
                                    .sequenced(before: DragGesture(minimumDistance: 0))
                                    .onChanged { value in
                                        guard case .second(true, let drag?) = value, let frame = proxy.plotFrame else { return }
                                        let x = drag.location.x - geometry[frame].origin.x
                                        if let at: Double = proxy.value(atX: x), let index = spec.nearest(at), index != selected {
                                            selected = index
                                            UISelectionFeedbackGenerator().selectionChanged()
                                        }
                                    }
                                    .onEnded { _ in selected = nil }
                            )
                    }
                }
        }
    }

    private var xDomain: ClosedRange<Double> {
        let low = spec.xs.min() ?? 0
        let high = spec.xs.max() ?? 1
        let hasBars = spec.series.contains { $0.mark == .bar }
        let pad = hasBars ? spec.halfBar * 1.4 : 0
        return (low - pad)...(max(high, low + 0.000_001) + pad)
    }

    private var yDomain: ClosedRange<Double> {
        let values = spec.series.flatMap { $0.values.compactMap { $0 } } + spec.barRanges().flatMap { $0.compactMap { $0 } }.flatMap { [$0.0, $0.1] }
        let low = spec.yMin ?? min(0, values.min() ?? 0)
        let high = spec.yMax ?? max(0, values.max() ?? 1)
        return low...(high > low ? high : low + 1)
    }

    private func label(y: Double?) -> String {
        guard let y = y else { return "" }
        return spec.yTicks.min { abs($0.value - y) < abs($1.value - y) }?.label ?? ""
    }

    private func label(x: Double?) -> String {
        guard let x = x else { return "" }
        return spec.xTicks.min { abs($0.at - x) < abs($1.at - x) }?.label ?? ""
    }
}

/// The charts the page handed over, each in its place in the web view's scrolling content, so it
/// scrolls with the page (components/native-charts.ts tells where each one sits).
@MainActor
final class NativeCharts {
    private weak var scroll: UIScrollView?
    private var shown: [String: UIHostingController<NativeChartView>] = [:]
    /// Hands the page what `report` found, as JSON (ShellViewController sets it).
    var onReport: ((String) -> Void)?

    init(scroll: UIScrollView) {
        self.scroll = scroll
    }

    /// `{op: set | move | remove, id, box?, spec?}` from the page.
    func handle(_ body: Any) {
        guard let fields = body as? [String: Any], let op = fields["op"] as? String, let id = fields["id"] as? String else { return }
        switch op {
        case "set":
            guard let spec = NativeChartSpec(fields["spec"]) else { return }
            if let kept = shown[id] {
                kept.rootView = NativeChartView(spec: spec)
            } else {
                let host = Self.host(spec)
                shown[id] = host
                scroll?.addSubview(host.view)
            }
            place(id, fields["box"])
        case "move":
            place(id, fields["box"])
        case "remove":
            shown.removeValue(forKey: id)?.view.removeFromSuperview()
        case "report":
            // What each chart is drawn as, for reading in Safari's Web Inspector (`window.__shellReport`) while the
            // VaR line's squashed first drawing on Hugo's phone is found (2026-11-25). shortcut: diagnostic only, remove once fixed.
            let charts = shown.map { id, host -> [String: Any] in
                let view = host.view!
                let spec = host.rootView.spec
                let values = spec.series.first?.values.compactMap { $0 } ?? []
                return ["id": id, "frame": [view.frame.minX, view.frame.minY, view.frame.width, view.frame.height], "bounds": [view.bounds.width, view.bounds.height],
                        "hidden": view.isHidden, "inWindow": view.window != nil, "safe": [view.safeAreaInsets.top, view.safeAreaInsets.bottom],
                        "yMin": spec.yMin.map { $0 as Any } ?? "nil", "yMax": spec.yMax.map { $0 as Any } ?? "nil", "spark": spec.spark, "n": values.count, "low": values.min() ?? 0, "high": values.max() ?? 0]
            }
            let offset = scroll.map { [$0.contentOffset.y, $0.bounds.height, $0.contentSize.height] } ?? []
            if let data = try? JSONSerialization.data(withJSONObject: ["charts": charts, "scroll": offset]), let json = String(data: data, encoding: .utf8) {
                onReport?(json)
            }
        default:
            break
        }
    }

    private static func host(_ spec: NativeChartSpec) -> UIHostingController<NativeChartView> {
        let host = UIHostingController(rootView: NativeChartView(spec: spec))
        host.view.backgroundColor = .clear
        host.sizingOptions = []
        // A chart is a box in the page, not a screen: placed where the bars are (the VaR line, under the tab
        // bar on opening), it took their safe area as an inset and drew squashed into the top of its box,
        // and kept that once scrolled into view (Hugo, 2026-11-24; ios/tests/look.sh 01b against 01c).
        host.safeAreaRegions = []
        return host
    }

    /// A new page loaded whole: none of the old page's charts stays.
    func clear() {
        for host in shown.values { host.view.removeFromSuperview() }
        shown.removeAll()
    }

    private func place(_ id: String, _ raw: Any?) {
        guard let view = shown[id]?.view else { return }
        guard let box = raw as? [String: Any], let x = box["x"] as? Double, let y = box["y"] as? Double, let w = box["w"] as? Double, let h = box["h"] as? Double else {
            view.isHidden = true
            return
        }
        view.frame = CGRect(x: x, y: y, width: w, height: h)
        view.isHidden = false
    }
}

extension Color {
    /// A CSS colour as the page writes one: `#rgb`, `#rrggbb`, `rgb(…)` or `rgba(…)`.
    init?(css raw: String?) {
        guard let text = raw?.trimmingCharacters(in: .whitespaces).lowercased(), !text.isEmpty else { return nil }
        if text.hasPrefix("#") {
            var hex = String(text.dropFirst())
            if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
            self.init(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
            return
        }
        guard let open = text.firstIndex(of: "("), let close = text.lastIndex(of: ")") else { return nil }
        let parts = text[text.index(after: open)..<close].split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count >= 3, let r = parts[0], let g = parts[1], let b = parts[2] else { return nil }
        let alpha = parts.count > 3 ? (parts[3] ?? 1) : 1
        self.init(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: alpha)
    }
}
