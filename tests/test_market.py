"""The market snapshot: what makes one hold together, what the page takes of it, and the repository's own."""
import contextlib
import copy
import io
import json
import os
import tempfile
import unittest

from tools import market, write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def snapshot():
    """A made-up snapshot of two models, two GPUs and a few runs: small, and whole."""
    run = lambda key, chip, recipe, conc, speed, tput, out: {  # noqa: E731
        "ix_key": key, "chip": chip, "recipe": recipe, "curve": "2026-01-02", "engine": recipe.split(" ")[0], "precision": "FP8",
        "spec": "", "disagg": False, "gpus": 8, "conc": conc, "p90_tok_s_user": speed, "tok_s_gpu": tput, "in_tok_s_gpu": tput - out,
        "out_tok_s_gpu": out, "hit_measured": 0.9, "hit_trace": 0.95, "ctx_mean": 1000, "date": "2026-01-02",
        "run": "https://example.org/runs/" + str(conc)}
    return {
        "models": [
            {"model": "alpha-1", "name": "Alpha 1", "author": "Alpha Lab", "rank": 1, "tokens_30d": 9e12, "tokens_t": 9.0,
             "share_pct": 60.0, "in_per_out": 50.0, "requests_30d": 1e8, "context": 100000, "params_total": "100B",
             "params_active": "10B", "license": "mit", "hf": "alpha/alpha-1", "openrouter": "alpha/alpha-1",
             "cost_source": "measured", "ix_model": "Alpha-1", "ix_key": "alpha1", "proxy_of": None, "cost_note": None},
            {"model": "beta-2", "name": "Beta 2", "author": "Beta Lab", "rank": 2, "tokens_30d": 6e12, "tokens_t": 6.0,
             "share_pct": 40.0, "in_per_out": 20.0, "requests_30d": 5e7, "context": 100000, "params_total": "50B",
             "params_active": None, "license": "other", "hf": "beta/beta-2", "openrouter": "beta/beta-2",
             "cost_source": "none", "ix_model": None, "ix_key": None, "proxy_of": None, "cost_note": None}],
        "prices": [
            {"id": "alpha-1:1", "model": "alpha-1", "provider": "Cheap Cloud", "endpoint": "alpha/alpha-1", "quantization": "fp8",
             "input": 0.1, "output": 0.4, "cached": 0.01, "cached_listed": True, "discount_pct": 0.0, "context": 100000, "tag": "cheap/fp8"},
            {"id": "alpha-1:2", "model": "alpha-1", "provider": "Dear Cloud", "endpoint": "alpha/alpha-1", "quantization": "fp4",
             "input": 0.3, "output": 1.2, "cached": 0.3, "cached_listed": False, "discount_pct": 25.0, "context": 100000, "tag": "dear"},
            {"id": "beta-2:1", "model": "beta-2", "provider": "Cheap Cloud", "endpoint": "beta/beta-2", "quantization": "unknown",
             "input": 0.2, "output": 0.8, "cached": 0.02, "cached_listed": True, "discount_pct": 0.0, "context": 100000, "tag": "cheap"}],
        "gpus": [
            {"chip": "g1", "gpu": "G1", "vendor": "NVIDIA", "family": "Hopper", "owned_usd_h": 1.0, "rent3y_usd_h": 2.0,
             "ondemand_usd_h": 4.0, "ondemand_min": 3.0, "ondemand_max": 5.0, "ondemand_offers": 2, "tdp_w": 700.0},
            {"chip": "g2", "gpu": "G2", "vendor": "AMD", "family": "CDNA 3", "owned_usd_h": 0.8, "rent3y_usd_h": 1.5,
             "ondemand_usd_h": None, "ondemand_min": None, "ondemand_max": None, "ondemand_offers": 0, "tdp_w": 750.0}],
        "rents": [{"id": "g1:1", "chip": "g1", "gpu": "G1", "provider": "Rent Co", "product": "G1", "usd_h": 3.0, "terms": "on demand",
                   "url": "https://example.org/pricing", "read": "2026-01-02T00:00Z"},
                  {"id": "g1:2", "chip": "g1", "gpu": "G1", "provider": "Other Rent", "product": "G1", "usd_h": 5.0, "terms": "on demand",
                   "url": "https://example.org/other", "read": "2026-01-02T00:00Z"}],
        "throughput": [run("alpha1", "g1", "vllm FP8", 8, 80.0, 4000.0, 40.0), run("alpha1", "g1", "vllm FP8", 32, 40.0, 9000.0, 90.0),
                       run("alpha1", "g1", "sglang FP8", 16, 60.0, 5000.0, 50.0), run("alpha1", "g2", "vllm FP8", 8, 55.0, 3000.0, 30.0)],
        "mlperf": [{"system": "KRAI · G1 · stock", "submission": "aaaa1111", "org": "Krai", "chip": "g1", "gpus": 8, "status": "Provisional",
                    "published": "2026-01-01", "out_tok_s_gpu_at_20": 500.0, "out_tok_s_gpu_at_50": 300.0, "out_tok_s_gpu_at_100": None},
                   {"system": "Other Org · G9 · some stack, 4 GPUs", "submission": "bbbb2222", "org": "Other Org", "chip": "g9", "gpus": 4,
                    "status": "Official", "published": "2026-01-01", "out_tok_s_gpu_at_20": 9000.0, "out_tok_s_gpu_at_50": 8000.0,
                    "out_tok_s_gpu_at_100": 7000.0}],
        "reference": {"deepseek_2025": {"url": "https://example.org/overview", "published": "2025-03-01", "nodes_avg": 10.0, "cost_day": 100}},
        "snapshot": {"schema": "econ-market/1", "as_of": "2026-01-02", "usage_window": "2025-12-03 to 2026-01-01", "tables": {}}}


