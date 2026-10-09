import SwiftUI
import WebKit

@main
struct VenylApp: App {
    var body: some Scene { WindowGroup { VenylScreen().preferredColorScheme(.dark) } }
}

struct VenylScreen: View {
    @StateObject private var browser = BrowserModel()
    var body: some View {
        ZStack {
            Color(red: 0.067, green: 0.067, blue: 0.059).ignoresSafeArea()
            BrowserView(model: browser).ignoresSafeArea(.container, edges: .bottom)
            if let failure = browser.failure {
                VStack(spacing: 20) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                    Text("Не удалось открыть Venyl").font(.headline)
                    Text(failure).multilineTextAlignment(.center)
                    Button("Повторить") { browser.load() }.buttonStyle(.borderedProminent)
                }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)
            } else if browser.loading {
                VStack { ProgressView().tint(.white); Spacer() }.padding(.top, 12)
            }
        }
    }
}

@MainActor
final class BrowserModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var loading = true
    @Published var failure: String?
    let webView: WKWebView
    private let home = URL(string: "https://venyl-music-kolya.xcd7mxsyb5.chatgpt.site/?mobile=1")!

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = true
        load()
    }

    func load() {
        failure = nil
        loading = true
        webView.load(URLRequest(url: home, cachePolicy: .reloadRevalidatingCacheData))
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loading = true
        failure = nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    private func failed(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        loading = false
        failure = "Проверь подключение к интернету. " + error.localizedDescription
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loading = false
        failure = "iOS завершила процесс страницы. Открой Venyl заново."
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "https" || url.scheme == "about" || url.scheme == "blob" {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if ["mailto", "tel"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, action.request.url?.scheme == "https" { webView.load(action.request) }
        return nil
    }
    private func present(_ alert: UIAlertController) {
        guard let root = webView.window?.rootViewController else { return }
        var top = root
        while let shown = top.presentedViewController { top = shown }
        top.present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard webView.window != nil else { completionHandler(false); return }
        let alert = UIAlertController(title: "Venyl", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Подтвердить", style: .default) { _ in completionHandler(true) })
        present(alert)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard webView.window != nil else { completionHandler(); return }
        let alert = UIAlertController(title: "Venyl", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert)
    }
}

struct BrowserView: UIViewRepresentable {
    let model: BrowserModel
    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
