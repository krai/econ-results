"""The exporter: what it reads of a run's files, and econ's real files of every version in the registry.

The second half needs econ itself (ECON_SRC: the src folder of a gentic checkout at the commit of ECON_REF) and the
registry's original files, which are in this repository under sources/. Without them those tests are skipped, and
say why."""
import os
import tempfile
import unittest

from tools import export, patterns, read_json, sanitize, validate, write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ECON_SRC = os.environ.get("ECON_SRC")
REAL = bool(ECON_SRC) and os.path.isfile(os.path.join(ROOT, "manifest.json"))
WHY = "needs ECON_SRC (the src folder of a gentic checkout) and the registry's own files (manifest.json, sources/)"


class TestPieces(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def path(self, *parts):
        path = os.path.join(self.tmp.name, *parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def test_a_provenance_file_gives_its_words_and_the_versions_inside_the_image(self):
        path = self.path("provenance.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write("job=4242 host=box label=cfg start=2026-01-05T10:00:00-06:00\n"
                    "econ=/x/econ commit=0123abc tree=89ef\n"
                    "image=vllm/vllm-openai:v1.2.0 digest=vllm/vllm-openai@sha256:" + "ab" * 32 + "\n"
                    "inside: vllm 1.2.0 | torch 2.14.0+cu130 | CUDA 13.0\n")
        prov = export.parse_provenance(path)
        self.assertEqual((prov["job"], prov["commit"]), ("4242", "0123abc"))
        self.assertEqual(prov["inside"], {"vllm": "1.2.0", "torch": "2.14.0+cu130", "cuda": "13.0"})
        engine = export.engine_of("vllm/vllm-openai:v1.2.0", {}, prov)
        self.assertEqual(engine["digest"], "sha256:" + "ab" * 32)

    def test_the_engine_of_a_release_image_is_its_tag(self):
        engine = export.engine_of("vllm/vllm-openai:v0.34.0", {}, {})
        self.assertEqual((engine["version"], engine["build"], engine["commit"]), ("0.34.0", "release", None))

    def test_the_engine_of_another_image_is_a_build_of_a_commit(self):
        engine = export.engine_of("someone/vllm-6e780d14-nsys-withsrc:v1.0", {}, {})
        self.assertEqual((engine["version"], engine["build"], engine["commit"]), (None, "nightly", "6e780d14"))
        self.assertEqual(export.engine_of("someone/server:latest", {}, {})["build"], "custom")

    def test_an_endpoint_run_takes_its_engine_from_what_is_stated(self):
        engine = export.engine_of(None, {"engine_version": "0.31.0", "engine_build": "release"}, {})
        self.assertEqual((engine["version"], engine["build"], engine["image"]), ("0.31.0", "release", None))

    def test_the_family_comes_from_the_label_unless_stated(self):
        def config(label, flags=(), **spec):
            return export.config_of({"config": label, "flags": list(flags)}, spec)
        self.assertEqual(config("recipe-tp4-v0.34")["family"], "recipe")
        self.assertEqual(config("kernels-s1-tp8")["family"], "S1")
        self.assertEqual(config("s0-tp8-v0.34")["family"], "S0")
        self.assertEqual(config("qwen3-8b-fp8-a5000")["family"], "stock")
        self.assertEqual(config("qwen3-8b", family="recipe", variant="context 4096")["variant"], "context 4096")

    def test_tp_and_dp_come_from_the_flags_then_from_the_label(self):
        c = export.config_of({"config": "x-tp4", "flags": ["--tensor-parallel-size", "8", "--data-parallel-size", "2"]}, {})
        self.assertEqual((c["tp"], c["dp"]), (8, 2))
        c = export.config_of({"config": "recipe-tp4-v0.34", "flags": []}, {})
        self.assertEqual((c["tp"], c["dp"]), (4, None))
        self.assertEqual(export.config_of({"config": "plain", "server_config": "/a/b/c.yaml"}, {})["server_config"], "c.yaml")

    def test_a_run_folder_is_found_in_either_layout(self):
        for name in ("measure/measure.json", "check/check.json", "provenance.txt"):
            write_json(self.path("a", name), {})
        write_json(self.path("b", "measure.json"), {})
        found = export.discover(os.path.join(self.tmp.name, "a"))
        self.assertTrue(found["measure"].endswith("measure.json") and found["check"] and found["provenance"])
        self.assertIsNone(found["accuracy"])
        self.assertTrue(export.discover(os.path.join(self.tmp.name, "b"))["measure"])
        self.assertIsNone(export.discover(os.path.join(self.tmp.name, "c"))["measure"])

    def test_a_manifest_resolves_its_paths_from_its_own_folder(self):
        path = self.path("reg", "manifest.json")
        write_json(path, {"aliases": "aliases.json", "runs": [{"run": "sources/x", "prices": "sources/p.json", "rents": [1.0],
                                                            "public": True, "note": "why"}]})
        specs, aliases = export.manifest_specs(path)
        base = os.path.dirname(path)
        self.assertEqual(specs[0]["run"], os.path.join(base, "sources", "x"))
        self.assertEqual(aliases, os.path.join(base, "aliases.json"))
        write_json(path, {"runs": [{"run": "x", "typo_field": 1}]})
        with self.assertRaises(SystemExit):
            export.manifest_specs(path)

    def test_a_report_can_stand_in_for_its_price_snapshot(self):
        path = self.path("report.json")
        endpoints = [{"provider": "P", "quantization": "fp8", "input": 0.3, "output": 1.2, "cached_input": None}]
        write_json(path, {"kind": "report", "prices": {"model": "org/m", "taken": "2026-01-05T09:00Z", "source": "s",
                                                       "endpoints": 1, "by_endpoint": endpoints}})
        snap = export.snapshot(path)
        self.assertEqual((snap["model"], snap["taken"], snap["endpoints"]), ("org/m", "2026-01-05T09:00Z", endpoints))
        write_json(path, {"kind": "report", "prices": {"model": "org/m", "taken": "t"}})
        with self.assertRaises(SystemExit):
            export.snapshot(path)

    def test_pruning_removes_only_the_records_that_were_not_exported(self):
        folder = self.path("runs", "keep.json")
        for name in ("keep.json", "stale.json", "notes.txt"):
            with open(self.path("runs", name), "w", encoding="utf-8") as f:
                f.write("{}")
        self.assertEqual(export.prune(os.path.dirname(folder), {"keep"}), ["stale"])
        self.assertEqual(sorted(os.listdir(os.path.dirname(folder))), ["keep.json", "notes.txt"])
        self.assertEqual(export.prune(self.path("missing", "x")[:-2], set()), [])

    def test_a_file_entry_is_the_name_the_hash_and_the_size(self):
        path = self.path("measure.json")
        with open(path, "wb") as f:
            f.write(b"{}\n")
        entry = export.file_entry("measure", path)
        self.assertEqual((entry["name"], entry["bytes"]), ("measure.json", 3))
        self.assertEqual(entry["sha256"], "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356")


@unittest.skipUnless(REAL, WHY)
class TestRealFiles(unittest.TestCase):
    """econ's own files, one test per version of econ in the registry."""

    @classmethod
    def setUpClass(cls):
        cls.econ = export.Econ(ECON_SRC)
        cls.aliases = read_json(os.path.join(ROOT, "aliases.json"))
        cls.specs = export.manifest_specs(os.path.join(ROOT, "manifest.json"))[0]

    def source(self, *parts):
        return os.path.join(ROOT, "sources", *parts)

    def export(self, **spec):
        rec = export.export(spec, self.econ)
        self.assertEqual(validate.check_record(rec), [])
        return rec

    def test_measure_json_of_econ_0_0_3(self):
        rec = self.export(measure=self.source("2026-11-03_a5000", "context-4096", "measure.json"),
                          prices=self.source("2026-11-03_a5000", "prices_qwen3-14b.json"), rents=[0.27, 0.16], family="stock",
                          engine_version="0.31.0")
        self.assertEqual((rec["econ"]["version"], rec["econ"]["exporter"]["source"]), ("0.0.3", "measure.json"))
        self.assertEqual([p["met"] for p in rec["points"]], [True])
        self.assertEqual(len(rec["results"][0]["windows"]), 2)
        self.assertEqual(rec["stability"]["from"], "power.csv")  # no stability of its own before 0.0.6
        self.assertIn("power", [f["role"] for f in rec["files"]])
        self.assertIsNotNone(rec["points"][0]["p90_tpot_ms"])
        self.assertIsNone(rec["points"][0].get("pooled"))        # no intervals before 0.0.5

    def test_a_missed_target_of_econ_0_0_3(self):
        rec = self.export(measure=self.source("2026-11-03_a5000", "context-8192", "measure.json"),
                          prices=self.source("2026-11-03_a5000", "prices_qwen3-14b.json"), rents=[0.27], family="stock")
        self.assertEqual([p["met"] for p in rec["points"]], [False])
        self.assertIsNone(rec["points"][0].get("worth"))
        self.assertTrue(rec["curve"]["points"])

    def test_report_json_of_econ_0_0_5(self):
        report = self.source("2026-11-02_h200", "report-0.0.5", "report.json")
        rec = self.export(report=report, config="recipe-tp4-v0.32", measured_with="0.0.3")
        self.assertEqual(rec["econ"]["exporter"]["source_version"], "0.0.5")
        self.assertEqual((rec["engine"]["version"], rec["config"]["family"], rec["config"]["tp"]), ("0.32.0", "recipe", 4))
        old = [p for p in read_json(report)["points"] if p["config"] == "recipe-tp4-v0.32"]
        self.assertEqual([p["met"] for p in rec["points"]], [True, False])
        self.assertEqual(rec["points"][0]["worth"], old[0]["worth"])   # priced again: the same numbers
        self.assertIn("cost", rec["points"][0])                         # which a 0.0.5 report did not have
        self.assertIsNone(rec["results"][0]["windows"])
        self.assertFalse(any("nightly" in n for n in rec["not_covered"]))

    def test_a_report_needs_the_version_that_measured_and_a_configuration_it_has(self):
        report = self.source("2026-11-02_h200", "report-0.0.5", "report.json")
        with self.assertRaises(SystemExit):
            export.export({"report": report, "config": "recipe-tp4-v0.32"}, self.econ)
        with self.assertRaises(SystemExit):
            export.export({"report": report, "config": "no-such", "measured_with": "0.0.3"}, self.econ)

    def test_report_json_of_econ_0_0_6(self):
        rec = self.export(report=self.source("2026-11-03_a5000", "report-0.0.6", "report.json"), config="qwen3-8b-fp8-a5000-ctx4096",
                          measured_with="0.0.3", family="stock")
        self.assertEqual(rec["econ"]["exporter"]["source_version"], "0.0.6")
        self.assertEqual(rec["stability"]["verdict"], "WARN")
        self.assertIsNotNone(rec["points"][0]["sm_clock_mhz"])

    def test_measure_json_of_econ_0_0_7(self):
        rec = self.export(run=self.source("2026-11-17_h200", "s0-tp8-v0.34"), rents=[5.29, 3.59],
                          prices=self.source("2026-11-17_h200", "prices_deepseek-v4.1-flash_2026-11-18.json"))
        self.assertEqual((rec["econ"]["version"], rec["config"]["family"], rec["config"]["tp"]), ("0.0.7", "S0", 8))
        self.assertEqual([p["met"] for p in rec["points"]], [True] * 4)
        self.assertEqual((rec["health"]["check"]["verdict"], rec["health"]["check"]["warnings"]), ("WARN", 8))
        self.assertEqual((rec["health"]["accuracy"]["correct"], rec["health"]["accuracy"]["items"]), (44, 50))
        self.assertTrue(rec["provenance"]["job"].isdigit())  # read from the run's provenance.txt
        self.assertEqual(rec["hardware"]["gpus_on_node"], 8)
        self.assertEqual(rec["power"]["scope"], "GPU boards")
        self.assertTrue(rec["engine"]["digest"].startswith("sha256:"))

    def test_measure_json_of_econ_0_0_9(self):
        run = self.source("2026-11-23_h200", "recipe-tp4-v0.34-e009")
        rec = self.export(run=run, rents=[5.29, 3.59], prices=os.path.join(run, "report", "report.json"))
        self.assertEqual((rec["econ"]["version"], rec["econ"]["commit"][:7]), ("0.0.9", "bfc3bc7"))
        self.assertEqual([p["tpot_limit"] for p in rec["points"] if p["met"]], [50.0, 30.0, 20.0])
        self.assertEqual(rec["health"]["check"]["status"], {"PASS": 74, "INFO": 12})
        self.assertEqual(rec["prices"]["taken"], "2026-11-23T16:41Z")
        self.assertEqual(rec["hardware"]["node"], rec["provenance"]["host"])  # as the measurement says it
        self.assertEqual(sanitize.public(rec, self.aliases)["hardware"]["node"], self.aliases[rec["provenance"]["host"]])

    def test_the_registry_is_what_the_manifest_exports(self):
        """Every record of the registry, and every public form, is byte for byte what its sources give today."""
        words = patterns.load_words(os.path.join(ROOT, "private-words.txt"))
        seen = set()
        for spec in self.specs:
            rec = export.export(spec, self.econ)
            seen.add(rec["id"])
            with self.subTest(rec["id"]):
                self.assertEqual(rec, read_json(os.path.join(ROOT, "runs", rec["id"] + ".json")))
                twin = os.path.join(ROOT, "public", rec["id"] + ".json")
                self.assertEqual(os.path.isfile(twin), bool(spec.get("public")))
                if spec.get("public"):
                    pub = sanitize.public(rec, self.aliases, words)
                    self.assertEqual(pub, read_json(twin))
                    self.assertEqual(validate.check_record(pub, public=True, words=words), [])
        on_disk = {n[:-5] for n in os.listdir(os.path.join(ROOT, "runs")) if n.endswith(".json")}
        self.assertEqual(seen, on_disk)


if __name__ == "__main__":
    unittest.main()
