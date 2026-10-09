#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FLAppShell, RCTEventEmitter)
RCT_EXTERN_METHOD(beginSessionActivity)
RCT_EXTERN_METHOD(endSessionActivity)
RCT_EXTERN_METHOD(bringToFront)
// Debug helpers (dev harness only)
RCT_EXTERN_METHOD(debugInfo:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugKey:(NSString *)key resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugSetHidden:(BOOL)hidden resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
