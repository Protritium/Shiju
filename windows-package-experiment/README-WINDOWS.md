# 拾句 Windows 打包实验

该目录与主项目相互独立，只包含应用运行所需的词书、例句、词组和网页资源；没有复制语料库、翻译模型、构建脚本或现有用户数据。

## 先在 Windows 上测试源码版

安装 Python 3.10 或更高版本后，双击 `run-source-windows.cmd`。程序会显示一个小型控制窗口，并自动在默认浏览器打开拾句。关闭控制窗口会停止本地服务，但不会删除学习数据。

## 一键构建 Windows 安装包

在 Windows 10/11 电脑上双击根目录的 `BUILD-INSTALLER.cmd`。构建过程可以完全离线，不需要预先安装 Python、PyInstaller 或 Inno Setup。

脚本会自动完成以下工作：

1. 校验 `offline-tools` 中内置 Python 3.12 安装程序的固定 SHA-256，然后仅安装到本实验目录的 `.tools` 文件夹。
2. 从本地 wheel 文件在隔离环境中安装 PyInstaller；所有包均锁定版本和 SHA-256，不访问 PyPI。
3. 校验内置 Inno Setup 安装程序的固定 SHA-256，然后安装到 `.tools` 文件夹。
4. 构建包含 Python 运行时和全部应用数据的程序。
5. 生成 `output\Shiju-Setup-1.9.0.exe`。

构建脚本会从 `installer\Shiju.iss` 自动读取版本号并核对同名安装包，不再在脚本中另行硬编码版本。因此以后修改 `MyAppVersion` 后，不会因为脚本仍查找旧版本文件名而误报“installer was not found”。

这些构建工具不会加入系统 PATH，也不会在构建期间联网。再次构建时会复用 `.tools`。`.tools`、`build` 和 `dist` 都只是构建缓存；安装包生成后可以删除。

最终使用者只需要获得并双击 `Shiju-Setup-1.9.0.exe`，不需要 Python、PowerShell 命令、Inno Setup 或联网环境。

安装向导使用 Inno Setup 内置的英文界面，以避免依赖未随 Inno Setup 分发的第三方语言包；安装后的拾句应用、词书和学习界面仍为中文。

`installer` 中由 Windows PowerShell 和 Inno Setup 直接解析的脚本刻意只使用 ASCII 字符，以兼容 Windows PowerShell 5、GBK 系统区域以及不同的默认脚本编码。应用界面和词书内容仍正常使用中文 UTF-8。

## 安装后的行为

- 默认安装到 `%LOCALAPPDATA%\Programs\Shiju`，不要求管理员权限。
- 学习数据保存在 `%LOCALAPPDATA%\Shiju\users.json`，与程序文件分离。
- 覆盖安装或卸载程序不会删除学习数据。
- 程序只监听本机 `127.0.0.1`。默认使用端口 `8765`；若该端口被占用或属于 Windows 排除端口范围，会自动申请一个可用端口，不会向局域网开放服务。
- 重复启动时会打开已有学习页面，不会再启动一套服务。
- 登录会话保存在 `%LOCALAPPDATA%\Shiju\sessions.json`，重启程序后默认恢复上次账户；主动退出才会清除会话。
- 程序、安装器、卸载项和快捷方式使用统一的“拾”字图标。
- 安装包内置约 1.5 MB 的 ECDICT 精简词典，词书释义与词典释义同时保留，查询不需要联网。
- 单词、词组和例句朗读优先使用 Windows 自带的 System.Speech/SAPI 英语语音，由本机生成临时 WAV 后立即播放和删除；若系统 SAPI 不可用，再尝试浏览器语音接口。学习内容不会上传。
- 学习页面按 `F2` 可立即朗读当前词组或完整例句，按 `F3` 可打开本地查词；空格不再绑定程序功能，中文输入法可始终用它选择候选词。
- 顶部“查词”支持英文查询和中文反查；例如“偷”会找到 `steal`，“小偷”会找到 `thief`，并提示 `steel / steal` 等常见易混词。主动查词只供临时参考，不改变学习和错题记录。
- 安装目录会生成 `Shiju-User-Guide.txt` 和 `Shiju-User-Guide.md` 两份中文使用手册；开始菜单包含 TXT 手册入口，安装完成页也可直接打开手册。
- 顶部“数据同步”可导出不含密码的 JSON v2 学习备份，也可与 Android 或另一台电脑双向合并。v2 会传播错题/已学状态的删除操作，并按日期合并温习记录；旧 v1 仍可导入，但无法表达旧删除操作。错题完成第 3 次温习后才允许移除。
- 新用户默认打开高中词书和完整例句；已有用户保留本机此前选择。
- 错题温习只有“回忆成功”才累计，同一单词每天最多累计一次；失败词在当轮最多再出现一次。完成当日温习后可进行一次不计数的额外随机温习。

## 为什么需在 Windows 上完成最终构建

PyInstaller 不是交叉编译器：Linux 上生成的是 Linux 可执行文件，无法可靠地产出 Windows `.exe`。因此本目录准备好了完整构建配置，但最终的 EXE 和安装包应在 Windows 机器或 Windows CI 中生成。
