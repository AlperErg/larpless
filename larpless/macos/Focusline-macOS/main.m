#import <Cocoa/Cocoa.h>
#include <stdlib.h>

int main(int argc, const char *argv[]) {
  // PRIVACY: ONNX Runtime (the on-device screen model) sends usage telemetry to Microsoft by default and keeps a
  // device ID and an event queue under ~/Library/Application Support/Microsoft/DeveloperTools/.onnxruntime. Only
  // this variable, set before the first OrtEnv exists, stops all of it: OrtApi::DisableTelemetryEvents comes too
  // late, because the telemetry starts with the env. __tests__/native/privacy.test.ts checks this line.
  setenv("ORT_DISABLE_TELEMETRY", "1", 1);
  return NSApplicationMain(argc, argv);
}
