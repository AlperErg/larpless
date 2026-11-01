#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FLFloatingPanel, RCTEventEmitter)
RCT_EXTERN_METHOD(show:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(ensureVisible:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(hide:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(update:(NSDictionary *)state)
RCT_EXTERN_METHOD(setColorScheme:(NSString *)scheme)
// Debug helpers (dev only)
RCT_EXTERN_METHOD(debugSetTrack:(NSDictionary *)track)
RCT_EXTERN_METHOD(debugPerform:(NSDictionary *)action)
@end
