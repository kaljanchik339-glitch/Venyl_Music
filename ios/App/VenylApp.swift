import SwiftUI
import WebKit

@main
struct VenylApp: App {
    var body: some Scene { WindowGroup { VenylView().preferredColorScheme(.dark) } }
}

struct VenylView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> VenylController { VenylController() }
    func updateUIViewController(_ controller: VenylController, context: Context) {}
}

final class VenylController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let site = URL(string: "https://venyl-music.onrender.com/")!
    private var webView: WKWebView!
    private let spinner = UIActivityIndicatorView(style: .large)
    private let errorButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 8/255, green: 8/255, blue: 12/255, alpha: 1)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        spinner.color = UIColor(red: 200/255, green: 169/255, blue: 110/255, alpha: 1)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor), spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
        errorButton.setTitle("Не удалось подключиться. Нажми, чтобы повторить", for: .normal)
        errorButton.titleLabel?.numberOfLines = 0
        errorButton.titleLabel?.textAlignment = .center
        errorButton.tintColor = spinner.color
        errorButton.translatesAutoresizingMaskIntoConstraints = false
        errorButton.addTarget(self, action: #selector(retry), for: .touchUpInside)
        view.addSubview(errorButton)
        NSLayoutConstraint.activate([errorButton.centerYAnchor.constraint(equalTo: view.centerYAnchor), errorButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), errorButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)])
        retry()
    }
    @objc private func retry() {
        errorButton.isHidden = true
        spinner.startAnimating()
        var request = URLRequest(url: site)
        request.timeoutInterval = 90 // Render's first request may take time.
        webView.load(request)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { errorButton.isHidden = true; spinner.startAnimating() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { spinner.stopAnimating() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(error) }
    private func showError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        spinner.stopAnimating(); errorButton.isHidden = false
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" || url.scheme == "blob" || (url.scheme == "https" && url.host == site.host) { decisionHandler(.allow) }
        else { decisionHandler(.cancel); if navigationAction.navigationType == .linkActivated && ["https", "http", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) } }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if url.scheme == "https" && url.host == site.host { webView.load(navigationAction.request) }
            else if ["https", "http", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Venyl", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Venyl", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) }); present(alert, animated: true)
    }
}
