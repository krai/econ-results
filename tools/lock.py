"""Lock the built page: one HTML file that shows nothing of the registry until it is opened with its key.

    python -m tools.lock --new-key                                   a new key: 43 characters, 256 random bits
    python -m tools.lock site/index.html --out locked/index.html     the page, locked with the key in ECON_SITE_KEY
    python -m tools.lock locked/index.html --open --out page.html    the page again, as a browser opens it

GitHub Pages serves a site to anyone who has its address, and this registry is internal. So the page that goes there
is this one: the built page compressed and encrypted with AES-256-GCM (tools/aesgcm.py), inside a small page that
opens it in the browser with WebCrypto (web/lock.html, web/lock.js). The key is not in the file. It travels in the
link, after the #, which a browser never sends to a server:

    https://HOST/PATH/#k=KEY

Whoever has the link opens the page. Whoever has only the address sees a box to paste the link in. A browser that
opened the page keeps the key, so the address alone works there afterwards; the page's About forgets it.

The key is read from the environment (ECON_SITE_KEY) or from --key-file, never from the command line, where it would
stay in the shell's history and in the list of processes. Anyone who has the link can pass it on, and nobody's access
can be taken away alone: a new key (--new-key, and the page built again) leaves every old link without the pages
built after it, and the pages built before it stay readable to whoever kept both a copy and the old key.
"""
from __future__ import annotations

import argparse
import base64
import html
import os
import re
import secrets
import sys
import zlib

from . import aesgcm

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
FORMAT = "econ-lock/1"  # also what the key authenticates with the page: web/lock.js names the same
ENV = "ECON_SITE_KEY"
KEY = re.compile(r"[A-Za-z0-9_-]{43}")
SEALED = re.compile(r'<script type="application/octet-stream" id="sealed" data-format="([^"]*)" data-iv="([^"]*)">([^<]*)</script>')


def new_key():
    """A new key as it goes in a link: 32 random bytes in base64url, without padding."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def key_bytes(text):
    """The 32 bytes of a key. ValueError for anything that is not 43 characters of base64url."""
    text = (text or "").strip()
    if not KEY.fullmatch(text):
        raise ValueError("a key is 43 characters of letters, digits, - and _ (python -m tools.lock --new-key makes one)")
    return base64.urlsafe_b64decode(text + "=")


def read_text(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def seal(page, key, iv=None):
    """(IV, sealed text) of a page: compressed, then encrypted and authenticated together with the format's name."""
    iv = iv or secrets.token_bytes(12)
    sealed = aesgcm.seal(key_bytes(key), iv, zlib.compress(page.encode("utf-8"), 9), FORMAT.encode("ascii"))
    return (base64.urlsafe_b64encode(iv).rstrip(b"=").decode("ascii"), base64.b64encode(sealed).decode("ascii"))


def lock(page, key, title="KRAI econ results", iv=None):
    """The locked page: web/lock.html with its script and the sealed page put in."""
    script = read_text(os.path.join(WEB, "lock.js"))
    if "</script" in script.lower():
        raise SystemExit("web/lock.js: it would close its own <script> element")
    iv_text, sealed = seal(page, key, iv)
    parts = {"TITLE": html.escape(title), "IV": iv_text, "SEALED": sealed, "SCRIPT": script}
    return re.sub(r"@@([A-Z]+)@@", lambda m: parts[m.group(1)], read_text(os.path.join(WEB, "lock.html")))


def unlock(locked, key):
    """The page inside a locked page. ValueError when it is not a locked page, or the key is not its key."""
    found = SEALED.search(locked)
    if not found or found.group(1) != FORMAT:
        raise ValueError("this is not a page locked as " + FORMAT)
    packed = aesgcm.unseal(key_bytes(key), base64.urlsafe_b64decode(found.group(2) + "=" * (-len(found.group(2)) % 4)),
                           base64.b64decode(found.group(3)), FORMAT.encode("ascii"))
    return zlib.decompress(packed).decode("utf-8")


def the_key(key_file=None):
    """The key from --key-file or the environment. SystemExit when there is none or it is not a key."""
    text = read_text(key_file) if key_file else os.environ.get(ENV)
    if not text:
        raise SystemExit(f"no key: set {ENV}, or give --key-file (python -m tools.lock --new-key makes a key)")
    try:
        key_bytes(text)
    except ValueError as e:
        raise SystemExit(f"{'--key-file' if key_file else ENV}: {e}") from None
    return text.strip()


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m tools.lock", allow_abbrev=False,  # --key must not pass for --key-file
                                 description="Lock the built page with a key that travels in its link.")
    ap.add_argument("page", nargs="?", help="the built page (site/index.html), or with --open a locked one")
    ap.add_argument("--out", help="the file to write")
    ap.add_argument("--open", action="store_true", help="write the page that is inside a locked one")
    ap.add_argument("--key-file", help=f"a file that holds the key (default: the environment's {ENV})")
    ap.add_argument("--title", default="KRAI econ results", help="the locked page's title")
    ap.add_argument("--new-key", action="store_true", help="print a new key and do nothing else")
    a = ap.parse_args(argv)
    if a.new_key:
        print(new_key())
        return 0
    if not a.page or not a.out:
        ap.error("give the page and --out (or --new-key)")
    key, text = the_key(a.key_file), read_text(a.page)
    try:
        out = unlock(text, key) if a.open else lock(text, key, a.title)
    except ValueError as e:
        print(f"{a.page}: {e}")
        return 1
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="") as f:
        f.write(out)
    print(f"{a.out}: {'opened' if a.open else 'locked'}, {len(out.encode('utf-8')):,} bytes (from {len(text.encode('utf-8')):,})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
