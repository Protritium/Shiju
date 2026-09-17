# Android 覆盖升级与数据保留

Android 只有在“应用包名相同、签名证书相同、新 APK 的 versionCode 更高”时，才允许直接覆盖升级。覆盖升级会保留应用私有目录中的账户、累计学习记录、每日统计、错题本和登录会话。

本项目的 GitHub Actions 已改为使用固定签名的 release APK，并根据 GitHub Actions 的 run number 自动增加 versionCode。签名密钥只需创建和配置一次，此后绝对不能更换或丢失。

## 一、只执行一次：创建签名密钥

在安装了 JDK 的电脑上运行：

```bash
keytool -genkeypair -v -keystore shiju-release.jks -alias shiju -keyalg RSA -keysize 4096 -validity 10000
```

请妥善离线备份 `shiju-release.jks` 和密码。不要把 JKS 文件或密码提交到 GitHub 仓库。

## 二、转换为 GitHub Secret

Windows PowerShell：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("shiju-release.jks")) | Set-Clipboard
```

Linux：

```bash
base64 -w 0 shiju-release.jks
```

进入 GitHub 仓库的 `Settings → Secrets and variables → Actions`，增加以下 Repository secrets：

- `SHIJU_KEYSTORE_BASE64`：上一步得到的完整 Base64 文本
- `SHIJU_KEYSTORE_PASSWORD`：JKS 密码
- `SHIJU_KEY_ALIAS`：`shiju`
- `SHIJU_KEY_PASSWORD`：密钥密码

## 三、构建和安装

运行 `Build Android APK` 工作流。下载名为 `shiju-android-release-运行编号` 的构建产物，解压后安装 `app-release.apk`。

从这一固定签名版本开始，以后每次构建得到的新 APK 都可直接覆盖安装，不应再卸载旧版本。账户和学习记录会继续保存在 Android 的应用私有目录中。

项目还配置了 Android 系统备份规则：只备份 `userdata/` 下的账户、学习进度、错题和会话，不备份可由 APK 重新生成的词书静态资源。系统云备份是否实际执行仍取决于手机厂商和用户的备份设置，不能代替对 JKS 密钥的离线保管。

## 从旧 debug APK 迁移

以前的 GitHub 构建使用临时 debug 签名，每次构建的签名可能不同。新的固定签名无法覆盖这些旧 APK，这是 Android 的安全限制，不是应用能够绕过的行为。切换固定签名时可能仍需最后卸载一次；完成这次切换后，后续版本无需再卸载。

在卸载旧版之前不要直接操作。如果旧版中已有重要学习记录，请先保留旧 APK 并备份数据，再进行签名迁移。
