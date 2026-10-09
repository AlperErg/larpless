# notion-hackathon

## Run Focusline on macOS

From the repository root:

```sh
cd focusline
npm install
export LANG=en_US.UTF-8
scripts/run-mac.sh 8081
```

`run-mac.sh` starts Metro on port `8081`, builds the `Focusline-macOS` Debug app, and opens it.

To stop an existing app instance before starting a fresh one:

```sh
pkill -f "$PWD/macos/build/Build/Products/Debug/Focusline.app"
```

To build without launching:

```sh
cd focusline
export LANG=en_US.UTF-8
xcodebuild -workspace macos/Focusline.xcworkspace \
  -scheme Focusline-macOS \
  -configuration Debug \
  build
```
