"""Build the dependency-free Chrome installation ZIP from an explicit allowlist."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
FILES = ("manifest.json", "content.js", "README.md", "Installation and Usage.txt", "LICENSE")


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    output = ROOT / "downloads" / f"x-post-deleter-{manifest['version']}.zip"
    output.parent.mkdir(exist_ok=True)
    for name in FILES:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(name)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name in FILES:
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            content = (ROOT / name).read_text(encoding="utf-8").replace("\r\n", "\n")
            archive.writestr(info, content.encode("utf-8"))
    print(f"Created {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
