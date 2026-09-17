from pathlib import Path
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parent / "assets"
EXPECTED = {
    "Shiju-Android.apk": "c71fc3679fde87f5f25b6b2bedb4038e1b5fc41e328fb2549693d3f3d43a5c36",
    "Shiju-Windows-Setup.exe": "caec497967cce9a7fd78f304139b7a91433f42c52b314a390f23f9e96fc20fa2",
}

for name, expected in EXPECTED.items():
    data = (ROOT / name).read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise SystemExit(f"SHA-256 mismatch: {name}")
    print(f"OK {name}: {actual}")
with zipfile.ZipFile(ROOT / "Shiju-Android.apk") as apk:
    if apk.testzip() is not None:
        raise SystemExit("APK ZIP integrity failure")
print("APK archive integrity OK. Installation and signature verification are separate checks.")
