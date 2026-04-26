import UIKit
import Capacitor
import ObjectiveC.runtime

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        installWebViewInputAccessoryHider()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        hideWebViewInputAccessoryBars()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

private extension AppDelegate {
    func installWebViewInputAccessoryHider() {
        NotificationCenter.default.addObserver(
            forName: UIResponder.keyboardWillShowNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.hideWebViewInputAccessoryBars()
        }

        [0.1, 0.5, 1.0].forEach { delay in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.hideWebViewInputAccessoryBars()
            }
        }
    }

    func hideWebViewInputAccessoryBars() {
        guard let rootView = window?.rootViewController?.view else { return }
        hideWebViewInputAccessoryBars(in: rootView)
    }

    func hideWebViewInputAccessoryBars(in view: UIView) {
        let className = NSStringFromClass(type(of: view))
        if className.contains("WKContent") {
            replaceInputAccessoryView(for: view)
        }

        view.subviews.forEach { hideWebViewInputAccessoryBars(in: $0) }
    }

    func replaceInputAccessoryView(for view: UIView) {
        guard let currentClass = object_getClass(view) else { return }
        let currentClassName = NSStringFromClass(currentClass)
        if currentClassName.hasSuffix("_AURA_NoInputAccessory") { return }

        let replacementName = "\(currentClassName)_AURA_NoInputAccessory"
        let replacementClass: AnyClass

        if let existingClass = NSClassFromString(replacementName) {
            replacementClass = existingClass
        } else {
            guard let allocatedClass = objc_allocateClassPair(currentClass, replacementName, 0) else { return }
            let block: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
            let implementation = imp_implementationWithBlock(block)
            class_addMethod(
                allocatedClass,
                NSSelectorFromString("inputAccessoryView"),
                implementation,
                "@@:"
            )
            objc_registerClassPair(allocatedClass)
            replacementClass = allocatedClass
        }

        object_setClass(view, replacementClass)
    }
}
