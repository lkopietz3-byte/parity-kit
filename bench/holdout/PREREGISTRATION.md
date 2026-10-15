# Fresh holdout: labeled before the kit was run

This holdout is 45,491 mirrored-fact items from three source families that the
field corpus does not use. Every item was labeled by `label.py` and the labels
were committed **before any kit code ran on this data**: at this commit there is
no runner for the holdout, `label.py` never imports the kit, and the only things
read are the raw downloads listed in `raw-manifest.json`.

Date: 2026-10-14.

## The three families

In each family one table is canonical and several published copies are mirrors.

| Family | Canonical | Mirrors | Compared fields |
| --- | --- | --- | --- |
| `http-status` | IANA HTTP status code registry (assigned single codes only; ranges, `Unassigned` and `(Unused)` rows are not records) | Node 26.3.0 `http.STATUS_CODES`, Python 3.9.6 `http.HTTPStatus`, npm `statuses` 1.5.0 and 2.0.2, Go 1.26.0 `net/http` `StatusText` | `phrase` |
| `spdx` | SPDX License List 3.29.0 (`licenses.json`) | npm `spdx-license-list` 6.12.0, npm `spdx-license-ids` 3.0.24 | `name`, `osi` for the first; `deprecated` for the second |
| `gitea` | Gitea 1.24.0 `locale_en-US.ini` | twelve translations of the same release (de-DE, fr-FR, ja-JP, es-ES, pt-BR, ru-RU, zh-CN, tr-TR, it-IT, pl-PL, nl-NL, sv-SE) | printf verbs (as a sorted list), tag names, URLs |

## The label rule

An item is one id (a status code, an SPDX id, a UI string key) in one mirror.
The label is decided by exact equality and nothing else:

- `missing`: the id is in the canonical table and not in the mirror;
- `extra`: the id is in the mirror and not in the canonical table;
- `drift`: the id is in both and a compared field is not exactly equal;
- `match`: the id is in both and every compared field is exactly equal.

Whether a human would call a drift a defect is not part of the label. For
example `%s` against `%[1]s` in a translation is a `drift` here, because the
extracted facts are not equal, even though the two print the same.

## What is in the data

| Family | Items | match | missing | extra | drift |
| --- | --- | --- | --- | --- | --- |
| `http-status` | 319 | 285 | 5 | 9 | 20 |
| `spdx` | 1,480 | 1,457 | 19 | 0 | 4 |
| `gitea` | 43,692 | 36,223 | 7,361 | 24 | 84 |
| all | 45,491 | 37,965 | 7,385 | 33 | 108 |

The problems are real, not injected: for example Node, Python, Go and both npm
`statuses` versions still use phrases that the registry has since renamed
(413, 414, 416, 422), `spdx-license-list` 6.12.0 lacks 13 licenses that 3.29.0
has and marks four as not OSI approved that 3.29.0 marks approved, and the
translations carry keys that the English file dropped (`secrets.*`).

## Hand check

A seeded sample of 69 items (seed 20261014: 8 per problem class per family, 4
matches per family, fewer where a class is smaller) was read against the raw
values: all 69 labels agree with what the raw files say.

## Prediction, written before the run

1. The kit's per-item verdict equals the label on every item: **0 false
   passes and 0 false flags** across the 45,491 items.
2. No mirror comes back `ok`: each has at least one missing, extra or drift
   item, so every result is `flagged`.
3. The kit does not abstain on any item (no look-alike keys are expected, the
   keys are ASCII identifiers).

A single item where the verdict differs from the label counts as a miss and is
reported as such, with the item.

## Reproducing

`raw-manifest.json` has the URL and SHA-256 of every raw file. After fetching
them into one directory (same relative paths), run
`BENCH_HOLDOUT_RAW=<dir> python3 -I bench/holdout/label.py`; it rewrites
`data/` byte for byte. `node bench/holdout/extract-local.mjs <file>` writes the
Node reason phrases. Then `npm run bench` scores the kit on the holdout.
