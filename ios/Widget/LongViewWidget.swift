import AppIntents
import SwiftUI
import WidgetKit

/// The iPhone home-screen widget of Long-View Invest (docs/ios-app.md, "主畫面小工具"): the
/// portfolio's value at the last close, the 7-day change and the line, read at a glance. It asks
/// the site itself with a key of its own, pasted once into its settings, since a free-signed app
/// shares no storage with its widget.
@main
struct LongViewWidgets: WidgetBundle {
    var body: some Widget {
        TotalWidget()
    }
}

/// The widget's one setting: the key made on the push page (更多 → 推播 → 主畫面小工具).
struct KeyIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "長期投資小工具"
    static let description = IntentDescription("貼上 更多 → 推播 產生的鑰匙。")

    @Parameter(title: "鑰匙")
    var key: String?

    init() {}
}

struct FiguresEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
}

struct FiguresProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FiguresEntry {
        FiguresEntry(date: .now, state: .figures(.demo, offline: false))
    }

    func snapshot(for configuration: KeyIntent, in context: Context) async -> FiguresEntry {
        // The widget gallery shows invented figures, never the portfolio's.
        if context.isPreview { return placeholder(in: context) }
        return FiguresEntry(date: .now, state: await FiguresSource.state(for: configuration.key))
    }

    func timeline(for configuration: KeyIntent, in context: Context) async -> Timeline<FiguresEntry> {
        let now = Date()
        let entry = FiguresEntry(date: now, state: await FiguresSource.state(for: configuration.key))
        return Timeline(entries: [entry], policy: .after(FiguresSource.nextRefresh(after: now)))
    }
}

struct TotalWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "LongViewTotal", intent: KeyIntent.self, provider: FiguresProvider()) { entry in
            FiguresView(state: entry.state)
                .containerBackground(for: .widget) { PosterGround() }
                // Opens the dashboard in the app (Reminders.swift `Router`, site paths only).
                .widgetURL(URL(string: "longview://open?path=%2F"))
        }
        .configurationDisplayName("總市值")
        .description("總市值與近 7 天漲跌")
        .supportedFamilies([.systemMedium])
    }
}
