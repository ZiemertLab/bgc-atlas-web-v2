--
-- PostgreSQL database dump
--

\restrict O2zs3L0tWXuXFa2n7RGbRyBO2EqNgqp7HjNyaNCV67LxnCv3IVPLRXpFsRCqu2j

-- Dumped from database version 18.6 (Ubuntu 18.6-1.pgdg22.04+2)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-1.pgdg22.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: data_sources; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.data_sources VALUES
	('01108a15-b444-565b-b14e-eb9f93a9caa4', 'third_party', 'metalog', 'Compiled environmental metadata (core/extended wide + long)', 'https://metalog.embl.de/', NULL, '2026-06-26 16:48:56.152465+02', NULL),
	('3a32cede-3f57-5409-ae5a-7a8405a2524a', 'third_party', 'SPIRE', 'SPIRE catalogs and MAG archives (placeholder assemblies)', 'https://spire.embl.de', NULL, '2026-06-26 16:48:56.152465+02', NULL),
	('27a9fa9d-2762-5e68-9fbe-0025002ce203', 'third_party', 'MGnify', 'MGnify - EMBL-EBI metagenomics analysis platform', 'https://www.ebi.ac.uk/metagenomics/', NULL, '2026-06-26 16:48:56.152465+02', NULL),
	('eb473234-fae6-5fa1-8a99-8014e567fd3f', 'third_party', 'GTDB', 'GTDB High Quality Genomes', 'https://gtdb.ecogenomic.org/', NULL, '2026-06-26 16:48:56.152465+02', NULL),
	('9eedc1b2-5007-5481-a684-550f9b3892f7', 'third_party', 'GEM', 'Genomes from Earth''s Microbiomes (JGI/IMG)', 'https://genome.jgi.doe.gov/portal/GEMs/GEMs.home.html', NULL, '2026-06-30 19:41:50.230625+02', NULL),
	('39d4c94c-a005-5f46-b75b-4003cce8c01b', 'third_party', 'SPIRE MAGs', 'SPIRE metagenome-assembled genomes', 'https://spire.embl.de/', NULL, '2026-06-30 19:53:05.981427+02', NULL),
	('dfcd709d-0911-5d74-9696-f148b86ab799', 'third_party', 'Microflora Danica (long-read)', 'Microflora Danica long-read MAGs', 'https://www.nature.com/articles/s41586-025-09794-2', NULL, '2026-06-30 17:49:19.300531+02', NULL),
	('0a9a4724-f924-54d9-b5bb-553f962eda00', 'third_party', 'Microflora Danica (short-read)', 'Microflora Danica short-read MAGs', 'https://www.nature.com/articles/s41586-025-09794-2', NULL, '2026-06-30 19:45:09.999938+02', NULL),
	('76515336-6be8-5622-9e97-0125b09bd407', 'third_party', 'SMAG', 'SMAG metagenome-assembled genomes', 'https://microbma.github.io/project/SMAG.html', NULL, '2026-06-30 19:48:12.017994+02', NULL),
	('ef649825-b2ff-52d9-bc55-bf92078a6a5d', 'third_party', 'TPMC', 'TPMC metagenome-assembled genomes', 'https://ngdc.cncb.ac.cn/tpmc', NULL, '2026-06-30 20:06:11.752612+02', NULL),
	('8de83d44-79d4-5ba2-8e31-bdb0df92a858', 'third_party', 'OWC', 'Old Woman Creek wetland MAGs', 'https://doi.org/10.1128/msystems.00680-25', NULL, '2026-06-30 00:18:49.21749+02', NULL),
	('e05519ea-b3f0-5d54-b90e-bfd0b282ded2', 'custom', 'custom_microflora_danica', 'Custom dataset: microflora-danica', 'https://www.nature.com/articles/s41586-025-09794-2', NULL, '2026-06-26 16:48:56.152465+02', 'Microflora Danica (metagenomes)'),
	('9c50ad07-5b16-54b9-ad3e-a0a3463c19ad', 'custom', 'custom_deep_sea_hydrothermal', 'Custom dataset: deep-sea-hydrothermal', 'https://doi.org/10.1038/s41597-026-06612-w', NULL, '2026-06-26 16:48:56.152465+02', 'Deep-sea hydrothermal vents'),
	('0b5d57bb-54ed-597f-a634-141f781c3d84', 'custom', 'custom_fram_ras', 'Custom dataset: fram_ras', 'https://doi.org/10.1594/PANGAEA.946508', NULL, '2026-06-26 16:48:56.152465+02', 'FRAM Remote Access Sampler'),
	('d5d37074-511c-5f72-9603-b2952eaf2856', 'custom', 'custom_ocean_surface', 'Custom dataset: ocean-surface', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12678497/', NULL, '2026-06-26 16:48:56.152465+02', 'Ocean surface'),
	('91226091-503f-5832-ad29-bbf3006be0f1', 'custom', 'custom_ziemert_lab', 'Custom dataset: ziemert-lab', 'https://doi.org/10.1093/gigascience/giaf135', NULL, '2026-06-26 16:48:56.152465+02', 'Ziemert lab'),
	('dc1091df-9475-5793-8d9a-a8d8ed6315d9', 'third_party', 'Ocean Microbiomics Database v2', 'Metagenome-assembled genomes from the Ocean Microbiomics Database (OMDB), release v2 as ingested', 'https://omdb.microbiomics.io/', NULL, '2026-06-30 20:13:02.407202+02', 'Ocean Microbiomics Database (OMDB)'),
	('1e2aaac6-667b-5ecd-936b-90628ffd04f6', 'custom', 'custom_great_barrier_reef', 'Custom dataset: great-barrier-reef', 'https://doi.org/10.1038/s41586-026-10778-z', NULL, '2026-10-12 23:15:17.917805+02', 'Great Barrier Reef seawater'),
	('286bd069-300c-5a12-8b9a-e23548277aa4', 'custom', 'custom_helgoland_2020', 'Custom dataset: helgoland-2020', 'https://doi.org/10.1186/s40168-023-01557-3', NULL, '2026-10-12 23:15:17.917805+02', 'Helgoland 2020 spring bloom');


--
-- Data for Name: product_category_map; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.product_category_map VALUES
	('CDPS', 'NRPS'),
	('fungal_CDPS', 'NRPS'),
	('isocyanide-nrp', 'NRPS'),
	('mycosporine', 'NRPS'),
	('NAPAA', 'NRPS'),
	('NRP-metallophore', 'NRPS'),
	('NRPS', 'NRPS'),
	('NRPS-like', 'NRPS'),
	('RCDPS', 'NRPS'),
	('t3nrps-iterative', 'NRPS'),
	('thioamide-NRP', 'NRPS'),
	('2dos', 'other'),
	('acyl_amino_acids', 'other'),
	('amglyccycl', 'other'),
	('aminocoumarin', 'other'),
	('aminopolycarboxylic-acid', 'other'),
	('aureonuclemycin', 'other'),
	('azoxy-crosslink', 'other'),
	('azoxy-dimer', 'other'),
	('betalactone', 'other'),
	('blactam', 'other'),
	('butyrolactone', 'other'),
	('cytokinin', 'other'),
	('deazapurine', 'other'),
	('ectoine', 'other'),
	('furan', 'other'),
	('hserlactone', 'other'),
	('hydrogen-cyanide', 'other'),
	('hydroxytropolone', 'other'),
	('indole', 'other'),
	('isocyanide', 'other'),
	('leupeptin', 'other'),
	('lincosamides', 'other'),
	('melanin', 'other'),
	('NAGGN', 'other'),
	('NI-siderophore', 'other'),
	('nitropropanoic_acid', 'other'),
	('nucleoside', 'other'),
	('opine-like-metallophore', 'other'),
	('other', 'other'),
	('PBDE', 'other'),
	('phenazine', 'other'),
	('phosphoglycolipid', 'other'),
	('phosphonate', 'other'),
	('phosphonate-like', 'other'),
	('polyhalogenated-pyrrole', 'other'),
	('polyyne', 'other'),
	('pyrrolidine', 'other'),
	('resorcinol', 'other'),
	('tropodithietic-acid', 'other'),
	('arylpolyene', 'PKS'),
	('benzoxazole', 'PKS'),
	('hglE-KS', 'PKS'),
	('HR-T2PKS', 'PKS'),
	('ladderane', 'PKS'),
	('PKS-like', 'PKS'),
	('PpyS-KS', 'PKS'),
	('prodigiosin', 'PKS'),
	('PUFA', 'PKS'),
	('T1PKS', 'PKS'),
	('T2PKS', 'PKS'),
	('T3PKS', 'PKS'),
	('transAT-PKS', 'PKS'),
	('transAT-PKS-like', 'PKS'),
	('archaeal-RiPP', 'RiPP'),
	('atropopeptide', 'RiPP'),
	('azole-containing-RiPP', 'RiPP'),
	('bottromycin', 'RiPP'),
	('crocagin', 'RiPP'),
	('cyanobactin', 'RiPP'),
	('cyclic-lactone-autoinducer', 'RiPP'),
	('darobactin', 'RiPP'),
	('epipeptide', 'RiPP'),
	('fungal-RiPP', 'RiPP'),
	('glycocin', 'RiPP'),
	('guanidinotides', 'RiPP'),
	('lanthipeptide-class-i', 'RiPP'),
	('lanthipeptide-class-ii', 'RiPP'),
	('lanthipeptide-class-iii', 'RiPP'),
	('lanthipeptide-class-iv', 'RiPP'),
	('lanthipeptide-class-v', 'RiPP'),
	('lassopeptide', 'RiPP'),
	('linaridin', 'RiPP'),
	('lipolanthine', 'RiPP'),
	('methanobactin', 'RiPP'),
	('microviridin', 'RiPP'),
	('proteusin', 'RiPP'),
	('ranthipeptide', 'RiPP'),
	('RaS-RiPP', 'RiPP'),
	('redox-cofactor', 'RiPP'),
	('RiPP-like', 'RiPP'),
	('RRE-containing', 'RiPP'),
	('sactipeptide', 'RiPP'),
	('spliceotide', 'RiPP'),
	('thioamitides', 'RiPP'),
	('triceptide', 'RiPP'),
	('oligosaccharide', 'saccharide'),
	('terpene', 'terpene'),
	('terpene-precursor', 'terpene');


--
-- PostgreSQL database dump complete
--

\unrestrict O2zs3L0tWXuXFa2n7RGbRyBO2EqNgqp7HjNyaNCV67LxnCv3IVPLRXpFsRCqu2j

