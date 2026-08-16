#!/usr/bin/env python3
"""Fail-closed content validation for new and historical EB source bundles."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import stat
import subprocess
import sys
import zipfile

MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_MEMBER_BYTES = 128 * 1024 * 1024
MAX_MEMBERS = 10_000
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
ROOT_EXECUTED_PREFIXES = (".platform/", ".ebextensions/")


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def tracked_blobs(release_sha: str) -> dict[str, str]:
    records = git("ls-tree", "-rz", "--full-tree", release_sha).split(b"\0")
    result: dict[str, str] = {}
    for raw in records:
        if not raw:
            continue
        metadata, raw_name = raw.split(b"\t", 1)
        _mode, object_type, object_id = metadata.decode("ascii").split(" ")
        if object_type != "blob":
            raise ValueError("Release tree contains a non-file entry unsupported by the bundle policy")
        name = raw_name.decode("utf-8", "strict")
        result[name] = object_id
    return result


def legacy_included(name: str) -> bool:
    segments = name.split("/")
    if ".git" in name or ".env" in name:
        return False
    if "tests" in segments or "docs" in segments or ".github" in segments or "logs" in segments:
        return False
    if name.endswith(".zip") or name.endswith(".log") or name.endswith(".txt"):
        return False
    if name in {"debug-data.js", "fix-product-data.js", "fix-variants.js", "test-products.js"}:
        return False
    return True


def normalized_member_name(raw: str) -> str:
    if "\\" in raw or "\x00" in raw or raw.startswith("/"):
        raise ValueError("Source bundle contains an unsafe member name")
    while raw.startswith("./"):
        raw = raw[2:]
    parts = pathlib.PurePosixPath(raw).parts
    if not raw or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Source bundle contains an unsafe member path")
    return "/".join(parts)


def read_regular_members(bundle: pathlib.Path) -> dict[str, tuple[zipfile.ZipInfo, bytes]]:
    if bundle.stat().st_size <= 0 or bundle.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Source bundle archive size is outside policy")
    members: dict[str, tuple[zipfile.ZipInfo, bytes]] = {}
    total = 0
    with zipfile.ZipFile(bundle, "r") as archive:
        infos = archive.infolist()
        if len(infos) > MAX_MEMBERS:
            raise ValueError("Source bundle has too many members")
        for info in infos:
            name = normalized_member_name(info.filename)
            unix_type = (info.external_attr >> 16) & 0o170000
            if unix_type == stat.S_IFLNK:
                raise ValueError("Source bundle symlinks are forbidden")
            if info.is_dir():
                continue
            if unix_type not in {0, stat.S_IFREG}:
                raise ValueError("Source bundle contains a non-regular member")
            if name in members:
                raise ValueError("Source bundle contains a duplicate member")
            if info.file_size < 0 or info.file_size > MAX_MEMBER_BYTES:
                raise ValueError("Source bundle member exceeds the size policy")
            total += info.file_size
            if total > MAX_ARCHIVE_BYTES:
                raise ValueError("Source bundle expanded size exceeds policy")
            members[name] = (info, archive.read(info))
    return members


def validate_bundle(bundle: pathlib.Path, release_sha: str, source_tree: str, version_label: str) -> dict:
    if not FULL_SHA.fullmatch(release_sha) or not FULL_SHA.fullmatch(source_tree):
        raise ValueError("Release SHA and tree must be full lowercase Git hashes")
    if version_label != f"mosaic-{release_sha}":
        raise ValueError("Version label does not match release SHA")

    members = read_regular_members(bundle)
    if any(name.startswith(ROOT_EXECUTED_PREFIXES) for name in members):
        raise ValueError("Source bundle contains forbidden root-executed deployment configuration")
    manifest_entry = members.pop("release-manifest.json", None)
    if manifest_entry is None or len(manifest_entry[1]) > 64 * 1024:
        raise ValueError("Source bundle must contain one bounded release manifest")
    try:
        manifest = json.loads(manifest_entry[1].decode("utf-8", "strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Source bundle release manifest is invalid") from error
    if (
        not isinstance(manifest, dict)
        or manifest.get("commit") != release_sha
        or manifest.get("environment") != "production"
        or manifest.get("deploymentVersion") != version_label
        or manifest.get("schemaVersion") not in {None, 1}
        or manifest.get("sourceTree") not in {None, source_tree}
    ):
        raise ValueError("Source bundle release manifest does not identify the target")

    blobs = tracked_blobs(release_sha)
    is_legacy = manifest.get("sourceTree") is None
    expected = {
        name: object_id
        for name, object_id in blobs.items()
        if not is_legacy or legacy_included(name)
    }
    if set(members) != set(expected):
        missing = len(set(expected) - set(members))
        extra = len(set(members) - set(expected))
        raise ValueError(f"Source bundle members differ from the Git tree (missing={missing}, extra={extra})")
    for name, object_id in expected.items():
        expected_bytes = git("cat-file", "blob", object_id)
        observed_bytes = members[name][1]
        if hashlib.sha256(observed_bytes).digest() != hashlib.sha256(expected_bytes).digest():
            raise ValueError(f"Source bundle content differs from Git for {name}")

    return {
        "schemaVersion": manifest.get("schemaVersion"),
        "commit": release_sha,
        "sourceTree": manifest.get("sourceTree"),
        "environment": "production",
        "deploymentVersion": version_label,
        "bundlePolicy": "legacy-reviewed-exclusions" if is_legacy else "exact-git-tree",
        "verifiedFileCount": len(expected),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True, type=pathlib.Path)
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--source-tree", required=True)
    parser.add_argument("--version-label", required=True)
    args = parser.parse_args()
    result = validate_bundle(args.bundle, args.release_sha, args.source_tree, args.version_label)
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # no archive content is ever echoed
        print(f"EB source bundle validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
