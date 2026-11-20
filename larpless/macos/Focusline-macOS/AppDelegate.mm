#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTDevLoadingViewSetEnabled.h>
#import <React/RCTHTTPRequestHandler.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

/// PRIVACY: nothing the app sends or receives over HTTP is kept on disk. React Native's fetch/XHR (Ollama, Supabase)
/// would otherwise run on the default NSURLSession, whose NSURLCache stores responses together with their requests in
/// ~/Library/Caches/<bundle id>/Cache.db: a cached POST /api/chat held a whole base64 screenshot. RN's session is
/// ephemeral instead (no disk cache, cookies or credentials), and the shared cache, which every other default-config
/// session (Sparkle's appcast check) picks up, holds nothing. Runs before React Native starts, so its first request
/// already uses this. __tests__/native/privacy.test.ts checks it.
static void FLInstallPrivateNetworking(void)
{
  NSFileManager *fm = NSFileManager.defaultManager;
  // Earlier builds used the disk cache: delete what they left (it can hold a screenshot sent to Ollama). Only
  // CFNetwork's files; Core ML's compiled-model cache in the same folder stays.
  NSURL *caches = [fm URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier;
  if (caches != nil && bundleId.length > 0) {
    NSURL *dir = [caches URLByAppendingPathComponent:bundleId isDirectory:YES];
    for (NSString *name in @[ @"Cache.db", @"Cache.db-wal", @"Cache.db-shm", @"fsCachedData" ]) {
      [fm removeItemAtURL:[dir URLByAppendingPathComponent:name] error:nil];
    }
  }

  NSURLCache.sharedURLCache = [[NSURLCache alloc] initWithMemoryCapacity:0 diskCapacity:0 directoryURL:nil];
  RCTSetCustomNSURLSessionConfigurationProvider(^NSURLSessionConfiguration * {
    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.URLCache = nil;
    configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    return configuration;
  });
}

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  FLInstallPrivateNetworking();

  self.moduleName = @"LarpLess";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

  // RN's "Downloading 100%" banner is a sheet on [NSApp keyWindow], and its hide only ends sheets on the
  // key window at that moment. When the app isn't frontmost as the bundle loads, nothing is key, the
  // sheet never closes and it blocks the main window. Metro's log already shows bundle progress.
  RCTDevLoadingViewSetEnabled(NO);

  [super applicationDidFinishLaunching:notification];

  // Dock, window chrome and notification banners all read the AppIcon asset catalog entry.
  NSImage *appIcon = [NSImage imageNamed:@"AppIcon"];
  if (appIcon != nil) {
    [NSApp setApplicationIconImage:appIcon];
  }

  // LarpLess main window: 1100x720 by default (unless a saved frame exists), min 900x600.
  NSWindow *window = self.window;
  window.title = @"LarpLess";
  window.contentMinSize = NSMakeSize(900, 600);
  window.releasedWhenClosed = NO;
  if (![window setFrameUsingName:@"RCTAppDelegateMainWindow"]) {
    [window setContentSize:NSMakeSize(1100, 720)];
    [window center];
  }
  // Same canvases as src/ui/theme.ts, so the window matches the boot cover before JS paints.
  [self fl_syncWindowBackground];
}

/// Light paper or the site's dark canvas, following the system appearance.
- (void)fl_syncWindowBackground
{
  NSWindow *window = self.window;
  if (window == nil) return;
  NSAppearanceName match = [window.effectiveAppearance bestMatchFromAppearancesWithNames:@[
    NSAppearanceNameDarkAqua, NSAppearanceNameAqua]];
  BOOL dark = [match isEqualToString:NSAppearanceNameDarkAqua];
  window.backgroundColor = dark
    ? [NSColor colorWithSRGBRed:16.0 / 255.0 green:17.0 / 255.0 blue:15.0 / 255.0 alpha:1]
    : [NSColor colorWithSRGBRed:243.0 / 255.0 green:245.0 / 255.0 blue:248.0 / 255.0 alpha:1];
}

// Keep running when the main window closes: the floating panel and the session live on.
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender
{
  return NO;
}

// Clicking the Dock icon brings the main window back.
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag
{
  if (!flag) {
    [self.window makeKeyAndOrderFront:self];
  }
  return YES;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
