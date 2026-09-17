# 发布操作说明

建议仓库：`Protritium/Shiju`。此目录包含公开源码快照和发布文档，不替代原 Eng 开发目录。两端源码及构建说明见 SOURCE.md。仓库名称变更时同步修改两份 README 链接。

1. 在 GitHub 创建公开空仓库 Shiju，不要勾选自动添加 README。
2. 在此目录完成 GitHub CLI 登录：`gh auth login`。不要将令牌写入仓库。
3. 提交文档，添加远端并上传：

```bash
git remote add origin https://github.com/Protritium/Shiju.git
git push -u origin main
```

4. 先校验二进制文件，建立草稿 Release：

```bash
python3 verify_assets.py
gh release create v1.9-release --target main --draft --title "拾句 · Windows 1.9.0 / Android" --notes-file RELEASE_NOTES.md assets/Shiju-Windows-Setup.exe assets/Shiju-Android.apk assets/SHA256SUMS.txt
```

5. 在 GitHub Releases 检查草稿的版本说明和附件，确认安装测试后发布。README 的 latest 下载链接只在发布后生效。

不要把安装包提交进 Git 历史，使用 Releases 附件。首次发布后更新应继续保留统一附件名。APK 不能仅凭文件名断言版本或签名；请参考发布记录中的实际检查结果。不要更换签名后假定可覆盖安装。

用户提供的 EXE/APK 本次仅复制并改分发文件名，内容保持一致。程序界面如需增加“神奇的氕氚”署名或 Issue 按钮，需要修改原源码并重编译；不能通过改安装包字节完成，否则会破坏已有签名和完整性。