class TestCheck(unittest.TestCase):
    def test_a_whole_snapshot_has_no_problem(self):
        self.assertEqual(market.check(snapshot()), [])

    def test_what_does_not_hold_together_is_named(self):
        cases = {
            "a price of a model that is not listed": lambda s: s["prices"][0].update(model="gamma-3"),
            "an output price of zero": lambda s: s["prices"][0].update(output=0),
            "a price that is not a number": lambda s: s["prices"][1].update(input="0.3"),
            "the same model twice": lambda s: s["models"].append(copy.deepcopy(s["models"][0])),
            "a cost source that is not one": lambda s: s["models"][0].update(cost_source="guessed"),
            "runs for a model whose cost has no source": lambda s: s["models"][1].update(ix_key="beta2"),
            "a run of no model": lambda s: s["throughput"][0].update(ix_key="gamma3"),
            "a run on a GPU that is not listed": lambda s: s["throughput"][0].update(chip="g7"),
            "a run without its speed": lambda s: s["throughput"][0].update(p90_tok_s_user=None),
            "a GPU without its owned cost": lambda s: s["gpus"][0].update(owned_usd_h=None),
            "an offer for a GPU that is not listed": lambda s: s["rents"][0].update(chip="g7"),
            "a system with no value": lambda s: s["mlperf"][0].update(out_tok_s_gpu_at_20=None, out_tok_s_gpu_at_50=None),
            "no reference case": lambda s: s["reference"].clear(),
            "no date": lambda s: s["snapshot"].update(as_of=""),
        }
        for name, change in cases.items():
            with self.subTest(name):
                snap = snapshot()
                change(snap)
                self.assertTrue(market.check(snap), name)


