# 拾句发布包 · 2026-09-17

该程序由“神奇的氕氚”开发。GitHub：https://github.com/Protritium

反馈问题：https://github.com/Protritium/Shiju/issues

| 平台 | 实际版本 | 文件 |
| --- | --- | --- |
| Android | 1.9.20，versionCode 10020 | Shiju-Android.apk |
| Windows | 1.9.0（来自提供的安装包文件名与源码配置） | Shiju-Windows-Setup.exe |

Android APK 已解析验证：包名 `com.shiju.vocabulary`，minSdk 24（Android 7.0），原生库仅 `arm64-v8a`，包含 APK v2 签名块。ZIP 完整性检查通过。签名块存在不等于已完成 Android 系统安装验证，本次未验证与用户已安装版本签名一致，也未在手机实测安装。

Windows 文件识别为 PE 安装程序，尚未在 Windows 实机安装验证，也未验证 Authenticode 状态；不能从安装器 PE32 头推断内部应用只支持 32 位系统。

两个文件都是用户提供的既有产物，仅复制并改为稳定下载文件名，没有重编译或修改字节。此次发布文档中新增开发者署名，并不意味着现有程序内已新增署名，也没有重新进行证书签名。

更新前请使用“数据同步”导出学习记录，特别是 Android 安装失败时不要先卸载旧版。手册提供中英文版本，程序界面仍为中文。

SHA-256：

```text
c71fc3679fde87f5f25b6b2bedb4038e1b5fc41e328fb2549693d3f3d43a5c36  Shiju-Android.apk
caec497967cce9a7fd78f304139b7a91433f42c52b314a390f23f9e96fc20fa2  Shiju-Windows-Setup.exe
```
