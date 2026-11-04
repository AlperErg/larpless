#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FLSound, NSObject)
RCT_EXTERN_METHOD(play:(NSString *)soundId fadeMs:(double)fadeMs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(setVolume:(double)v)
RCT_EXTERN_METHOD(duck:(double)factor fadeMs:(double)fadeMs)
RCT_EXTERN_METHOD(chime:(NSString *)kind)
@end
