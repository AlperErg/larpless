#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FLPing, RCTEventEmitter)
RCT_EXTERN_METHOD(ping:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
