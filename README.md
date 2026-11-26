<p align="center">
  <a href="https://krai.github.io/econ-results/"><img src="assets/banner.svg" alt="KRAI — econ results: what a serving configuration sells within a latency target" width="100%"></a>
</p>

# KRAI econ results

The registry of KRAI's **econ** runs and the page that shows them together.

econ measures what a serving configuration can sell within a latency target (the 99th percentile of the time to
first token and of the time per output token), with the power of the GPU boards, and prices it at what providers
charge for the model: USD per GPU-hour, and the cost of a million tokens.

**→ [krai.github.io/econ-results](https://krai.github.io/econ-results/)**

## What the page shows

| Section | Contents |
|---|---|
| Explore | Every configuration as a curve through its met latency targets: a value of your choice against the tokens per second one user gets. The run-date control shows the registry as it stood on a day; a cursor reads every curve at the same speed |
| Rankings | Each configuration by its latest run, with the change against the run before it; a treemap by latency target; bars by run date |
| History | One configuration across its runs: other days, other engine versions, other versions of econ |
| Prices | The model's price list on each day it was taken, against the rent that a million output tokens carries |
| Runs | Every run in a table, and one of them in full: targets, every probe of the search, the node's check, stability, accuracy, what it does not cover, and its record to download |

Throughput, latency, power and accuracy are measured and never change on the page. Revenue, margins and costs are
arithmetic on them with the assumptions you can edit: rent, prices, utilisation, cached input, electricity.

The page is one file that works offline and fetches nothing. When it opens it recomputes every number econ priced in
every record and says how many agree.

## The format: `econ-run/1`

One JSON file per run: one configuration, on one node, in one measurement. [`schema/econ-run-1.schema.json`](schema/econ-run-1.schema.json)
is its JSON Schema.

| Part | What it holds |
|---|---|
| Identity | `schema`, `id` (date, label, eight hex digits), `created`, `visibility`, and the econ that measured and exported |
| What was served | The model, the engine with its image and digest, the configuration (family, TP, DP, flags) and the hardware, with the node under an alias |
| How | The workload, the method (windows, repeats, search) and what the counted power covers |
| Results | econ's points with econ's own names and units, each target's result and confirmation windows, every probe of the search, and the stability verdict |
| Health | The node's check and the accuracy with its interval |
| Prices | The price list the run was priced with, and the rents |
| Files | The SHA-256 of each original file |
| Provenance | Host, job, data folder, command: only in an internal record |

A record is `internal` or `public`. The public form is written by [`tools/sanitize.py`](tools/sanitize.py): no
provenance, the node under its alias, only the file name of a path, no provider names. It fails closed: whatever
[`tools/patterns.py`](tools/patterns.py) still finds is an error. Only public records enter this repository.

## How a run gets here

1. econ runs as usual: `econ measure`, `econ check`, `econ accuracy`.
2. `python -m tools.export RUN_DIR --econ-src GENTIC/src ...` writes the run's record. econ itself is imported from a
   gentic checkout, so the points are computed by econ's own report code.
3. The record goes to the private registry through a pull request there.
4. If the run is cleared to be public, `python -m tools.publish --runs REGISTRY ID` commits its public form on a
   branch of this repository. It never pushes: a person reads the branch and opens the pull request.
5. When the pull request is merged, the page is rebuilt and deployed.

## Tools

Every tool runs as `python -m tools.NAME` from the repository's root. All of them but the exporter need only
Python's standard library (3.10 or later).

| Tool | What it does |
|---|---|
| `tools.export` | A run of econ as a record, from its `measure.json` (or a configuration of a `report.json`), with its check, accuracy and price list |
| `tools.sanitize` | The public form of a record |
| `tools.validate` | Checks records: the schema, units and ranges, ids, the priced numbers recomputed, and for a public record everything that is forbidden |
| `tools.build` | The site from the records: `site/index.html`, `data.json`, each record and the schema |
| `tools.publish` | A cleared run's public record on a branch of this repository |
| `tools.vendor` | Checks that the files copied from econ are unedited, or copies them again from a new commit |

```bash
python -m tools.validate runs --public --allow-empty
python -m tools.build runs --out site
python -m unittest discover -s tests -t .
```

The tests hold no measured result: they use a made-up run. The exporter's tests on econ's real files of each version
need a gentic checkout (`ECON_SRC`) and the private registry (`ECON_RUNS`), and are skipped without them. The page's
arithmetic is checked under node against the values econ computed (`tests/golden`).

## What is econ's and what is the registry's

`web/vendor/` holds econ's page shell (`shell.js`, `shell.css`) and arithmetic (`math.js`), copied as they are from
econ and pinned by [`web/VENDORED.json`](web/VENDORED.json) (commit and SHA-256). They are never edited here: a change
goes to econ first. Everything else under `web/` is the registry's: its arithmetic on econ's numbers
(`regmath.js`), its charts and its sections.

## Publication

On every push to `main`, [`pages.yml`](.github/workflows/pages.yml) validates the records, builds the page and deploys
it to GitHub Pages. Nothing built is committed. [`checks.yml`](.github/workflows/checks.yml) runs on every pull
request and keeps the built page as an artifact, so a new run can be looked at before it is merged.

---

<sub>© KRAI · [krai.ai](https://krai.ai)</sub>
