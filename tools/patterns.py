"""What a record must not hold. A public form must hold nothing private; any record, internal too, must hold no
secret: an access token or a private key is not for a repository, however private.

    hits = scan(record)                     [] when nothing forbidden for a public record is in it
    hits = scan(record, words={"name"})     with a private list of extra words, lower case
    hits = secrets(record)                  [] when no access token or private key is in it
    whats = secrets_in_text(text)           the same, of one text (an original file)

Three kinds of rule:
- patterns of things that are private wherever they appear: home and mount paths, drive paths, GPU UUIDs, IPv4
  addresses, e-mail addresses, access tokens and private keys. The last two (SECRETS) are forbidden everywhere;
- field names that only an internal record has (KEYS);
- words: the names of hosts, accounts and storage trees. This file does not name them: it keeps the SHA-256 of each
  word (WORD_SHA256), and a string's words are hashed and compared, so the check can travel with a public form's
  tooling. `python -m tools.patterns WORD ...` prints the digests to add. A word is checked as written and without
  its trailing digits, so a numbered host is covered by its name.
"""
from __future__ import annotations

import hashlib
import re
import sys

REGEXES = (
    ("a home directory", r"/home/|/Users/|/root/"),
    ("a mount or scratch path", r"(?<![\w.])/(?:mnt|tmp|scratch|lustre|gpfs|nfs|srv|opt|var|etc)/"),
    ("a drive path", r"(?<![A-Za-z])[A-Za-z]:[\\/](?!/)"),
    ("a GPU UUID", r"GPU-[0-9a-fA-F]{8}-"),
    ("an IPv4 address", r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])"),
    ("an e-mail address", r"[\w.+-]+@[\w-]+\.[A-Za-z][\w.-]*"),
    ("an access token", r"\bhf_[A-Za-z0-9]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bgithub_pat_|\bsk-[A-Za-z0-9_-]{16,}"
                        r"|\bxox[abpr]-|\bAKIA[0-9A-Z]{16}"),
    ("a private key", r"-----BEGIN [A-Z ]*PRIVATE KEY"),
)
SECRETS = ("an access token", "a private key")  # of REGEXES: what no record and no original file may hold
KEYS = ("provenance", "command", "host", "hostname", "uuid", "job", "data_dir", "endpoint", "user")
WORD_SHA256 = frozenset((
    "d888830fbb8bf967ae22a47ac5f093b3a7e6435027aab7266310cfbf1d257359",
    "b0dea5555379c9e3384dd1e771de9d73db4ee7f9c24725bfe8b757b3768b015f",
    "6196fd3ecdea874b8005b7cd39f11d3c24e7fbf2d40e23a0f28cbeb56d5cf548",
    "ca9cfcfa498aa21bd1c28fd0a3396fd6ddf4d97403d0b7f0ee88ea6b87ee3223",
    "4bb2803f9b6561553e21c2e8f95e65d703b1b6ad6aa4240b4203bd16770a6f9c",
    "ceda6e9f214f36971a08e68183c4ea1f95473a5b83b4c05769c4600816dd8d02",
    "102190285c9edaedde762dafef4755f330716916a58287f8f016999683de6df2",
    "d0ea80a9e2420824acf38d7333d93e89497ba7ed5aa84424d501e5029dad9248",
    "1b483a7f6aaf302ea76ba10869f9076581d20e692a016df59c8a863b65ec14e3",
    "1505e1f8fa878cdc44dec9aded681d7891b63a28249dccd2180a96359a92658d",
))
_COMPILED = tuple((name, re.compile(rx)) for name, rx in REGEXES)
_SECRET = tuple((name, rx) for name, rx in _COMPILED if name in SECRETS)
_WORD = re.compile(r"[A-Za-z0-9_]+")


def digest(word):
    return hashlib.sha256(word.lower().encode("utf-8")).hexdigest()


def forms(word):
    """A word as written and without its trailing digits, lower case."""
    low = word.lower()
    bare = low.rstrip("0123456789")
    return {low, bare} if bare else {low}


def in_text(text, words=frozenset()):
    """What is forbidden in one string: [what], naming the rule and never repeating a private word."""
    hits = [name for name, rx in _COMPILED if rx.search(text)]
    if any(digest(form) in WORD_SHA256 or form in words for word in set(_WORD.findall(text)) for form in forms(word)):
        hits.append("a private name")
    return hits


def scan(doc, words=frozenset(), path="$"):
    """Every forbidden thing in a JSON document: ["path: what"], through all its keys and strings."""
    hits = []
    if isinstance(doc, dict):
        for key, value in doc.items():
            at = f"{path}.{key}"
            if key in KEYS:
                hits.append(f"{at}: a field only an internal record has")
            hits += [f"{at} (the field's name): {h}" for h in in_text(key, words)]
            hits += scan(value, words, at)
    elif isinstance(doc, list):
        for i, value in enumerate(doc):
            hits += scan(value, words, f"{path}[{i}]")
    elif isinstance(doc, str):
        hits += [f"{path}: {h}" for h in in_text(doc, words)]
    return hits


def secrets_in_text(text):
    """The kinds of secret in one text: [what], never repeating the secret."""
    return [name for name, rx in _SECRET if rx.search(text)]


def secrets(doc, path="$"):
    """Every access token or private key in a JSON document: ["path: what"], through all its keys and strings."""
    hits = []
    if isinstance(doc, dict):
        for key, value in doc.items():
            hits += [f"{path}.{key} (the field's name): {h}" for h in secrets_in_text(key)]
            hits += secrets(value, f"{path}.{key}")
    elif isinstance(doc, list):
        for i, value in enumerate(doc):
            hits += secrets(value, f"{path}[{i}]")
    elif isinstance(doc, str):
        hits += [f"{path}: {h}" for h in secrets_in_text(doc)]
    return hits


def load_words(path):
    """A private list of extra words, one per line (# starts a comment), lower case."""
    with open(path, encoding="utf-8") as f:
        return frozenset(line.split("#")[0].strip().lower() for line in f if line.split("#")[0].strip())


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(f'    "{digest(arg)}",')