class TestPage(unittest.TestCase):
    def setUp(self):
        self.page = market.page(snapshot())

    def test_the_page_gets_the_models_by_rank_with_their_count_of_providers(self):
        self.assertEqual([(m["model"], m["providers"]) for m in self.page["models"]], [("alpha-1", 2), ("beta-2", 1)])
        self.assertEqual((self.page["as_of"], self.page["usage_window"]), ("2026-01-02", "2025-12-03 to 2026-01-01"))

    def test_an_endpoint_is_its_prices_and_quantisation_and_not_who_sells_it(self):
        self.assertEqual(self.page["prices"]["alpha-1"], [[0.1, 0.4, 0.01, 1, 0.0, "fp8"], [0.3, 1.2, 0.3, 0, 25.0, "fp4"]])
        text = json.dumps(self.page)
        for name in ("Cheap Cloud", "Dear Cloud", "Rent Co", "Other Org", "cheap/fp8", "http", "example.org"):
            self.assertNotIn(name, text, name)

    def test_runs_are_grouped_into_the_curves_of_one_recipe(self):
        curves = {(c["key"], c["chip"], c["recipe"]): c for c in self.page["curves"]}
        self.assertEqual(sorted(curves), [("alpha1", "g1", "sglang FP8"), ("alpha1", "g1", "vllm FP8"), ("alpha1", "g2", "vllm FP8")])
        first = curves[("alpha1", "g1", "vllm FP8")]
        self.assertEqual((first["engine"], first["gpus"], len(first["runs"])), ("vllm", 8, 2))
        self.assertEqual(dict(zip(self.page["run_fields"], first["runs"][0])),
                         {"p90_tok_s_user": 80.0, "tok_s_gpu": 4000.0, "in_tok_s_gpu": 3960.0, "out_tok_s_gpu": 40.0,
                          "hit_measured": 0.9, "hit_trace": 0.95, "conc": 8, "date": "2026-01-02"})

    def test_a_system_of_ours_keeps_its_name_and_any_other_is_its_hardware_and_software(self):
        ours, other = self.page["mlperf"]
        self.assertEqual((ours["label"], ours["ours"], ours["submission"]), ("KRAI · G1 · stock", True, "aaaa1111"))
        self.assertEqual((other["label"], other["ours"], other["submission"]), ("G9 · some stack, 4 GPUs", False, None))
        self.assertEqual(other["at"], {"20": 9000.0, "50": 8000.0, "100": 7000.0})

    def test_the_reference_case_comes_without_its_address(self):
        self.assertEqual(self.page["reference"], {"published": "2025-03-01", "nodes_avg": 10.0, "cost_day": 100})


class TestFolder(unittest.TestCase):
    def test_a_folder_is_read_and_checked_by_the_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(market.load(tmp))
            snap = snapshot()
            for name in market.TABLES + ("reference", "snapshot"):
                write_json(os.path.join(tmp, name + ".json"), snap[name])
            self.assertEqual(market.load(tmp), snap)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(market.main([tmp]), 0)
            self.assertIn("2 models, 3 priced endpoints, 2 GPUs with 2 on-demand offers, 4 benchmark runs, 2 MLPerf systems", out.getvalue())
            snap["prices"][0]["model"] = "gamma-3"
            write_json(os.path.join(tmp, "prices.json"), snap["prices"])
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(market.main([tmp]), 1)


@unittest.skipUnless(os.path.isfile(os.path.join(ROOT, "market", "snapshot.json")), "the repository has no market snapshot")
class TestOurs(unittest.TestCase):
    def test_the_repositorys_snapshot_holds_together(self):
        snap = market.load()
        self.assertEqual(market.check(snap), [])
        self.assertEqual(len(snap["models"]), len({m["model"] for m in snap["models"]}))
        self.assertTrue(all(snap["snapshot"]["tables"].get(t, {}).get("read") for t in market.TABLES + ("reference",)))

    def test_what_the_page_takes_of_it_names_no_address(self):
        text = json.dumps(market.page(market.load()))
        self.assertNotIn("http", text)
        self.assertLess(len(text), 400_000)


if __name__ == "__main__":
    unittest.main()
