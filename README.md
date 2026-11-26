<p align="center">
  <img src="assets/banner.svg" alt="KRAI — econ results: what a serving configuration sells within a latency target" width="100%">
</p>

# KRAI econ results

The registry of KRAI's **econ** runs and the dashboard that shows them together.

**→ [krai.github.io/econ-results](https://krai.github.io/econ-results/)**

econ measures what a serving configuration can sell within a latency target (the 99th percentile of the time to
first token and of the time per output token), with the power of the GPU boards, and prices it at what providers
charge for the model: USD per GPU-hour, and the cost of a million tokens.

Whoever runs econ at KRAI, on any node or cluster, adds the run here with one command and a pull request:
[Add your run](#add-your-run).

## The dashboard

The dashboard is one page, rebuilt on every push to `main`, so it always holds every run that has been merged.

| How | What you get |
|---|---|
| **On the web** | [krai.github.io/econ-results](https://krai.github.io/econ-results/): the page of `main` |
| **As a file** | [econ-results.html](https://github.com/krai/econ-results/releases/latest/download/econ-results.html): the same page as one file that works offline, from this repository's release `dashboard` |
| **A pull request's page** | Every run of the `checks` workflow keeps the page built from its branch as the artifact `page`: Actions → the run → Artifacts |
| **A checkout** | `python -m tools.build runs --out site`, then open `site/index.html` |

| Section | Contents |
|---|---|
| Explore | Every configuration as a curve through its met latency targets: a value of your choice against the tokens per second one user gets. The run-date control shows the registry as it stood on a day; a cursor reads every curve at the same speed |
| Rankings | Each configuration by its latest run, with the change against the run before it; a treemap by latency target; bars by run date |
| History | One configuration across its runs: other days, other engine versions, other versions of econ |
| Prices | The model's price list on each day it was taken, against the rent that a million output tokens carries |
| Market | What providers charge for the twenty most-used open-weight models against what a GPU-hour of serving them costs on nine GPUs: which model and GPU pairs pay, one model on every GPU, hardware against software, and KRAI's own runs of those models. From a dated snapshot of public data: [The Market tab](#the-market-tab) |
| Runs | Every run in a table, with the cluster and node it ran on, and one of them in full: targets, every probe of the search, the node's check, stability, accuracy, what it does not cover, its provenance, and its record to download |

Throughput, latency, power and accuracy are measured and never change on the page. Revenue, margins and costs are
arithmetic on them with the assumptions you can edit: rent, prices, utilisation, cached input, electricity. When the
page opens it recomputes every number econ priced in every record and says how many agree. It fetches nothing.

## Add your run

You ran econ on a node (`econ measure`, and what you ran of `econ check` and `econ accuracy`) and have the folder it
wrote. You need Python 3.10 or later, a checkout of this repository, and a checkout of gentic.

1. **The econ the registry exports with.** Every record is exported by one econ, the commit of gentic in
   [`ECON_REF`](ECON_REF), so that exporting a run again gives the same bytes. Check it out next to your own gentic
   checkout (`GENTIC` below is its path), from this repository's folder:

   ```bash
   git -C GENTIC fetch origin "$(cat ECON_REF)" && git -C GENTIC worktree add ../gentic-econ-ref FETCH_HEAD
   ```

   The new folder, `gentic-econ-ref`, lands next to your checkout.

2. **Add the run.**

   ```bash
   python -m tools.add RUN_DIR --econ-src GENTIC/../gentic-econ-ref/src --prices PRICES.json --rent 5.29 --rent 3.59 --cluster "YOUR CLUSTER"
   ```

   | Option | What it is |
   |---|---|
   | `RUN_DIR` | The folder econ wrote: `measure.json` (or `measure/measure.json`), and `check.json`, `accuracy.json` and `provenance.txt` where there are any |
   | `--prices` | The price list the run is priced with: the file `econ prices` wrote, or a `report.json` of the run |
   | `--rent` | What a GPU of that kind rents for, USD per GPU-hour. Give it once or twice: the page compares two |
   | `--cluster` | What people call the cluster or site. The node's own name comes from the measurement (`--node` when it does not say) |
   | others | What econ's files do not say: `--family` (recipe, S0, S1, stock), `--variant`, `--job`, `--engine-version` for a server econ did not start, and more: `python -m tools.add -h` |

   It copies the files the exporter reads to `sources/DATE_GPU/LABEL/`, writes the run's options there as
   `export.json`, exports the record to `runs/ID.json` with econ's own code, and validates the registry with it.
   It adds files and edits none. A run that does not validate leaves nothing behind, and says why.

3. **Look at it.** `python -m tools.build runs --out site`, and open `site/index.html`.

4. **Open a pull request** with the git commands `tools.add` printed. The checks validate the registry and keep the
   page built from your branch as the artifact `page`. When the pull request is merged, the dashboard is built and
   published again with your run in it: nobody has to do anything else.

No secrets: a record or a file that holds an access token or a private key fails the checks. If a command line or an
environment of your run carries one, change the secret; econ's files are not edited, because the record cites them
by their hash.

## What is here

| Path | What it holds |
|---|---|
| `runs/ID.json` | One record per run, in the `econ-run/1` format |
| `sources/DATE_GPU/LABEL/` | A run's original files, as econ wrote them, and its `export.json`: the rents, the price list, the cluster, and whatever else econ's files do not say. One folder per run, so adding a run edits no file of another |
| `market/` | The snapshot of public data behind the Market tab, one table per file: [its sources](#the-snapshot-and-its-sources) |
| `schema/` | The format's JSON Schema |
| `tools/` | The commands below |
| `web/` | The page: econ's shell and arithmetic (`web/vendor/`), the registry's sections, the Market tab, and the lock |
| `ECON_REF` | The commit of gentic whose econ exports the records |
| `aliases.json`, `private-words.txt` | Only for the public form of a record: the alias each node goes by, and words it must never hold |

The registry is exactly what its original files export: `python -m tools.export --registry . --econ-src GENTIC/src`
writes every record again, byte for byte. Moving `ECON_REF` to a newer econ is a pull request of its own: export
everything again with it and look at what changed.

## The format: `econ-run/1`

One JSON file per run: one configuration, on one node, in one measurement.
[`schema/econ-run-1.schema.json`](schema/econ-run-1.schema.json) is its JSON Schema.

| Part | What it holds |
|---|---|
| Identity | `schema`, `id` (date, label, eight hex digits), `created`, `visibility`, and the econ that measured and exported |
| What was served | The model, the engine with its image and digest, the configuration (family, TP, DP, flags) and the hardware, with its node and cluster |
| How | The workload, the method (windows, repeats, search) and what the counted power covers |
| Results | econ's points with econ's own names and units, each target's result and confirmation windows, every probe of the search, and the stability verdict |
| Health | The node's check and the accuracy with its interval |
| Prices | The price list the run was priced with, and the rents |
| Files | The SHA-256 of each original file |
| Provenance | Host, job, data folder, command |

The records here are the full form, `internal`: with their provenance. A record also has a `public` form, which
says less: [`tools/sanitize.py`](tools/sanitize.py) drops the provenance and the cluster, names the node by an alias,
keeps only the file name of a path and drops the providers' names. It fails closed: whatever
[`tools/patterns.py`](tools/patterns.py) still finds is an error. No page is built from that form today.

## The Market tab

The Market tab answers one question with public data: do the prices providers charge for open-weight models cover the
GPU that serves them? It takes the twenty open-weight model families with the most OpenRouter tokens over 30 days and
every priced endpoint of each. Published benchmark runs give thirteen of them a serving cost on nine GPUs (ten
measured, three estimated from a model of the same architecture), and the tab sets what a GPU earns in an hour against
what that hour costs: owned, rented on a 3-year commit, or rented on demand.

Every number there follows six choices: the speed each user gets, how the GPU is paid for, the average load, which
endpoint's price, which tokens are sold and which cache hits are billed. Throughput comes from benchmark runs, so
every revenue is a ceiling; the tab's last card says how each number is made. The tab is apart from the registry's
runs, which are KRAI's own measurements: it lists the ones whose model is on the market, and opens each under Runs.

### The snapshot and its sources

The tab's data is a snapshot read on **18 Nov 2026**, with usage from 19 Oct to 17 Nov 2026. It is kept in
[`market/`](market), one table per file. The page holds the numbers and none of the addresses below.

| Table | What it holds | Read (UTC) | Source |
|---|---|---|---|
| `models.json` | The 20 model families: tokens, share of all tokens and input per output token over the 30 days; parameters and licence | 18 Nov, 05:16 | OpenRouter: `https://openrouter.ai/api/frontend/v1/rankings/models?view=month` and `https://openrouter.ai/api/v1/models`. Model cards: `https://huggingface.co/api/models/<id>` |
| `prices.json` | 424 endpoints: input, output and cached-input price in USD per million tokens, promotion and precision | 18 Nov, 05:19 | OpenRouter: `https://openrouter.ai/api/v1/models/<slug>/endpoints` |
| `throughput.json` | 1,147 runs of a public agentic benchmark, 7 Aug to 18 Nov 2026: tokens per second per GPU and the P90 speed per user. Each row has the address of its run | 18 Nov, 05:17 | `https://inferencex.semianalysis.com/api/v1/benchmarks?model=<name>` |
| `gpus.json` | USD per GPU-hour of nine GPUs, owned at hyperscaler volume and rented on a 3-year commit, from a published model of the total cost of ownership (July 2026 surveys, updated 27 Oct 2026) | 17 Nov, 15:53 | <https://inferencex.semianalysis.com/infx/profit-estimator> |
| `rents.json` | 44 public on-demand list prices of those GPUs, each with its terms; a GPU's on-demand cost is their median | 17 Nov, 15:49 to 16:01 | The price pages and public APIs of ten GPU clouds: each row's `url` |
| `mlperf.json` | MLPerf Endpoints v1.0, DeepSeek V4.1 Flash, agentic: ten systems at 20, 50 and 100 tokens per second per user. Per GPU is a system's value divided by its GPUs: that division is ours, not an MLPerf metric | 17 Nov, 15:59 | <https://results.mlcommons.org/endpoints> |
| `reference.json` | One day of DeepSeek V3 and R1 traffic on H800s, published 1 Mar 2025 | 17 Nov | [DeepSeek's overview of its inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md) |

[`market/snapshot.json`](market/snapshot.json) says the same for a program. Left out when reading: endpoints with no
input price or a zero output price; spot, reserved, cluster and managed-endpoint rents; and recipes on engines that
have not served production tokens.

A newer snapshot is a pull request that replaces the tables and `snapshot.json` together. `python -m tools.market`
checks that they hold together (every price belongs to a model, every run to a model and a GPU, every figure is a
number), and the build stops on a snapshot that does not. [`tests/test_market.py`](tests/test_market.py) holds the
figures the tab must give for this snapshot, so a new one changes them in the same pull request.

## Tools

Every tool runs as `python -m tools.NAME` from the repository's root, on Python's standard library (3.10 or later).
The two that export also import econ from a gentic checkout.

| Tool | What it does |
|---|---|
| `tools.add` | A run into the registry: its files, its options and its record, ready for a pull request |
| `tools.export` | A run of econ as a record, from its `measure.json` (or a configuration of a `report.json`), with its check, accuracy and price list; `--registry .` exports every run again |
| `tools.validate` | Checks records: the schema, units and ranges, ids, the priced numbers recomputed, no secret; with `--sources`, that the original files are here and every run folder has its record |
| `tools.build` | The page from the records and the market snapshot: `site/index.html`, one file that works offline |
| `tools.market` | Checks that the market snapshot holds together, and says what it holds |
| `tools.lock` | The built page, locked: it opens with the key in its link |
| `tools.sanitize` | The public form of a record |
| `tools.vendor` | Checks that the files copied from econ are unedited, or copies them again from a new commit |

```bash
python -m unittest discover -s tests -t .
python -m tools.validate runs --sources sources
python -m tools.build runs --out site
```

The unit tests use a made-up run, so they do not change when the registry does. With `ECON_SRC` set to the `src`
folder of a gentic checkout at `ECON_REF`, the tests also export every run of the registry and compare it with its
record, and read econ's real files of every version there is. node, where there is one, runs the page's own
arithmetic against the values econ computed (`tests/golden`), the Market tab's against answers worked out by hand, and
the page's lock with the WebCrypto a browser has.

## What is econ's and what is the registry's

`web/vendor/` holds econ's page shell (`shell.js`, `shell.css`) and arithmetic (`math.js`), copied as they are from
econ and pinned by [`web/VENDORED.json`](web/VENDORED.json) (commit and SHA-256). They are never edited here: a change
goes to econ first. Everything else under `web/` is the registry's: its arithmetic on econ's numbers
(`regmath.js`), its charts, its sections and its lock.

## How the dashboard is published

On every push to `main`, [`site.yml`](.github/workflows/site.yml) validates the registry and builds the page. It
replaces the file of the release `dashboard` with it and, while GitHub Pages is on for this repository (Settings →
Pages → Source: GitHub Actions), deploys it there. Nothing built is committed.

A Pages site has no sign-in: whoever has its address can open it. GitHub serves Pages for a public repository, or
for a private one on a paid plan.

**Locked (not set up).** For a registry that is to stay internal, the workflow can publish the page locked instead:
compressed and encrypted with AES-256-GCM, inside a small page that opens it in the browser. The locked page goes to a
second repository, which holds nothing else and serves it with Pages; without the key it shows a box to paste the
link in, and nothing of the registry. It is turned on by naming that repository in the variable `SITE_REPOSITORY`,
with the secrets `SITE_KEY` and `SITE_DEPLOY_KEY`.

The key is in no file. It travels in the link, after the `#`, which a browser never sends to a server. A browser that
opened the page keeps the key, so the address alone works there afterwards; the page's About forgets it. Whoever has
the link can open the page and can pass the link on, and nobody's access can be taken away alone: a new key
(`python -m tools.lock --new-key`, set as the secret, and the page published again) leaves every old link without the
pages published after it.

---

<sub>© KRAI · [krai.ai](https://krai.ai) · see [`LICENSE`](LICENSE)</sub>
