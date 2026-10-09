#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FLWebcam, RCTEventEmitter)
RCT_EXTERN_METHOD(start:(NSDictionary *)opts resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(capturePhoto:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
