# 公开源码与构建

本仓库现在包含两端源码，来自 `/data1/huangtao/Eng` 的对应打包工程：

- `windows-package-experiment/`：Windows Python 启动器、本地服务、网页界面、词书与词典运行数据、图标、手册、PyInstaller 和 Inno Setup 配置。
- `android-package-experiment/`：Android 原生壳、WebView、TTS、Python 服务、网页与运行数据、Gradle wrapper 和签名配置模板。

仅公开运行与构建所需工程；没有复制原 Git 历史、用户学习记录、私钥、Gradle 缓存、构建产物、离线工具安装器、语料库或翻译模型。第三方 ECDICT 授权文件保留在两端数据目录中。本次没有为整个项目额外指定开源许可证；公开源码与授予任意再分发许可不是同一回事。

## 版本对应

Windows 源码安装器配置版本为 1.9.0。Android 源码默认版本为 1.9.0；在 GitHub Actions 中会使用运行编号生成 `1.9.<编号>` 和 `10000+编号`。现有 APK 的版本是 1.9.20 / 10020，与编号 20 的规则一致，但不能仅凭版本号证明二进制与当前源码逐字节一致。公开源码是当前本地快照，不声称可复现已有安装包的相同哈希。

## Windows 源码运行

在 Windows 安装含 Tk 的 Python 3.10+，进入 `windows-package-experiment`，双击 `run-source-windows.cmd`。从源码构建安装器：

```powershell
cd windows-package-experiment
py -3.12 -m venv .tools/build-venv
.\.tools\build-venv\Scripts\python.exe -m pip install pyinstaller==6.22.0
.\.tools\build-venv\Scripts\python.exe -m PyInstaller --noconfirm --clean Shiju.spec
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" installer\Shiju.iss
```

最后一步需要先安装 Inno Setup 6；成品位于 `output`。原 `BUILD-INSTALLER.cmd` 是离线工具版，需要另外补齐 `offline-tools` 中的 Python、Inno Setup 和 wheels，公开源码仓库不含这些安装器。保留的 `offline-tools/requirements.txt` 记录原工具版本和哈希。

## Android 源码构建

安装 Android Studio、JDK 17 和 Android SDK 35，打开 `android-package-experiment`。调试版可运行 `./gradlew assembleDebug`（Windows 使用 `gradlew.bat`）。

仓库根目录已配置手动 GitHub Actions 工作流 `Build Android APK`。正式版构建前需按照 `android-package-experiment/UPDATE-SIGNING.md` 配置四个 GitHub Secrets，签名密钥不提交到仓库。已有用户要覆盖升级，必须使用原签名证书，且新的 versionCode 应高于已安装版本。新仓库的 Actions 运行编号会重新计数，首次构建的版本可能低于现有 10020，发布前必须检查并调整版本策略。

## 检查范围

复制后会核对来源文件哈希、Python 与 JavaScript 语法、JSON/XML 格式，并检查暂存内容是否包含密钥或用户状态文件。当前环境没有 Windows/Android 完整构建环境，因此不宣称已重新编译或完成实机验证。
