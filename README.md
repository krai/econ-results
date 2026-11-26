<p align="center">
  <img src="assets/banner.svg" alt="KRAI — econ results: what a serving configuration sells within a latency target" width="100%">
</p>

# KRAI econ results

The registry of KRAI's **econ** runs and the dashboard that shows them together.

**Internal.** This repository is private, and nothing in it is cleared to leave KRAI: not the runs, not the page, not
its link. See [`LICENSE`](LICENSE).

econ measures what a serving configuration can sell within a latency target (the 99th percentile of the time to
first token and of the time per output token), with the power of the GPU boards, and prices it at what providers
charge for the model: USD per GPU-hour, and the cost of a million tokens.

Whoever runs econ at KRAI, on any node or cluster, adds the run here with one command and a pull request:
[Add your run](#add-your-run).

## The dashboard

One page, three ways to open it:

| How | What you need |
|---|---|
| **Its link** | The dashboard is served locked, and opens only with its link, which carries the key. The link is this repository's website, in the About box of its front page: who can see the repository can see the link. Do not pass it on outside KRAI |
| **The artifact** | Every run of the `checks` workflow keeps the page as the artifact `page`: one HTML file that works offline. Actions → a run → Artifacts |
| **A checkout** | `python -m tools.build runs --out site`, then open `site/index.html` |

| Section | Contents |
|---|---|
| Explore | Every configuration as a curve through its met latency targets: a value of your choice against the tokens per second one user gets. The run-date control shows the registry as it stood on a day; a cursor reads every curve at the same speed |
| Rankings | Each configuration by its latest run, with the change against the run before it; a treemap by latency target; bars by run date |
| History | One configuration across its runs: other days, other engine versions, other versions of econ |
| Prices | The model's price list on each day it was taken, against the rent that a million output tokens carries |
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
   page built from your branch as the artifact `page`. When the pull request is merged, the dashboard is published
   again with your run in it.

No secrets: a record or a file that holds an access token or a private key fails the checks. If a command line or an
environment of your run carries one, change the secret; econ's files are not edited, because the record cites them
by their hash.

## What is here

| Path | What it holds |
|---|---|
| `runs/ID.json` | One record per run, in the `econ-run/1` format |
| `sources/DATE_GPU/LABEL/` | A run's original files, as econ wrote them, and its `export.json`: the rents, the price list, the cluster, and whatever else econ's files do not say. One folder per run, so adding a run edits no file of another |
| `schema/` | The format's JSON Schema |
| `tools/` | The commands below |
| `web/` | The page: econ's shell and arithmetic (`web/vendor/`), the registry's sections, and the lock |
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

The records here are `internal`. A record also has a `public` form, for the day one must leave KRAI:
[`tools/sanitize.py`](tools/sanitize.py) drops the provenance and the cluster, names the node by an alias, keeps only
the file name of a path and drops the providers' names. It fails closed: whatever
[`tools/patterns.py`](tools/patterns.py) still finds is an error. Nothing here is published in that form today.

## Tools

Every tool runs as `python -m tools.NAME` from the repository's root, on Python's standard library (3.10 or later).
The two that export also import econ from a gentic checkout.

| Tool | What it does |
|---|---|
| `tools.add` | A run into the registry: its files, its options and its record, ready for a pull request |
| `tools.export` | A run of econ as a record, from its `measure.json` (or a configuration of a `report.json`), with its check, accuracy and price list; `--registry .` exports every run again |
| `tools.validate` | Checks records: the schema, units and ranges, ids, the priced numbers recomputed, no secret; with `--sources`, that the original files are here and every run folder has its record |
| `tools.build` | The page from the records: `site/index.html`, one file that works offline |
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
arithmetic against the values econ computed (`tests/golden`) and the page's lock with the WebCrypto a browser has.

## What is econ's and what is the registry's

`web/vendor/` holds econ's page shell (`shell.js`, `shell.css`) and arithmetic (`math.js`), copied as they are from
econ and pinned by [`web/VENDORED.json`](web/VENDORED.json) (commit and SHA-256). They are never edited here: a change
goes to econ first. Everything else under `web/` is the registry's: its arithmetic on econ's numbers
(`regmath.js`), its charts, its sections and its lock.

## How the dashboard is published

On every push to `main`, [`site.yml`](.github/workflows/site.yml) validates the registry, builds the page and locks
it: the page is compressed and encrypted with AES-256-GCM, inside a small page that opens it in the browser. Only
that locked page leaves this repository. It goes to the site's repository, which holds nothing else and serves it
with GitHub Pages; without the key it shows a box to paste the link in, and nothing of the registry.

The key is not in any file. It is a secret of this repository's Actions and it travels in the link, after the `#`,
which a browser never sends to a server. A browser that opened the page keeps the key, so the address alone works
there afterwards; the page's About forgets it.

What that gives and what it does not: whoever has the link can open the page and can pass the link on, and nobody's
access can be taken away alone. A new key (`python -m tools.lock --new-key`, set as the secret, and the page
published again) leaves every old link without the pages published after it.

---

<sub>© KRAI · [krai.ai](https://krai.ai) · proprietary, for internal use</sub>
