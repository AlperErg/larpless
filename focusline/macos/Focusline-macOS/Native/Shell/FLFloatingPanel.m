#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FLFloatingPanel, RCTEventEmitter)
RCT_EXTERN_METHOD(show:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(hide:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(update:(NSDictionary *)state)
// Debug helpers (dev harness only)
RCT_EXTERN_METHOD(debugInfo:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugSetHover:(BOOL)on)
RCT_EXTERN_METHOD(debugPerform:(NSDictionary *)action)
RCT_EXTERN_METHOD(debugClick:(NSString *)buttonId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugDrag:(double)dx dy:(double)dy resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugRenderText:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugSampleBg:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugDeactivateApp:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugActivateApp:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
