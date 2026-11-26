"""The JSON Schema checker, and the format's own schema."""
import os
import unittest

from tests import sample
from tools import schema

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schema",
                           "econ-run-1.schema.json")

S = {"type": "object", "required": ["n"], "additionalProperties": False,
     "properties": {"n": {"type": "integer", "minimum": 1}, "name": {"type": ["string", "null"], "pattern": "^[a-z]+$"},
                    "items": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/amount"}},
                    "kind": {"enum": ["a", "b"]}},
     "$defs": {"amount": {"type": "number", "exclusiveMinimum": 0}}}


class TestChecker(unittest.TestCase):
    def test_a_fitting_document_has_no_problems(self):
        self.assertEqual(schema.check({"n": 2, "name": None, "items": [0.5], "kind": "a"}, S), [])

    def test_each_keyword_is_enforced(self):
        cases = {"missing": {}, "not integer": {"n": 1.5}, "below": {"n": 0}, "pattern": {"n": 1, "name": "A1"},
                 "extra": {"n": 1, "other": 1}, "min items": {"n": 1, "items": []},
                 "ref": {"n": 1, "items": [0]}, "enum": {"n": 1, "kind": "c"}, "type": {"n": "1"}}
        for name, doc in cases.items():
            with self.subTest(name):
                self.assertTrue(schema.check(doc, S))

    def test_a_boolean_is_not_a_number(self):
        self.assertTrue(schema.check({"n": True}, S))

    def test_a_problem_names_its_path(self):
        self.assertIn("$.items[1]", schema.check({"n": 1, "items": [1, -1]}, S)[0])

    def test_a_keyword_the_checker_does_not_know_is_an_error(self):
        with self.assertRaises(ValueError):
            schema.check({}, {"type": "object", "maxProperties": 1})


class TestFormat(unittest.TestCase):
    def setUp(self):
        self.schema = schema.load(SCHEMA_PATH)

    def test_the_sample_record_fits(self):
        self.assertEqual(schema.check(sample.record(), self.schema), [])

    def test_a_field_outside_the_format_is_refused(self):
        rec = sample.record()
        rec["hostname"] = "x"
        self.assertTrue(schema.check(rec, self.schema))

    def test_a_point_may_carry_fields_of_a_later_econ(self):
        rec = sample.record()
        rec["points"][0]["a_new_number"] = 1.0
        self.assertEqual(schema.check(rec, self.schema), [])

    def test_units_the_schema_can_say(self):
        for path, value in ((("hardware", "gpus"), 0), (("rents",), [0]), (("visibility",), "private"),
                            (("id",), "not-an-id"), (("health", "accuracy", "accuracy"), 1.2)):
            rec = sample.record()
            node = rec
            for key in path[:-1]:
                node = node[key]
            node[path[-1]] = value
            with self.subTest(path):
                self.assertTrue(schema.check(rec, self.schema))


if __name__ == "__main__":
    unittest.main()
