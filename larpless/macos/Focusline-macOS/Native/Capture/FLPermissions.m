#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FLPermissions, NSObject)
RCT_EXTERN_METHOD(status:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(request:(NSString *)kind resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(openSettings:(NSString *)kind resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(relaunch:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
