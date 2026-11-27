#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The text model's vocabulary conversion, shared with Windows: FLScreenModel downloads the pinned unigram.json
/// and this turns it into minilm-ml-vocab.txt ("piece<TAB>score" per line) with the same C++ code the Windows build
/// runs (windows/LarpLess/Native/FLUnigramVocab.h, checked by scripts/embed_bench/unigram-vocab-check.sh).
@interface FLScreenModelVocab : NSObject

/// Nil when the JSON is malformed or has no usable "vocab". The caller still checks the result's SHA-256.
+ (nullable NSData *)vocabFromUnigramJSON:(NSData *)json;

@end

NS_ASSUME_NONNULL_END
