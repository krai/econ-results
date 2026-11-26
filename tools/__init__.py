"""The tools of econ-results: export a run of econ as an econ-run/1 record, add it to the registry, check records,
build the page from them, lock it, and write a record's public form. Every module runs as `python -m tools.NAME` from
the repository's root on Python's standard library; the two that export (export, add) also import econ from a gentic
checkout."""
import hashlib
import json
import re

SCHEMA = "econ-run/1"


def slug(label):
    """A label as it goes into an id: lower case, with anything but letters, digits, dots and dashes as a dash."""
    return re.sub(r"[^a-z0-9.-]+", "-", label.lower()).strip("-.") or "run"


def run_id(label, created, model, gpus):
    """The id of a run: its date, its label and eight hex digits that tell apart two runs of one label on one day.
    It depends only on what the measurement says of itself, so the same run exported again keeps its id."""
    digest = hashlib.sha256(f"{label}|{created}|{model}|{gpus}".encode("utf-8")).hexdigest()
    return f"{created[:10]}_{slug(label)}_{digest[:8]}"


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, doc):
    """A JSON file with LF line ends on every platform, so its bytes (and its hash) are the same everywhere."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
