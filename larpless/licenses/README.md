# Third-party licence texts

Licences that npm and CocoaPods don't supply, for things bundled by hand: the Inter and Instrument Serif fonts (`OFL-1.1.txt`), the Ultralytics YOLO11n model (`AGPL-3.0.txt`, copied from the `ultralytics` package; the app's own `LICENSE` is the same text), the models the app downloads at onboarding (`Apache-2.0.txt`, from apache.org) and ONNX Runtime on Windows (`MIT-onnxruntime.txt`, from its NuGet package). `scripts/acknowledgements.mjs` reads them through its `EXTRAS` list, adds each component's copyright line, and writes `src/legal/acknowledgements.json` for the in-app Acknowledgements page.

When you bundle a new font, model or other file by hand, add its licence here and an entry to `EXTRAS`, then run `node scripts/acknowledgements.mjs`.
