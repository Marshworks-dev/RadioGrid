import Capacitor

/// The app's web view. Plugins that live in this target (not in an npm
/// package) are registered here, before the page loads.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BackupPlugin())
    }
}
