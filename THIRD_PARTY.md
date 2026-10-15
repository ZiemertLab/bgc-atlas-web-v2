# Third-party files

These files are needed to build the site or rebuild its data, but come from
other projects and are not committed here (`.gitignore`). A fresh clone has to
put them back before the step that reads them.

Fetch each file from its source as listed below.

## Used by the running app

| file | source | needed for | without it |
|---|---|---|---|
| `bgc-atlas/public/vendor/bgc-viewer/style.css`, `domain-colors.csv` | `@kretep/bgc-viewer-components` (Apache-2.0), already in `node_modules` | antiSMASH region viewer | `npm run sync:bgc-viewer-assets` restores both |
| `bgc-atlas/src/assets/fonts/IBMPlexSans-400.woff`, `-600.woff` | IBM Plex Sans (SIL OFL 1.1), <https://github.com/IBM/plex> | social-card images (`src/components/seo/og-card.tsx`). Satori reads woff, not woff2 | OG image routes fail |
| `bgc-atlas/public/images/antismash_logo.svg` | the antiSMASH project, <https://antismash.secondarymetabolites.org> | icon on the antiSMASH viewer links (BGC, sample and assembly pages) | broken image |
| `bgc-atlas/src/lib/wordlists/petname/{adjectives.txt,names.txt,LICENSE}` | <https://github.com/dustinkirkland/petname> (Apache-2.0), `usr/share/petname/medium/` at commit `70ed924cb96c290ac051b8ae797417c4adbbb5c9` | GCF pet names (`src/lib/gcf-pet-name.ts`, `scripts/backfill-gcf-pet-names.ts`) | pet-name backfill fails; its tests skip |

**The petname files must be exactly that commit.** A GCF's pet name is a
bijection over 1,198 adjectives x 1,052 names, so a different list renames every
family. Check after fetching:

```
b1cd54d8f27d4514aaa9bbf4a8248b696867b63b75ffcbe49b277227e2875a13  adjectives.txt
0f37daddd7e68ba01240032188b542d32a838f2352197d04c1bb0f46a22f647a  names.txt
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  LICENSE
```

## Used when populating the database

Regenerate with the named tool, run as a module from the repo root
(`python -m scripts.populator.tools.<tool>`). Each tool's docstring gives its
exact sources and checks. Several are **best-effort reproducers**: their
sources change over time, so expect row-count drift.

| file | source | tool |
|---|---|---|
| `docs/GOLDs5levelEcosystemClassificationPaths.xlsx` | JGI GOLD five-level ecosystem classification | download from GOLD |
| `scripts/populator/data/gtdb/gold_biosample_ecosystem.tsv` | JGI GOLD biosample ecosystems | `prepare_gtdb_ecosystem_inputs` |
| `scripts/populator/data/gtdb/madin_species_traits.tsv` | Madin et al., bacteria-archaea-traits (GitHub) | `prepare_gtdb_ecosystem_inputs` |
| `scripts/populator/data/gtdb/archaea_release_metadata.tsv.gz` | GTDB R232 `ar53_metadata` | `prepare_gtdb_archaea_metadata` |
| `scripts/populator/data/gem/gem_genome_metadata.tsv` | GEM catalogue, JGI/NERSC portal | `prepare_gem_inputs` |
| `scripts/populator/data/smag/smag_sample_metadata.tsv`, `smag_genome_qc.tsv` | SMAG supplementary data (Zenodo 8223844, GitHub) | `prepare_smag_inputs` |
| `scripts/populator/data/smag/smag_biosample_isolation.tsv` | ENA BioSample attributes | `crawl_smag_biosample_isolation` |
| `scripts/populator/data/spire/spire_accession_biosample.tsv`, `spire_biosample_metadata.tsv` | SPIRE v1 genome metadata (EMBL) + ENA | `prepare_spire_inputs` |
| `scripts/populator/data/spire/microntology_terms.tsv`, `spire_biosample_microntology.tsv` | SPIRE microntology (SPIRE v1 metadata, EMBL) | no tool in this repo; export from the SPIRE metadata |
| `scripts/populator/data/tpmc/tpmc_sample_metadata.tsv` | TPMC metadata workbook (CNCB) | `prepare_tpmc_inputs` |
| `scripts/populator/data/omd/omd_biosample_metadata.tsv`, `omd_sample_dataset_map.tsv` | OMDB v2 catalogue (Sunagawa Lab) + ENA | `prepare_omd_inputs` |
| `scripts/populator/data/omd/omd_tara_physicochem.tsv` | Tara Oceans, PANGAEA | `prepare_omd_physicochem` |
| `scripts/populator/data/mfd/mfd_field_metadata.tsv`, `mfd_lr_ena_assembly_map.tsv` | Microflora Danica metadata + ENA PRJEB58634 | `prepare_mfd_inputs` |
| `scripts/populator/data/mfd/valid_gold_paths.txt`, `mfd_gold_envo_crosswalk.tsv` | GOLD paths; crosswalk built from them and the MFD fields | `build_mfd_crosswalk` |
| `scripts/populator/data/qc/genome_qc.tsv.gz` | published CheckM values (SPIRE, TPMC, MFD-LR/SR, OMDB, GTDB) | `fetch_ena_mag_qc`, `fetch_omdb_genome_qc`, then `prepare_genome_qc` |
| `scripts/populator/data/customs/dsv70_sample_metadata.tsv` | DSV70, Table S1, doi:10.1038/s41597-026-06612-w | no tool; transcribe from the paper's Table S1 |
| `scripts/populator/data/customs/great_barrier_reef_sample_metadata.tsv`, `helgoland_2020_sample_metadata.tsv` | ENA BioSample XML (PRJEB82623, PRJEB52999) | write a request TSV (`study, assembly, biosample, source_file, platform, archive`; one row per assembly), fetch each BioSample's XML to `<dir>/<BioSample>.xml` (ENA browser API `/ena/browser/api/xml/<acc>`), then `python -m scripts.populator.tools.build_custom_biosample_tsv --request <req.tsv> --study PRJEB82623 --xml-dir <dir> --out scripts/populator/data/customs/great_barrier_reef_sample_metadata.tsv`, and the same with `--study PRJEB52999` for `helgoland_2020_sample_metadata.tsv`. Loading those two sources needs them |

`scripts/populator/data/mgnify/kept_duplicate_runs.txt` and `scripts/populator/data/qc/uniform_checkm2.tsv.gz`
(our own CheckM2 1.1.0 run) are ours and stay committed.

The tests that read these files skip on a clone until they are restored
(`scripts/conftest.py`).
