#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FLNotifications, NSObject)
RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(post:(NSDictionary *)n resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
// Debug helpers (dev harness only)
RCT_EXTERN_METHOD(debugStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugClear:(NSString *)prefix)
@end
