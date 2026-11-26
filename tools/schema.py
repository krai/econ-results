"""A JSON Schema checker for the keywords that schema/econ-run-1.schema.json uses, on the standard library alone.

    problems = check(doc, load("schema/econ-run-1.schema.json"))      [] when the document fits

Keywords: type, enum, const, pattern, minLength, minimum, maximum, exclusiveMinimum, minItems, required, properties,
additionalProperties, items, anyOf and local $ref (#/$defs/...). Annotations (title, description, $schema, $id) are
skipped; any other keyword is an error of the schema itself, so a keyword this checker does not know cannot pass
unnoticed. A pattern matches anywhere in the string, as JSON Schema says: anchor it with ^ and $.
"""
from __future__ import annotations

import json
import re

ANNOTATIONS = {"$schema", "$id", "$defs", "title", "description"}
KEYWORDS = {"type", "enum", "const", "pattern", "minLength", "minimum", "maximum", "exclusiveMinimum", "minItems",
            "required", "properties", "additionalProperties", "items", "anyOf", "$ref"}
TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def is_type(value, name):
    """Whether a JSON value has the named JSON Schema type; a boolean is never a number."""
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool) or isinstance(value, float) and value.is_integer()
    return isinstance(value, TYPES[name])


def resolve(schema, root):
    """The schema a local $ref points to."""
    ref = schema["$ref"]
    if not ref.startswith("#/"):
        raise ValueError(f"only local references are supported, not {ref}")
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def check(doc, schema, root=None, path="$"):
    """The problems of `doc` against `schema`, each as "path: what is wrong"."""
    root = schema if root is None else root
    unknown = set(schema) - KEYWORDS - ANNOTATIONS
    if unknown:
        raise ValueError(f"{path}: the schema uses keywords this checker does not know: {sorted(unknown)}")
    if "$ref" in schema:
        return check(doc, resolve(schema, root), root, path)
    out = []
    if "anyOf" in schema and all(check(doc, s, root, path) for s in schema["anyOf"]):
        out.append(f"{path}: fits none of the {len(schema['anyOf'])} alternatives")
    if "type" in schema:
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(is_type(doc, n) for n in names):
            return out + [f"{path}: {_show(doc)} is not {' or '.join(names)}"]
    if "const" in schema and doc != schema["const"]:
        out.append(f"{path}: {_show(doc)} is not {_show(schema['const'])}")
    if "enum" in schema and doc not in schema["enum"]:
        out.append(f"{path}: {_show(doc)} is not one of {schema['enum']}")
    if isinstance(doc, str):
        out += _string(doc, schema, path)
    elif isinstance(doc, (int, float)) and not isinstance(doc, bool):
        out += _number(doc, schema, path)
    elif isinstance(doc, list):
        if len(doc) < schema.get("minItems", 0):
            out.append(f"{path}: {len(doc)} items, at least {schema['minItems']} needed")
        if "items" in schema:
            for i, item in enumerate(doc):
                out += check(item, schema["items"], root, f"{path}[{i}]")
    elif isinstance(doc, dict):
        out += _object(doc, schema, root, path)
    return out


def _string(doc, schema, path):
    out = []
    if len(doc) < schema.get("minLength", 0):
        out.append(f"{path}: shorter than {schema['minLength']} characters")
    if "pattern" in schema and not re.search(schema["pattern"], doc):
        out.append(f"{path}: {_show(doc)} does not match {schema['pattern']}")
    return out


def _number(doc, schema, path):
    out = []
    if "minimum" in schema and doc < schema["minimum"]:
        out.append(f"{path}: {doc} is below {schema['minimum']}")
    if "maximum" in schema and doc > schema["maximum"]:
        out.append(f"{path}: {doc} is above {schema['maximum']}")
    if "exclusiveMinimum" in schema and doc <= schema["exclusiveMinimum"]:
        out.append(f"{path}: {doc} is not above {schema['exclusiveMinimum']}")
    return out


def _object(doc, schema, root, path):
    out = [f"{path}: {key} is missing" for key in schema.get("required", []) if key not in doc]
    props, extra = schema.get("properties", {}), schema.get("additionalProperties", True)
    for key, value in doc.items():
        if key in props:
            out += check(value, props[key], root, f"{path}.{key}")
        elif extra is False:
            out.append(f"{path}: {key} is not a field of the format")
        elif isinstance(extra, dict):
            out += check(value, extra, root, f"{path}.{key}")
    return out


def _show(value):
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= 60 else text[:57] + "..."
