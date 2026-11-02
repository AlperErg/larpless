#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FLAppShell, RCTEventEmitter)
RCT_EXTERN_METHOD(beginSessionActivity)
RCT_EXTERN_METHOD(endSessionActivity)
RCT_EXTERN_METHOD(bringToFront)
RCT_EXTERN_METHOD(stopOllama)
RCT_EXTERN_METHOD(hardware:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
