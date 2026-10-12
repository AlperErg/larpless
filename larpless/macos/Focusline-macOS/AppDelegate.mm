#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"LarpLess";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

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
