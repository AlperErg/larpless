#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FLScreenCapture, NSObject)
RCT_EXTERN_METHOD(getActiveWindow:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(capture:(NSDictionary *)opts resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(benchActiveWindow:(nonnull NSNumber *)n resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
