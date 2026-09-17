# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path


root = Path(SPECPATH)
app = root / "app"
assets = root / "assets"
datas = [
    (str(assets / "Shiju.ico"), "."),
    (str(app / "index.html"), "."),
    (str(app / "app.js"), "."),
    (str(app / "dictionary-search.js"), "."),
    (str(app / "styles.css"), "."),
    (str(app / "4 六级-乱序.txt"), "."),
    (str(app / "2 高中-乱序.txt"), "."),
    (str(app / "5 考研-乱序.txt"), "."),
    (str(app / "1 初中-乱序.txt"), "."),
    (str(app / "data" / "words.json"), "data"),
    (str(app / "data" / "dictionary.json"), "data"),
    (str(app / "data" / "ECDICT-LICENSE.txt"), "data"),
    (str(app / "data" / "examples.json"), "data"),
    (str(app / "data" / "phrases.json"), "data"),
    (str(app / "data" / "high-school" / "words.json"), "data/high-school"),
    (str(app / "data" / "high-school" / "examples.json"), "data/high-school"),
    (str(app / "data" / "high-school" / "phrases.json"), "data/high-school"),
    (str(app / "data" / "postgraduate" / "words.json"), "data/postgraduate"),
    (str(app / "data" / "postgraduate" / "examples.json"), "data/postgraduate"),
    (str(app / "data" / "postgraduate" / "phrases.json"), "data/postgraduate"),
    (str(app / "data" / "junior-high" / "words.json"), "data/junior-high"),
    (str(app / "data" / "junior-high" / "examples.json"), "data/junior-high"),
    (str(app / "data" / "junior-high" / "phrases.json"), "data/junior-high"),
]

a = Analysis(
    [str(app / "windows_launcher.py")],
    pathex=[str(app)],
    binaries=[],
    datas=datas,
    hiddenimports=["server", "tkinter", "tkinter.ttk"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Shiju",
    icon=str(assets / "Shiju.ico"),
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="Shiju",
)
