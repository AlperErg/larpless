#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FLOllama, NSObject)
RCT_EXTERN_METHOD(info:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(launch:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(restart:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
