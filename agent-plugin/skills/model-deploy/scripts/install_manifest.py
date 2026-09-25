"""検証済みのフラットなMODを退避・コピーし、ハッシュを照合する。"""
import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def contained(path, root):
    return path == root or root in path.parents


def write_report(path, record):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--mod-root", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--backup")
    parser.add_argument("--report")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    source = Path(args.source).resolve()
    mod_root = Path(args.mod_root).resolve()
    destination_arg = Path(args.destination)
    destination = (destination_arg if destination_arg.is_absolute() else mod_root / destination_arg).resolve()
    require(source.is_dir() and mod_root.is_dir(), "配布フォルダーまたはModルートがありません")
    require(destination != mod_root and contained(destination, mod_root), "導入先がModルートの配下ではありません")
    require(source != destination, "導入元と導入先が同一です")
    require(not destination.exists() or destination.is_dir(), "導入先がフォルダーではありません")
    manifest_path = source / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    files = manifest.get("files")
    require(isinstance(files, dict) and len(files) > 0, "manifestのfiles辞書がありません")
    expected = {}
    folded = set()
    for name, sha in files.items():
        require(isinstance(name, str) and name not in ("", ".", "..")
                and not any(c in name for c in '/\\:<>|?*"')
                and not name.endswith((".", " ")), "manifestのファイル名が不正です")
        require(Path(name).suffix.lower() in {".model", ".mate", ".menu", ".tex"}, "manifestに対象外の拡張子があります")
        require(name.casefold() not in folded, "大文字小文字だけが異なる重複名があります")
        folded.add(name.casefold())
        require(isinstance(sha, str) and re.fullmatch(r"[0-9a-fA-F]{64}", sha), "SHA-256の形式が不正です")
        expected[name] = sha.lower()
    metadata = ["manifest.json"] + (["README.txt"] if (source / "README.txt").is_file() else [])
    for name in metadata:
        expected[name] = digest(source / name)
    before = {}
    for name, sha in expected.items():
        src = source / name
        dst = destination / name
        require(src.resolve().parent == source and src.is_file(), "導入元の参照がフォルダー外または通常ファイルではありません")
        require(dst.resolve().parent == destination and not dst.is_symlink(), "導入先のファイル参照がフォルダー外です")
        require(digest(src) == sha, "導入元のハッシュが一致しません: " + name)
        require(not dst.exists() or dst.is_file(), "導入先に同名のフォルダーがあります")
        before[name] = digest(dst) if dst.exists() else None
    record = {"source": str(source), "destination": str(destination), "status": "checked",
              "files": expected, "before": before, "changed": [], "normal_reload_confirmed": False,
              "visual_checked": False}
    if not args.apply:
        record["would_change"] = [name for name in expected if expected[name] != before[name]]
        print(json.dumps(record, ensure_ascii=False))
        return
    require(args.backup and args.report, "導入には新しい退避先とレポート先が必要です")
    backup = Path(args.backup).resolve()
    report = Path(args.report).resolve()
    require(not backup.exists(), "退避先が既に存在します。新しい場所を指定してください")
    require(not contained(backup, mod_root) and not contained(report, mod_root), "退避先またはレポートがMod検索対象内です")
    require(not contained(report, source) and not contained(report, backup), "レポート先が配布物または退避物と重なっています")
    require(not report.exists(), "検証レポートが既に存在します。新しい場所を指定してください")
    backup.mkdir(parents=True)
    record["backup"] = str(backup)
    try:
        for name, previous in before.items():
            if previous is not None:
                shutil.copyfile(destination / name, backup / name)
                require(digest(backup / name) == previous, "退避中に導入先が変更されました: " + name)
        record["status"] = "backed_up"
        write_report(report, record)
        # 全対象を再照合してから変更を始める。
        for name in expected:
            dst = destination / name
            require((digest(dst) if dst.exists() else None) == before[name], "導入先が退避後に変更されています: " + name)
            require(digest(source / name) == expected[name], "導入元が検査後に変更されています: " + name)
        destination.mkdir(parents=True, exist_ok=True)
        for name, sha in expected.items():
            if before[name] != sha:
                shutil.copyfile(source / name, destination / name)
                record["changed"].append(name)
            require(digest(destination / name) == sha, "導入後のハッシュが一致しません: " + name)
        record["status"] = "installed"
        write_report(report, record)
        print(json.dumps({"status": "installed", "files": len(expected), "changed": len(record["changed"]),
                          "report": str(report)}, ensure_ascii=False))
    except Exception as exc:
        record["status"] = "failed"
        record["error"] = "導入処理に失敗しました: " + str(exc)
        write_report(report, record)
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("導入検証エラー: " + str(error), file=sys.stderr)
        sys.exit(1)
