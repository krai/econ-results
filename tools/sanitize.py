"""The public form of a record: what may leave the private registry.

    pub = public(record, aliases)       a new record, visibility "public"; the internal one is not changed

What it does:
- drops the provenance (host, job, data folder, command line, commits of private repositories);
- names the node by its alias wherever a text mentions its host name;
- keeps only the file name of every path;
- drops the names of the price list's providers: the arithmetic needs the prices, not who charges them;
- names an image from a personal namespace by what it is ("vLLM nightly 6e780d14 (custom build)");
- says "the local server" for a local address.

It fails closed: after sanitising, the record is scanned for the forbidden patterns (tools/patterns.py), and anything
found is an error, never a warning. Nothing here guesses that a string is safe.
"""
from __future__ import annotations

import copy
import re

from . import patterns

PERSONAL = re.compile(r"^(?!vllm/|nvcr\.io/|ghcr\.io/vllm-project/)[^/\s]+/\S+$")  # an image outside the official ones
PATH = re.compile(r"(?<![\w.:/])(?:~|[A-Za-z]:)?(?:[\\/][\w.+@-]+){2,}")  # two or more segments from a root
ADDRESS = re.compile(r"https?://(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?\S*")


class Forbidden(ValueError):
    """A record that still holds something forbidden after sanitising."""


def basename(match):
    return re.split(r"[\\/]", match.group(0))[-1]


def text(value, aliases):
    """One string, safe: local addresses dropped, paths cut to their file name, host names as their aliases."""
    value = ADDRESS.sub("the local server", value)
    value = PATH.sub(basename, value)
    for host, alias in sorted(aliases.items(), key=lambda kv: -len(kv[0])):
        value = re.sub(rf"(?i)(?<![\w-]){re.escape(host)}(?![\w-])", alias, value)
    return value


def walk(doc, aliases):
    if isinstance(doc, dict):
        return {key: walk(value, aliases) for key, value in doc.items()}
    if isinstance(doc, list):
        return [walk(value, aliases) for value in doc]
    return text(doc, aliases) if isinstance(doc, str) else doc


def image_name(engine):
    """An image as a public record names it: an official image as it is, any other by what it is."""
    image = engine.get("image")
    if not image or not PERSONAL.match(image):
        return image
    what = " ".join(str(x) for x in (engine.get("name"), engine.get("build") if engine.get("build") != "custom" else None,
                                     engine.get("commit") or engine.get("version")) if x)
    return f"{what} (custom build)"


def public(record, aliases, words=frozenset()):
    """The public form of an internal record; Forbidden if anything private is left in it."""
    if record.get("visibility") != "internal":
        raise ValueError("only an internal record is sanitised: this one is already " + str(record.get("visibility")))
    rec = copy.deepcopy(record)
    rec.pop("provenance", None)
    rec["visibility"] = "public"
    rec["engine"]["image"] = image_name(rec["engine"])
    prices = rec.get("prices")
    if prices:
        prices["by_endpoint"] = [{k: v for k, v in e.items() if k not in ("provider", "tag")}
                                 for e in prices.get("by_endpoint") or []]
    rec = walk(rec, aliases)
    hits = patterns.scan(rec, words)
    if hits:
        raise Forbidden(f"{rec['id']}: not safe to publish, {len(hits)} thing(s) left:\n  " + "\n  ".join(hits[:40]))
    return rec
