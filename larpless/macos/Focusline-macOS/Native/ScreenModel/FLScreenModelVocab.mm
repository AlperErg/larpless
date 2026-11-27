#import "FLScreenModelVocab.h"

#include <string>
#include <string_view>

// One converter for both platforms (larpless/windows/LarpLess/Native/; standard library only).
#include "../../../../windows/LarpLess/Native/FLUnigramVocab.h"

@implementation FLScreenModelVocab

+ (nullable NSData *)vocabFromUnigramJSON:(NSData *)json
{
  std::string out;
  const std::string_view text{static_cast<const char *>(json.bytes), json.length};
  if (!LarpLess::UnigramVocabJson::Convert(text, out)) {
    return nil;
  }
  return [NSData dataWithBytes:out.data() length:out.size()];
}

@end
