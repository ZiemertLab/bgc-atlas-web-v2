--
-- PostgreSQL database dump
--

\restrict YS1c0giVdwbesVv4iq0dw6Ckolbggc14gPMS70BjT0NfZFI4dHzN07wHANb2FGu

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

SET default_tablespace = '';

--
-- Name: analyses analyses_accession_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analyses
    ADD CONSTRAINT analyses_accession_key UNIQUE (accession);


--
-- Name: CONSTRAINT analyses_accession_key ON analyses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT analyses_accession_key ON public.analyses IS 'Unique constraint on accession to enable efficient UPSERT operations via ON CONFLICT. Added in migration 0009 to match pattern from migration 0008.';


--
-- Name: analyses analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analyses
    ADD CONSTRAINT analyses_pkey PRIMARY KEY (id);


--
-- Name: antismash_runs antismash_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antismash_runs
    ADD CONSTRAINT antismash_runs_pkey PRIMARY KEY (id);


--
-- Name: assemblies assemblies_accession_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assemblies
    ADD CONSTRAINT assemblies_accession_key UNIQUE (accession);


--
-- Name: CONSTRAINT assemblies_accession_key ON assemblies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT assemblies_accession_key ON public.assemblies IS 'Unique constraint on accession to enable efficient UPSERT operations via ON CONFLICT';


--
-- Name: assemblies assemblies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assemblies
    ADD CONSTRAINT assemblies_pkey PRIMARY KEY (id);


--
-- Name: assembly_analyses assembly_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_analyses
    ADD CONSTRAINT assembly_analyses_pkey PRIMARY KEY (assembly_id, analysis_id);


--
-- Name: assembly_taxonomy assembly_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_taxonomy
    ADD CONSTRAINT assembly_taxonomy_pkey PRIMARY KEY (assembly_id);


--
-- Name: bgc_features bgc_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_features
    ADD CONSTRAINT bgc_features_pkey PRIMARY KEY (bgc_id);


--
-- Name: bgc_gbk_offsets bgc_gbk_offsets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_gbk_offsets
    ADD CONSTRAINT bgc_gbk_offsets_pkey PRIMARY KEY (bgc_id);


--
-- Name: bgc_gcf bgc_gcf_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_gcf
    ADD CONSTRAINT bgc_gcf_pkey PRIMARY KEY (bgc_id, gcf_id);


--
-- Name: bgc_redirect bgc_redirect_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_redirect
    ADD CONSTRAINT bgc_redirect_pkey PRIMARY KEY (old_bgc_id);


--
-- Name: bgc_taxonomy bgc_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_taxonomy
    ADD CONSTRAINT bgc_taxonomy_pkey PRIMARY KEY (bgc_id);


--
-- Name: bgcs bgcs_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgcs
    ADD CONSTRAINT bgcs_filename_key UNIQUE (filename);


--
-- Name: bgcs bgcs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgcs
    ADD CONSTRAINT bgcs_pkey PRIMARY KEY (id);


--
-- Name: bigslice_search_results bigslice_search_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bigslice_search_results
    ADD CONSTRAINT bigslice_search_results_pkey PRIMARY KEY (id);


--
-- Name: bigslice_search_sessions bigslice_search_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bigslice_search_sessions
    ADD CONSTRAINT bigslice_search_sessions_pkey PRIMARY KEY (id);


--
-- Name: bigslice_search_sessions bigslice_search_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bigslice_search_sessions
    ADD CONSTRAINT bigslice_search_sessions_session_id_key UNIQUE (session_id);


--
-- Name: biomes biomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biomes
    ADD CONSTRAINT biomes_pkey PRIMARY KEY (id);


--
-- Name: data_sources data_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: gcf_export_jobs gcf_export_jobs_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_export_jobs
    ADD CONSTRAINT gcf_export_jobs_job_id_key UNIQUE (job_id);


--
-- Name: gcf_export_jobs gcf_export_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_export_jobs
    ADD CONSTRAINT gcf_export_jobs_pkey PRIMARY KEY (id);


--
-- Name: gcf_legacy gcf_legacy_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_legacy
    ADD CONSTRAINT gcf_legacy_name_key UNIQUE (name);


--
-- Name: gcf_legacy gcf_legacy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_legacy
    ADD CONSTRAINT gcf_legacy_pkey PRIMARY KEY (gcf_id);


--
-- Name: gcf_mibig_anchor gcf_mibig_anchor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_mibig_anchor
    ADD CONSTRAINT gcf_mibig_anchor_pkey PRIMARY KEY (gcf_id, mibig_accession);


--
-- Name: gcf_study_count gcf_study_count_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_study_count
    ADD CONSTRAINT gcf_study_count_pkey PRIMARY KEY (gcf_id);


--
-- Name: gcf_successor gcf_successor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_successor
    ADD CONSTRAINT gcf_successor_pkey PRIMARY KEY (old_gcf_id, new_gcf_id);


--
-- Name: gcf_taxonomy_distribution_mv gcf_taxonomy_distribution_mv_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_taxonomy_distribution_mv
    ADD CONSTRAINT gcf_taxonomy_distribution_mv_pkey PRIMARY KEY (gcf_id);


--
-- Name: gcfs gcfs_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcfs
    ADD CONSTRAINT gcfs_name_key UNIQUE (name);


--
-- Name: gcfs gcfs_pet_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcfs
    ADD CONSTRAINT gcfs_pet_name_key UNIQUE (pet_name);


--
-- Name: gcfs gcfs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcfs
    ADD CONSTRAINT gcfs_pkey PRIMARY KEY (id);


--
-- Name: loader_progress loader_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loader_progress
    ADD CONSTRAINT loader_progress_pkey PRIMARY KEY (id);


--
-- Name: mgnify_genome_catalogues mgnify_genome_catalogues_catalogue_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_genome_catalogues
    ADD CONSTRAINT mgnify_genome_catalogues_catalogue_id_key UNIQUE (catalogue_id);


--
-- Name: mgnify_genome_catalogues mgnify_genome_catalogues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_genome_catalogues
    ADD CONSTRAINT mgnify_genome_catalogues_pkey PRIMARY KEY (id);


--
-- Name: mgnify_genomes mgnify_genomes_accession_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_genomes
    ADD CONSTRAINT mgnify_genomes_accession_key UNIQUE (accession);


--
-- Name: mgnify_genomes mgnify_genomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_genomes
    ADD CONSTRAINT mgnify_genomes_pkey PRIMARY KEY (id);


--
-- Name: mgnify_publications mgnify_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_publications
    ADD CONSTRAINT mgnify_publications_pkey PRIMARY KEY (id);


--
-- Name: mgnify_publications mgnify_publications_pubmed_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_publications
    ADD CONSTRAINT mgnify_publications_pubmed_id_key UNIQUE (pubmed_id);


--
-- Name: mgnify_super_studies mgnify_super_studies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_super_studies
    ADD CONSTRAINT mgnify_super_studies_pkey PRIMARY KEY (id);


--
-- Name: mgnify_super_studies mgnify_super_studies_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_super_studies
    ADD CONSTRAINT mgnify_super_studies_slug_key UNIQUE (slug);


--
-- Name: product_category_map product_category_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_category_map
    ADD CONSTRAINT product_category_map_pkey PRIMARY KEY (product);


--
-- Name: run_analyses run_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_analyses
    ADD CONSTRAINT run_analyses_pkey PRIMARY KEY (run_id, analysis_id);


--
-- Name: run_assemblies run_assemblies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_assemblies
    ADD CONSTRAINT run_assemblies_pkey PRIMARY KEY (run_id, assembly_id);


--
-- Name: run_studies run_studies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_studies
    ADD CONSTRAINT run_studies_pkey PRIMARY KEY (run_id, study_id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);


--
-- Name: sample_analyses sample_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_analyses
    ADD CONSTRAINT sample_analyses_pkey PRIMARY KEY (sample_id, analysis_id);


--
-- Name: sample_assemblies sample_assemblies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_assemblies
    ADD CONSTRAINT sample_assemblies_pkey PRIMARY KEY (sample_id, assembly_id);


--
-- Name: sample_biomes sample_biomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_biomes
    ADD CONSTRAINT sample_biomes_pkey PRIMARY KEY (sample_id, biome_id);


--
-- Name: sample_measurements sample_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_measurements
    ADD CONSTRAINT sample_measurements_pkey PRIMARY KEY (id);


--
-- Name: sample_runs sample_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_runs
    ADD CONSTRAINT sample_runs_pkey PRIMARY KEY (sample_id, run_id);


--
-- Name: samples samples_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_external_id_key UNIQUE (external_id);


--
-- Name: CONSTRAINT samples_external_id_key ON samples; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT samples_external_id_key ON public.samples IS 'Unique constraint on external_id to enable efficient UPSERT operations via ON CONFLICT';


--
-- Name: samples samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_pkey PRIMARY KEY (id);


--
-- Name: sequence_search_results sequence_search_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_search_results
    ADD CONSTRAINT sequence_search_results_pkey PRIMARY KEY (id);


--
-- Name: sequence_search_sessions sequence_search_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_search_sessions
    ADD CONSTRAINT sequence_search_sessions_pkey PRIMARY KEY (id);


--
-- Name: sequence_search_sessions sequence_search_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_search_sessions
    ADD CONSTRAINT sequence_search_sessions_session_id_key UNIQUE (session_id);


--
-- Name: studies studies_accession_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_accession_key UNIQUE (accession);


--
-- Name: CONSTRAINT studies_accession_key ON studies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT studies_accession_key ON public.studies IS 'Unique constraint on accession to enable efficient UPSERT operations via ON CONFLICT';


--
-- Name: studies studies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_pkey PRIMARY KEY (id);


--
-- Name: study_bgc_summary study_bgc_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_bgc_summary
    ADD CONSTRAINT study_bgc_summary_pkey PRIMARY KEY (study_key);


--
-- Name: study_biomes study_biomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_biomes
    ADD CONSTRAINT study_biomes_pkey PRIMARY KEY (study_id, biome_id);


--
-- Name: study_gcf study_gcf_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_gcf
    ADD CONSTRAINT study_gcf_pkey PRIMARY KEY (study_key, gcf_id);


--
-- Name: study_samples study_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_samples
    ADD CONSTRAINT study_samples_pkey PRIMARY KEY (study_id, sample_id);


--
-- Name: taxonomies taxonomies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxonomies
    ADD CONSTRAINT taxonomies_pkey PRIMARY KEY (id);


--
-- Name: user_contribution_samples unique_sample_per_contribution; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contribution_samples
    ADD CONSTRAINT unique_sample_per_contribution UNIQUE (contribution_id, sample_alias);


--
-- Name: taxonomies uq_gtdb_lineage; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxonomies
    ADD CONSTRAINT uq_gtdb_lineage UNIQUE (gtdb_lineage);


--
-- Name: user_contribution_samples user_contribution_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contribution_samples
    ADD CONSTRAINT user_contribution_samples_pkey PRIMARY KEY (id);


--
-- Name: user_contributions user_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contributions
    ADD CONSTRAINT user_contributions_pkey PRIMARY KEY (id);


--
-- Name: user_contributions user_contributions_submission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contributions
    ADD CONSTRAINT user_contributions_submission_id_key UNIQUE (submission_id);


--
-- Name: user_uploads user_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_uploads
    ADD CONSTRAINT user_uploads_pkey PRIMARY KEY (id);


--
-- Name: bgc_gcf_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bgc_gcf_one_primary ON public.bgc_gcf USING btree (bgc_id) WHERE is_primary;


--
-- Name: feedback_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_created_at_idx ON public.feedback USING btree (created_at DESC);


--
-- Name: gcf_legacy_clustering_pet_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gcf_legacy_clustering_pet_name_key ON public.gcf_legacy USING btree (clustering, pet_name);


--
-- Name: gcf_mibig_anchor_accession; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gcf_mibig_anchor_accession ON public.gcf_mibig_anchor USING btree (mibig_accession);


--
-- Name: gcf_route_counts_mv_gcf_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gcf_route_counts_mv_gcf_id_idx ON public.gcf_route_counts_mv USING btree (gcf_id);


--
-- Name: idx_analyses_analysis_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analyses_analysis_type ON public.analyses USING btree (analysis_type);


--
-- Name: idx_analyses_data_source_ids_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analyses_data_source_ids_gin ON public.analyses USING gin (data_source_ids);


--
-- Name: idx_analyses_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analyses_metadata_gin ON public.analyses USING gin (metadata);


--
-- Name: idx_analyses_tool_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analyses_tool_name ON public.analyses USING btree (tool_name);


--
-- Name: idx_antismash_runs_analysis_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_antismash_runs_analysis_id ON public.antismash_runs USING btree (analysis_id);


--
-- Name: idx_antismash_runs_assembly_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_antismash_runs_assembly_id ON public.antismash_runs USING btree (assembly_id);


--
-- Name: idx_antismash_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_antismash_runs_status ON public.antismash_runs USING btree (status);


--
-- Name: idx_assemblies_data_source_ids_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assemblies_data_source_ids_gin ON public.assemblies USING gin (data_source_ids);


--
-- Name: idx_assemblies_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assemblies_metadata_gin ON public.assemblies USING gin (metadata);


--
-- Name: idx_assemblies_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assemblies_source_type ON public.assemblies USING btree (source_type);


--
-- Name: idx_assembly_analyses_analysis_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_analyses_analysis_id ON public.assembly_analyses USING btree (analysis_id);


--
-- Name: idx_assembly_analyses_assembly_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_analyses_assembly_id ON public.assembly_analyses USING btree (assembly_id);


--
-- Name: idx_assembly_samples_mv_assembly; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_assembly_samples_mv_assembly ON public.assembly_samples_mv USING btree (assembly_id);


--
-- Name: idx_assembly_samples_mv_gold_path_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_samples_mv_gold_path_trgm ON public.assembly_samples_mv USING gin (gold_ecosystem_path public.gin_trgm_ops);


--
-- Name: idx_assembly_taxonomy_phylum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_taxonomy_phylum ON public.assembly_taxonomy USING btree (phylum);


--
-- Name: idx_assembly_taxonomy_taxonomy_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assembly_taxonomy_taxonomy_id ON public.assembly_taxonomy USING btree (taxonomy_id) WHERE (taxonomy_id IS NOT NULL);


--
-- Name: idx_bbs_biome_concat_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_biome_concat_trgm ON public.bgc_biome_summary_mv USING gin ((((((((((((((COALESCE(resolved_biome_level_1, ''::text) || ' '::text) || COALESCE(resolved_biome_level_2, ''::text)) || ' '::text) || COALESCE(resolved_biome_level_3, ''::text)) || ' '::text) || COALESCE(resolved_biome_level_4, ''::text)) || ' '::text) || COALESCE(environment_biome, ''::text)) || ' '::text) || COALESCE(environment_feature, ''::text)) || ' '::text) || COALESCE(environment_material, ''::text))) public.gin_trgm_ops);


--
-- Name: idx_bbs_env_biome_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_env_biome_trgm ON public.bgc_biome_summary_mv USING gin (environment_biome public.gin_trgm_ops);


--
-- Name: idx_bbs_env_feature_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_env_feature_trgm ON public.bgc_biome_summary_mv USING gin (environment_feature public.gin_trgm_ops);


--
-- Name: idx_bbs_env_material_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_env_material_trgm ON public.bgc_biome_summary_mv USING gin (environment_material public.gin_trgm_ops);


--
-- Name: idx_bbs_l1_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_l1_trgm ON public.bgc_biome_summary_mv USING gin (resolved_biome_level_1 public.gin_trgm_ops);


--
-- Name: idx_bbs_l2_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_l2_trgm ON public.bgc_biome_summary_mv USING gin (resolved_biome_level_2 public.gin_trgm_ops);


--
-- Name: idx_bbs_l3_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_l3_trgm ON public.bgc_biome_summary_mv USING gin (resolved_biome_level_3 public.gin_trgm_ops);


--
-- Name: idx_bbs_l4_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbs_l4_trgm ON public.bgc_biome_summary_mv USING gin (resolved_biome_level_4 public.gin_trgm_ops);


--
-- Name: idx_bgc_biome_l1_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_biome_l1_dist_name ON public.bgc_biome_level_1_distribution_mv USING btree (name);


--
-- Name: idx_bgc_biome_l1_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_biome_l1_dist_total ON public.bgc_biome_level_1_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_biome_l2_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_biome_l2_dist_name ON public.bgc_biome_level_2_distribution_mv USING btree (name);


--
-- Name: idx_bgc_biome_l2_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_biome_l2_dist_total ON public.bgc_biome_level_2_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_biome_l3_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_biome_l3_dist_name ON public.bgc_biome_level_3_distribution_mv USING btree (name);


--
-- Name: idx_bgc_biome_l3_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_biome_l3_dist_total ON public.bgc_biome_level_3_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_biome_l4_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_biome_l4_dist_name ON public.bgc_biome_level_4_distribution_mv USING btree (name);


--
-- Name: idx_bgc_biome_l4_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_biome_l4_dist_total ON public.bgc_biome_level_4_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_biome_summary_bgc; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_biome_summary_bgc ON public.bgc_biome_summary_mv USING btree (bgc_id);


--
-- Name: idx_bgc_biome_summary_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_biome_summary_sample ON public.bgc_biome_summary_mv USING btree (sample_id);


--
-- Name: idx_bgc_data_source_counts; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_data_source_counts ON public.bgc_data_source_counts USING btree (data_source);


--
-- Name: idx_bgc_env_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_env_dist_name ON public.bgc_environment_distribution_mv USING btree (name);


--
-- Name: idx_bgc_env_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_env_dist_total ON public.bgc_environment_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_feature_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_feature_dist_name ON public.bgc_feature_distribution_mv USING btree (name);


--
-- Name: idx_bgc_feature_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_feature_dist_total ON public.bgc_feature_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_features_compl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_features_compl ON public.bgc_features USING btree (completeness_class);


--
-- Name: idx_bgc_features_place; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_features_place ON public.bgc_features USING btree (placement_status);


--
-- Name: idx_bgc_features_route; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_features_route ON public.bgc_features USING btree (route);


--
-- Name: idx_bgc_gcf_gcf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_gcf_gcf ON public.bgc_gcf USING btree (gcf_id);


--
-- Name: idx_bgc_gcf_gcf_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_gcf_gcf_primary ON public.bgc_gcf USING btree (gcf_id) WHERE is_primary;


--
-- Name: idx_bgc_gold_bucket_counts; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_gold_bucket_counts ON public.bgc_gold_bucket_counts USING btree (bucket);


--
-- Name: idx_bgc_gold_eco_dist_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_gold_eco_dist_level ON public.bgc_gold_ecosystem_distribution_mv USING btree (level);


--
-- Name: idx_bgc_gold_eco_dist_level_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_gold_eco_dist_level_name ON public.bgc_gold_ecosystem_distribution_mv USING btree (level, name);


--
-- Name: idx_bgc_material_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_material_dist_name ON public.bgc_material_distribution_mv USING btree (name);


--
-- Name: idx_bgc_material_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_material_dist_total ON public.bgc_material_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_product_category_dist_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_product_category_dist_name ON public.bgc_product_category_distribution_mv USING btree (name);


--
-- Name: idx_bgc_product_category_dist_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_product_category_dist_total ON public.bgc_product_category_distribution_mv USING btree (total DESC);


--
-- Name: idx_bgc_product_facet_counts_kind_value; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bgc_product_facet_counts_kind_value ON public.bgc_product_facet_counts USING btree (kind, value);


--
-- Name: idx_bgc_taxonomy_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_taxonomy_method ON public.bgc_taxonomy USING btree (method);


--
-- Name: idx_bgc_taxonomy_taxonomy_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgc_taxonomy_taxonomy_id ON public.bgc_taxonomy USING btree (taxonomy_id);


--
-- Name: idx_bgcs_analysis_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_analysis_id ON public.bgcs USING btree (analysis_id);


--
-- Name: idx_bgcs_antismash_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_antismash_run_id ON public.bgcs USING btree (antismash_run_id);


--
-- Name: idx_bgcs_assembly; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_assembly ON public.bgcs USING btree (assembly);


--
-- Name: idx_bgcs_assembly_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_assembly_complete ON public.bgcs USING btree (assembly, is_complete) WHERE (is_complete = true);


--
-- Name: idx_bgcs_assembly_coords_btree; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_assembly_coords_btree ON public.bgcs USING btree (assembly, contig, start_pos, end_pos);


--
-- Name: idx_bgcs_assembly_text_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_assembly_text_trgm ON public.bgcs USING gin (((assembly)::text) public.gin_trgm_ops);


--
-- Name: idx_bgcs_contig; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_contig ON public.bgcs USING btree (contig);


--
-- Name: idx_bgcs_contig_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_contig_trgm ON public.bgcs USING gin (contig public.gin_trgm_ops);


--
-- Name: idx_bgcs_filename; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_filename ON public.bgcs USING btree (filename);


--
-- Name: idx_bgcs_filename_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_filename_trgm ON public.bgcs USING gin (filename public.gin_trgm_ops);


--
-- Name: idx_bgcs_id_text_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_id_text_trgm ON public.bgcs USING gin (((id)::text) public.gin_trgm_ops);


--
-- Name: idx_bgcs_is_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_is_complete ON public.bgcs USING btree (is_complete);


--
-- Name: idx_bgcs_length_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_length_complete ON public.bgcs USING btree (((end_pos - start_pos)) DESC, is_complete DESC, id);


--
-- Name: idx_bgcs_length_expression; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_length_expression ON public.bgcs USING btree (((end_pos - start_pos)));


--
-- Name: idx_bgcs_num_cds_features; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_num_cds_features ON public.bgcs USING btree (num_cds_features) WHERE (num_cds_features IS NOT NULL);


--
-- Name: idx_bgcs_product_category_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_product_category_gin ON public.bgcs USING gin (product_category);


--
-- Name: idx_bgcs_product_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_product_gin ON public.bgcs USING gin (product);


--
-- Name: idx_bgcs_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_tax_id ON public.bgcs USING btree (tax_id);


--
-- Name: idx_bgcs_with_taxonomy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bgcs_with_taxonomy ON public.bgcs USING btree (tax_id, assembly) WHERE (tax_id IS NOT NULL);


--
-- Name: idx_bigslice_results_bgc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_results_bgc_id ON public.bigslice_search_results USING btree (bgc_id);


--
-- Name: idx_bigslice_results_gcf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_results_gcf_id ON public.bigslice_search_results USING btree (gcf_id);


--
-- Name: idx_bigslice_results_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_results_rank ON public.bigslice_search_results USING btree (session_id, rank);


--
-- Name: idx_bigslice_results_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_results_session_id ON public.bigslice_search_results USING btree (session_id);


--
-- Name: idx_bigslice_sessions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_sessions_created_at ON public.bigslice_search_sessions USING btree (created_at DESC);


--
-- Name: idx_bigslice_sessions_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_sessions_hash ON public.bigslice_search_sessions USING btree (session_hash);


--
-- Name: idx_bigslice_sessions_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_sessions_session_id ON public.bigslice_search_sessions USING btree (session_id);


--
-- Name: idx_bigslice_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bigslice_sessions_status ON public.bigslice_search_sessions USING btree (status);


--
-- Name: idx_biomes_envo_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biomes_envo_id ON public.biomes USING btree (((metadata ->> 'envo_id'::text)));


--
-- Name: idx_biomes_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biomes_metadata_gin ON public.biomes USING gin (metadata);


--
-- Name: idx_biomes_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biomes_parent_id ON public.biomes USING btree (parent_id);


--
-- Name: idx_data_source_statistics_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_data_source_statistics_source ON public.data_source_statistics USING btree (data_source_id);


--
-- Name: idx_data_sources_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_sources_source_type ON public.data_sources USING btree (source_type);


--
-- Name: idx_data_sources_user_upload_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_sources_user_upload_id ON public.data_sources USING btree (user_upload_id);


--
-- Name: idx_gcf_assembly_source_stats_gcf_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_assembly_source_stats_gcf_source ON public.gcf_assembly_source_stats_mv USING btree (gcf_id, source_type);


--
-- Name: idx_gcf_category_combination_mv_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_category_combination_mv_key ON public.gcf_category_combination_mv USING btree (gcf_id, combination);


--
-- Name: idx_gcf_distributions_mv_dom_eco_l1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_distributions_mv_dom_eco_l1 ON public.gcf_distributions_mv USING btree (dom_ecosystem_l1);


--
-- Name: idx_gcf_distributions_mv_dom_eco_l3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_distributions_mv_dom_eco_l3 ON public.gcf_distributions_mv USING btree (dom_ecosystem_l3);


--
-- Name: idx_gcf_distributions_mv_dom_phylum_pct; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_distributions_mv_dom_phylum_pct ON public.gcf_distributions_mv USING btree (dom_phylum_pct);


--
-- Name: idx_gcf_distributions_mv_gcf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_distributions_mv_gcf_id ON public.gcf_distributions_mv USING btree (gcf_id);


--
-- Name: idx_gcf_distributions_mv_max_pct_l1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_distributions_mv_max_pct_l1 ON public.gcf_distributions_mv USING btree (max_pct_l1 DESC NULLS LAST);


--
-- Name: idx_gcf_env_dist_biome_l1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_env_dist_biome_l1 ON public.gcf_environmental_distribution_mv USING btree (biome_level_1);


--
-- Name: idx_gcf_env_dist_biome_l2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_env_dist_biome_l2 ON public.gcf_environmental_distribution_mv USING btree (biome_level_2);


--
-- Name: idx_gcf_env_dist_gcf_biomes; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_env_dist_gcf_biomes ON public.gcf_environmental_distribution_mv USING btree (gcf_id, biome_level_1, biome_level_2, biome_level_3);


--
-- Name: idx_gcf_env_dist_gcf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_env_dist_gcf_id ON public.gcf_environmental_distribution_mv USING btree (gcf_id);


--
-- Name: idx_gcf_export_jobs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_export_jobs_created_at ON public.gcf_export_jobs USING btree (created_at DESC);


--
-- Name: idx_gcf_export_jobs_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_export_jobs_expires_at ON public.gcf_export_jobs USING btree (expires_at) WHERE (is_deleted = false);


--
-- Name: idx_gcf_export_jobs_gcf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_export_jobs_gcf_id ON public.gcf_export_jobs USING btree (gcf_id);


--
-- Name: idx_gcf_export_jobs_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_export_jobs_job_id ON public.gcf_export_jobs USING btree (job_id);


--
-- Name: idx_gcf_export_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_export_jobs_status ON public.gcf_export_jobs USING btree (status);


--
-- Name: idx_gcf_gold_eco_dist_ecosystem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_gold_eco_dist_ecosystem ON public.gcf_gold_ecosystem_distribution_mv USING btree (ecosystem);


--
-- Name: idx_gcf_gold_eco_dist_gcf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_gold_eco_dist_gcf ON public.gcf_gold_ecosystem_distribution_mv USING btree (gcf_id);


--
-- Name: idx_gcf_gold_eco_dist_gcf_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_gold_eco_dist_gcf_level ON public.gcf_gold_ecosystem_distribution_mv USING btree (gcf_id, level);


--
-- Name: idx_gcf_gold_eco_dist_gcf_level_eco; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_gold_eco_dist_gcf_level_eco ON public.gcf_gold_ecosystem_distribution_mv USING btree (gcf_id, level, ecosystem);


--
-- Name: idx_gcf_legacy_pet_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_legacy_pet_name ON public.gcf_legacy USING btree (pet_name);


--
-- Name: idx_gcf_length_stats_mv_est; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_length_stats_mv_est ON public.gcf_length_stats_mv USING btree (COALESCE(median_complete_len, max_len));


--
-- Name: idx_gcf_length_stats_mv_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_length_stats_mv_id ON public.gcf_length_stats_mv USING btree (gcf_id);


--
-- Name: idx_gcf_product_cat_dist_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_product_cat_dist_category ON public.gcf_product_category_distribution_mv USING btree (category);


--
-- Name: idx_gcf_product_cat_dist_gcf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_product_cat_dist_gcf ON public.gcf_product_category_distribution_mv USING btree (gcf_id);


--
-- Name: idx_gcf_product_cat_dist_gcf_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_product_cat_dist_gcf_category ON public.gcf_product_category_distribution_mv USING btree (gcf_id, category);


--
-- Name: idx_gcf_product_category_dist_gcf_category; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_product_category_dist_gcf_category ON public.gcf_product_category_distribution_mv USING btree (gcf_id, category);


--
-- Name: idx_gcf_product_matrix_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_product_matrix_category ON public.gcf_product_type_matrix_mv USING btree (product_category);


--
-- Name: idx_gcf_product_matrix_gcf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_product_matrix_gcf ON public.gcf_product_type_matrix_mv USING btree (gcf_id);


--
-- Name: idx_gcf_product_matrix_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_product_matrix_type ON public.gcf_product_type_matrix_mv USING btree (product);


--
-- Name: idx_gcf_product_type_matrix_gcf_cat_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_product_type_matrix_gcf_cat_type ON public.gcf_product_type_matrix_mv USING btree (gcf_id, product_category, product);


--
-- Name: idx_gcf_sample_map_coords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_sample_map_coords ON public.gcf_sample_map_mv USING btree (gcf_id, latitude, longitude);


--
-- Name: idx_gcf_sample_map_data_sources; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_sample_map_data_sources ON public.gcf_sample_map_mv USING gin (data_source_names);


--
-- Name: idx_gcf_sample_map_gcf_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_sample_map_gcf_id ON public.gcf_sample_map_mv USING btree (gcf_id);


--
-- Name: idx_gcf_sample_map_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_sample_map_sample_id ON public.gcf_sample_map_mv USING btree (id);


--
-- Name: idx_gcf_sample_map_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_sample_map_unique ON public.gcf_sample_map_mv USING btree (gcf_id, id);


--
-- Name: idx_gcf_source_stats_gcf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_source_stats_gcf ON public.gcf_assembly_source_stats_mv USING btree (gcf_id);


--
-- Name: idx_gcf_source_stats_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_source_stats_type ON public.gcf_assembly_source_stats_mv USING btree (source_type);


--
-- Name: idx_gcf_study_count_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_study_count_count ON public.gcf_study_count USING btree (study_count);


--
-- Name: idx_gcf_successor_new; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_successor_new ON public.gcf_successor USING btree (new_gcf_id);


--
-- Name: idx_gcf_summary_description_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_description_trgm ON public.gcf_summary_mv USING gin (description public.gin_trgm_ops);


--
-- Name: idx_gcf_summary_id_text_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_id_text_trgm ON public.gcf_summary_mv USING gin (((gcf_id)::text) public.gin_trgm_ops);


--
-- Name: idx_gcf_summary_method_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_method_trgm ON public.gcf_summary_mv USING gin (cluster_method public.gin_trgm_ops);


--
-- Name: idx_gcf_summary_mv_cluster_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_mv_cluster_method ON public.gcf_summary_mv USING btree (cluster_method);


--
-- Name: idx_gcf_summary_mv_family_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_mv_family_class ON public.gcf_summary_mv USING btree (family_class);


--
-- Name: idx_gcf_summary_mv_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gcf_summary_mv_id ON public.gcf_summary_mv USING btree (gcf_id);


--
-- Name: idx_gcf_summary_mv_listed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_mv_listed ON public.gcf_summary_mv USING btree (listed) WHERE listed;


--
-- Name: idx_gcf_summary_mv_member_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_mv_member_count ON public.gcf_summary_mv USING btree (member_bgc_count);


--
-- Name: idx_gcf_summary_mv_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_mv_name ON public.gcf_summary_mv USING btree (gcf_name);


--
-- Name: idx_gcf_summary_mv_product_categories; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_mv_product_categories ON public.gcf_summary_mv USING gin (product_categories);


--
-- Name: idx_gcf_summary_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcf_summary_name_trgm ON public.gcf_summary_mv USING gin (gcf_name public.gin_trgm_ops);


--
-- Name: idx_gcfs_cluster_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcfs_cluster_method ON public.gcfs USING btree (cluster_method);


--
-- Name: idx_gcfs_family_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcfs_family_class ON public.gcfs USING btree (family_class);


--
-- Name: idx_gcfs_listed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcfs_listed ON public.gcfs USING btree (listed) WHERE listed;


--
-- Name: idx_gcfs_n_bgc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcfs_n_bgc ON public.gcfs USING btree (n_bgc DESC);


--
-- Name: idx_gcfs_representative_bgc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcfs_representative_bgc_id ON public.gcfs USING btree (representative_bgc_id);


--
-- Name: idx_loader_progress_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loader_progress_lookup ON public.loader_progress USING btree (loader_name, run_id, entity_type, entity_id);


--
-- Name: idx_loader_progress_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loader_progress_run ON public.loader_progress USING btree (run_id, status);


--
-- Name: idx_loader_progress_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loader_progress_status ON public.loader_progress USING btree (loader_name, run_id, status);


--
-- Name: idx_mgnify_genome_catalogues_catalogue_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mgnify_genome_catalogues_catalogue_id ON public.mgnify_genome_catalogues USING btree (catalogue_id);


--
-- Name: idx_mgnify_genomes_accession; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mgnify_genomes_accession ON public.mgnify_genomes USING btree (accession);


--
-- Name: idx_mgnify_genomes_genome_catalogue_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mgnify_genomes_genome_catalogue_id ON public.mgnify_genomes USING btree (genome_catalogue_id);


--
-- Name: idx_run_analyses_analysis_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_run_analyses_analysis_id ON public.run_analyses USING btree (analysis_id);


--
-- Name: idx_run_analyses_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_run_analyses_run_id ON public.run_analyses USING btree (run_id);


--
-- Name: idx_run_assemblies_assembly_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_run_assemblies_assembly_id ON public.run_assemblies USING btree (assembly_id);


--
-- Name: idx_run_assemblies_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_run_assemblies_run_id ON public.run_assemblies USING btree (run_id);


--
-- Name: idx_run_studies_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_run_studies_run_id ON public.run_studies USING btree (run_id);


--
-- Name: idx_run_studies_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_run_studies_study_id ON public.run_studies USING btree (study_id);


--
-- Name: idx_runs_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runs_metadata_gin ON public.runs USING gin (metadata);


--
-- Name: idx_sample_analyses_analysis_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_analyses_analysis_id ON public.sample_analyses USING btree (analysis_id);


--
-- Name: idx_sample_analyses_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_analyses_sample_id ON public.sample_analyses USING btree (sample_id);


--
-- Name: idx_sample_assemblies_assembly_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_assemblies_assembly_id ON public.sample_assemblies USING btree (assembly_id);


--
-- Name: idx_sample_assemblies_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_assemblies_sample_id ON public.sample_assemblies USING btree (sample_id);


--
-- Name: idx_sample_biome_levels_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_biome_levels_level ON public.sample_biome_levels_mv USING btree (level);


--
-- Name: idx_sample_biome_levels_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_biome_levels_sample ON public.sample_biome_levels_mv USING btree (sample_id);


--
-- Name: idx_sample_biome_levels_sample_level_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sample_biome_levels_sample_level_name ON public.sample_biome_levels_mv USING btree (sample_id, level, name);


--
-- Name: idx_sample_biomes_biome_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_biomes_biome_id ON public.sample_biomes USING btree (biome_id);


--
-- Name: idx_sample_biomes_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_biomes_sample_id ON public.sample_biomes USING btree (sample_id);


--
-- Name: idx_sample_gcf_counts_mv_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_gcf_counts_mv_count ON public.sample_gcf_counts_mv USING btree (gcf_count DESC, sample_id);


--
-- Name: idx_sample_gcf_counts_mv_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sample_gcf_counts_mv_sample ON public.sample_gcf_counts_mv USING btree (sample_id);


--
-- Name: idx_sample_map_view_gold_ecosystem_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_map_view_gold_ecosystem_path ON public.sample_map_view USING btree (gold_ecosystem_path) WHERE (gold_ecosystem_path IS NOT NULL);


--
-- Name: idx_sample_map_view_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sample_map_view_id ON public.sample_map_view USING btree (id);


--
-- Name: idx_sample_map_view_lat_lon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_map_view_lat_lon ON public.sample_map_view USING btree (latitude, longitude);


--
-- Name: idx_sample_measurements_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_measurements_key ON public.sample_measurements USING btree (key);


--
-- Name: idx_sample_measurements_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_measurements_sample_id ON public.sample_measurements USING btree (sample_id);


--
-- Name: idx_sample_parent_key_parent_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_parent_key_parent_key ON public.sample_parent_key USING btree (parent_key);


--
-- Name: idx_sample_parent_key_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sample_parent_key_sample_id ON public.sample_parent_key USING btree (sample_id);


--
-- Name: idx_sample_runs_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_runs_run_id ON public.sample_runs USING btree (run_id);


--
-- Name: idx_sample_runs_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_runs_sample_id ON public.sample_runs USING btree (sample_id);


--
-- Name: idx_sample_source_type_counts_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sample_source_type_counts_key ON public.sample_source_type_counts USING btree (source_types);


--
-- Name: idx_sample_summary_assembly_count_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_assembly_count_desc ON public.sample_summary USING btree (assembly_count DESC, id);


--
-- Name: idx_sample_summary_bgc_count_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_bgc_count_desc ON public.sample_summary USING btree (bgc_count DESC, id);


--
-- Name: idx_sample_summary_data_source_ids_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_data_source_ids_gin ON public.sample_summary USING gin (data_source_ids);


--
-- Name: idx_sample_summary_environment_biome_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_environment_biome_trgm ON public.sample_summary USING gin (environment_biome public.gin_trgm_ops);


--
-- Name: idx_sample_summary_environment_feature_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_environment_feature_trgm ON public.sample_summary USING gin (environment_feature public.gin_trgm_ops);


--
-- Name: idx_sample_summary_environment_material_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_environment_material_trgm ON public.sample_summary USING gin (environment_material public.gin_trgm_ops);


--
-- Name: idx_sample_summary_external_id_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_external_id_trgm ON public.sample_summary USING gin (external_id public.gin_trgm_ops);


--
-- Name: idx_sample_summary_geographic_location_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_geographic_location_trgm ON public.sample_summary USING gin (geographic_location public.gin_trgm_ops);


--
-- Name: idx_sample_summary_geolocation_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_geolocation_name_trgm ON public.sample_summary USING gin (geolocation_name public.gin_trgm_ops);


--
-- Name: idx_sample_summary_gold_ecosystem_path_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_gold_ecosystem_path_trgm ON public.sample_summary USING gin (gold_ecosystem_path public.gin_trgm_ops);


--
-- Name: idx_sample_summary_host_scientific_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_host_scientific_name_trgm ON public.sample_summary USING gin (host_scientific_name public.gin_trgm_ops);


--
-- Name: idx_sample_summary_latitude; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_latitude ON public.sample_summary USING btree (latitude) WHERE (latitude IS NOT NULL);


--
-- Name: idx_sample_summary_longitude; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_longitude ON public.sample_summary USING btree (longitude) WHERE (longitude IS NOT NULL);


--
-- Name: idx_sample_summary_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_name_trgm ON public.sample_summary USING gin (name public.gin_trgm_ops);


--
-- Name: idx_sample_summary_primary_biome_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_primary_biome_trgm ON public.sample_summary USING gin (primary_biome public.gin_trgm_ops);


--
-- Name: idx_sample_summary_source_types_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sample_summary_source_types_gin ON public.sample_summary USING gin (source_types);


--
-- Name: idx_samples_coordinates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_coordinates ON public.samples USING btree (latitude, longitude) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));


--
-- Name: idx_samples_data_source_ids_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_data_source_ids_gin ON public.samples USING gin (data_source_ids);


--
-- Name: idx_samples_external_id_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_external_id_trgm ON public.samples USING gin (external_id public.gin_trgm_ops);


--
-- Name: idx_samples_genome_qc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_genome_qc ON public.samples USING btree (id) INCLUDE (checkm_completeness, checkm_contamination, genome_quality);


--
-- Name: idx_samples_gold_ecosystem_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_gold_ecosystem_metadata_gin ON public.samples USING gin (gold_ecosystem_metadata);


--
-- Name: idx_samples_gold_ecosystem_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_gold_ecosystem_path ON public.samples USING btree (gold_ecosystem_path) WHERE (gold_ecosystem_path IS NOT NULL);


--
-- Name: idx_samples_gold_ecosystem_path_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_gold_ecosystem_path_gin ON public.samples USING gin (to_tsvector('english'::regconfig, gold_ecosystem_path)) WHERE (gold_ecosystem_path IS NOT NULL);


--
-- Name: idx_samples_gold_ecosystem_path_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_gold_ecosystem_path_pattern ON public.samples USING btree (gold_ecosystem_path text_pattern_ops) WHERE (gold_ecosystem_path IS NOT NULL);


--
-- Name: idx_samples_latitude; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_latitude ON public.samples USING btree (latitude);


--
-- Name: idx_samples_longitude; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_longitude ON public.samples USING btree (longitude);


--
-- Name: idx_samples_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_metadata_gin ON public.samples USING gin (metadata);


--
-- Name: idx_samples_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_name_trgm ON public.samples USING gin (name public.gin_trgm_ops);


--
-- Name: idx_seq_search_results_bgc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_results_bgc_id ON public.sequence_search_results USING btree (bgc_id);


--
-- Name: idx_seq_search_results_e_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_results_e_value ON public.sequence_search_results USING btree (e_value);


--
-- Name: idx_seq_search_results_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_results_identity ON public.sequence_search_results USING btree (identity DESC);


--
-- Name: idx_seq_search_results_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_results_rank ON public.sequence_search_results USING btree (session_id, rank);


--
-- Name: idx_seq_search_results_session_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_results_session_group ON public.sequence_search_results USING btree (session_id, query_id, bgc_id);


--
-- Name: idx_seq_search_results_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_results_session_id ON public.sequence_search_results USING btree (session_id);


--
-- Name: idx_seq_search_sessions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_sessions_created_at ON public.sequence_search_sessions USING btree (created_at DESC);


--
-- Name: idx_seq_search_sessions_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_sessions_hash ON public.sequence_search_sessions USING btree (sequence_hash);


--
-- Name: idx_seq_search_sessions_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_sessions_job_id ON public.sequence_search_sessions USING btree (job_id);


--
-- Name: idx_seq_search_sessions_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_sessions_session_id ON public.sequence_search_sessions USING btree (session_id);


--
-- Name: idx_seq_search_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_search_sessions_status ON public.sequence_search_sessions USING btree (status);


--
-- Name: idx_source_type_statistics_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_source_type_statistics_source_type ON public.source_type_statistics USING btree (source_type);


--
-- Name: idx_studies_biome_ids_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_biome_ids_gin ON public.studies USING gin (biome_ids);


--
-- Name: idx_studies_data_source_ids_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_data_source_ids_gin ON public.studies USING gin (data_source_ids);


--
-- Name: idx_studies_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_metadata_gin ON public.studies USING gin (metadata);


--
-- Name: idx_study_bgc_summary_biome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_bgc_summary_biome ON public.study_bgc_summary USING btree (primary_biome);


--
-- Name: idx_study_bgc_summary_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_bgc_summary_complete ON public.study_bgc_summary USING btree (complete_bgcs DESC);


--
-- Name: idx_study_bgc_summary_distinct; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_bgc_summary_distinct ON public.study_bgc_summary USING btree (distinct_gcfs DESC);


--
-- Name: idx_study_bgc_summary_exclusive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_bgc_summary_exclusive ON public.study_bgc_summary USING btree (exclusive_gcfs DESC);


--
-- Name: idx_study_bgc_summary_genomes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_bgc_summary_genomes ON public.study_bgc_summary USING btree (genome_count DESC);


--
-- Name: idx_study_bgc_summary_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_bgc_summary_study_id ON public.study_bgc_summary USING btree (study_id);


--
-- Name: idx_study_bgc_summary_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_bgc_summary_total ON public.study_bgc_summary USING btree (total_bgcs DESC);


--
-- Name: idx_study_biomes_biome_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_biomes_biome_id ON public.study_biomes USING btree (biome_id);


--
-- Name: idx_study_biomes_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_biomes_study_id ON public.study_biomes USING btree (study_id);


--
-- Name: idx_study_ecosystem_dist_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_study_ecosystem_dist_key ON public.study_ecosystem_dist USING btree (study_key);


--
-- Name: idx_study_gcf_exclusive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_gcf_exclusive ON public.study_gcf USING btree (study_key, bgcs_in_study DESC) WHERE is_exclusive;


--
-- Name: idx_study_gcf_gcf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_gcf_gcf ON public.study_gcf USING btree (gcf_id);


--
-- Name: idx_study_gcf_study_bgcs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_gcf_study_bgcs ON public.study_gcf USING btree (study_key, bgcs_in_study DESC);


--
-- Name: idx_study_samples_sample_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_samples_sample_id ON public.study_samples USING btree (sample_id);


--
-- Name: idx_study_samples_study_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_samples_study_id ON public.study_samples USING btree (study_id);


--
-- Name: idx_taxonomies_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_class ON public.taxonomies USING btree (class);


--
-- Name: idx_taxonomies_concat_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_concat_trgm ON public.taxonomies USING gin ((((((((((((((((COALESCE(domain, ''::text) || ' '::text) || COALESCE(phylum, ''::text)) || ' '::text) || COALESCE(class, ''::text)) || ' '::text) || COALESCE(order_name, ''::text)) || ' '::text) || COALESCE(family, ''::text)) || ' '::text) || COALESCE(genus, ''::text)) || ' '::text) || COALESCE(species, ''::text)) || ' '::text) || COALESCE(gtdb_lineage, ''::text))) public.gin_trgm_ops);


--
-- Name: idx_taxonomies_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_domain ON public.taxonomies USING btree (domain);


--
-- Name: idx_taxonomies_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_family ON public.taxonomies USING btree (family);


--
-- Name: idx_taxonomies_family_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_family_trgm ON public.taxonomies USING gin (family public.gin_trgm_ops);


--
-- Name: idx_taxonomies_genus; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_genus ON public.taxonomies USING btree (genus);


--
-- Name: idx_taxonomies_genus_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_genus_trgm ON public.taxonomies USING gin (genus public.gin_trgm_ops);


--
-- Name: idx_taxonomies_lineage_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_lineage_gin ON public.taxonomies USING gin (to_tsvector('english'::regconfig, gtdb_lineage));


--
-- Name: idx_taxonomies_lineage_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_lineage_pattern ON public.taxonomies USING btree (gtdb_lineage text_pattern_ops);


--
-- Name: idx_taxonomies_lineage_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_lineage_trgm ON public.taxonomies USING gin (gtdb_lineage public.gin_trgm_ops);


--
-- Name: idx_taxonomies_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_order ON public.taxonomies USING btree (order_name);


--
-- Name: idx_taxonomies_phylum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_phylum ON public.taxonomies USING btree (phylum);


--
-- Name: idx_taxonomies_rank_depth; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_rank_depth ON public.taxonomies USING btree (rank_depth);


--
-- Name: idx_taxonomies_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_source ON public.taxonomies USING btree (source);


--
-- Name: idx_taxonomies_species; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_species ON public.taxonomies USING btree (species);


--
-- Name: idx_taxonomies_species_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxonomies_species_trgm ON public.taxonomies USING gin (species public.gin_trgm_ops);


--
-- Name: idx_user_contribution_samples_contribution_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contribution_samples_contribution_id ON public.user_contribution_samples USING btree (contribution_id);


--
-- Name: idx_user_contribution_samples_sample_alias; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contribution_samples_sample_alias ON public.user_contribution_samples USING btree (sample_alias);


--
-- Name: idx_user_contributions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contributions_created_at ON public.user_contributions USING btree (created_at DESC);


--
-- Name: idx_user_contributions_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contributions_email ON public.user_contributions USING btree (email);


--
-- Name: idx_user_contributions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contributions_status ON public.user_contributions USING btree (status);


--
-- Name: idx_user_uploads_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_uploads_email ON public.user_uploads USING btree (email);


--
-- Name: sample_summary_environment_biome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sample_summary_environment_biome_idx ON public.sample_summary USING btree (environment_biome);


--
-- Name: sample_summary_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sample_summary_external_id_idx ON public.sample_summary USING btree (external_id);


--
-- Name: sample_summary_gold_ecosystem_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sample_summary_gold_ecosystem_path_idx ON public.sample_summary USING btree (gold_ecosystem_path) WHERE (gold_ecosystem_path IS NOT NULL);


--
-- Name: sample_summary_host_scientific_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sample_summary_host_scientific_name_idx ON public.sample_summary USING btree (host_scientific_name);


--
-- Name: sample_summary_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sample_summary_id_idx ON public.sample_summary USING btree (id);


--
-- Name: sample_summary_primary_biome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sample_summary_primary_biome_idx ON public.sample_summary USING btree (primary_biome);


--
-- Name: uq_biomes_envo_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_biomes_envo_id ON public.biomes USING btree (((metadata ->> 'envo_id'::text))) WHERE ((metadata ->> 'envo_id'::text) IS NOT NULL);


--
-- Name: uq_biomes_name_when_no_envo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_biomes_name_when_no_envo ON public.biomes USING btree (lower((name)::text)) WHERE ((metadata ->> 'envo_id'::text) IS NULL);


--
-- Name: antismash_runs antismash_runs_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antismash_runs
    ADD CONSTRAINT antismash_runs_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE SET NULL;


--
-- Name: antismash_runs antismash_runs_assembly_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antismash_runs
    ADD CONSTRAINT antismash_runs_assembly_id_fkey FOREIGN KEY (assembly_id) REFERENCES public.assemblies(id) ON DELETE SET NULL;


--
-- Name: assembly_analyses assembly_analyses_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_analyses
    ADD CONSTRAINT assembly_analyses_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE CASCADE;


--
-- Name: assembly_analyses assembly_analyses_assembly_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_analyses
    ADD CONSTRAINT assembly_analyses_assembly_id_fkey FOREIGN KEY (assembly_id) REFERENCES public.assemblies(id) ON DELETE CASCADE;


--
-- Name: assembly_taxonomy assembly_taxonomy_assembly_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_taxonomy
    ADD CONSTRAINT assembly_taxonomy_assembly_id_fkey FOREIGN KEY (assembly_id) REFERENCES public.assemblies(id) ON DELETE CASCADE;


--
-- Name: assembly_taxonomy assembly_taxonomy_taxonomy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assembly_taxonomy
    ADD CONSTRAINT assembly_taxonomy_taxonomy_id_fkey FOREIGN KEY (taxonomy_id) REFERENCES public.taxonomies(id);


--
-- Name: bgc_taxonomy bgc_taxonomy_bgc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_taxonomy
    ADD CONSTRAINT bgc_taxonomy_bgc_id_fkey FOREIGN KEY (bgc_id) REFERENCES public.bgcs(id) ON DELETE CASCADE;


--
-- Name: bgc_taxonomy bgc_taxonomy_taxonomy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_taxonomy
    ADD CONSTRAINT bgc_taxonomy_taxonomy_id_fkey FOREIGN KEY (taxonomy_id) REFERENCES public.taxonomies(id);


--
-- Name: bgcs bgcs_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgcs
    ADD CONSTRAINT bgcs_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE SET NULL;


--
-- Name: bgcs bgcs_antismash_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgcs
    ADD CONSTRAINT bgcs_antismash_run_id_fkey FOREIGN KEY (antismash_run_id) REFERENCES public.antismash_runs(id) ON DELETE SET NULL;


--
-- Name: bgcs bgcs_assembly_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgcs
    ADD CONSTRAINT bgcs_assembly_fkey FOREIGN KEY (assembly) REFERENCES public.assemblies(id) ON DELETE CASCADE;


--
-- Name: biomes biomes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biomes
    ADD CONSTRAINT biomes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.biomes(id);


--
-- Name: data_sources data_sources_user_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_user_upload_id_fkey FOREIGN KEY (user_upload_id) REFERENCES public.user_uploads(id) ON DELETE SET NULL;


--
-- Name: bgc_features fk_bgc_features_bgc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_features
    ADD CONSTRAINT fk_bgc_features_bgc FOREIGN KEY (bgc_id) REFERENCES public.bgcs(id) ON DELETE CASCADE;


--
-- Name: bgc_gcf fk_bgc_gcf_bgc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_gcf
    ADD CONSTRAINT fk_bgc_gcf_bgc FOREIGN KEY (bgc_id) REFERENCES public.bgcs(id) ON DELETE CASCADE;


--
-- Name: bgc_gcf fk_bgc_gcf_gcf; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bgc_gcf
    ADD CONSTRAINT fk_bgc_gcf_gcf FOREIGN KEY (gcf_id) REFERENCES public.gcfs(id) ON DELETE CASCADE;


--
-- Name: bigslice_search_results fk_bigslice_results_bgc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bigslice_search_results
    ADD CONSTRAINT fk_bigslice_results_bgc FOREIGN KEY (bgc_id) REFERENCES public.bgcs(id) ON DELETE SET NULL;


--
-- Name: bigslice_search_results fk_bigslice_results_session; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bigslice_search_results
    ADD CONSTRAINT fk_bigslice_results_session FOREIGN KEY (session_id) REFERENCES public.bigslice_search_sessions(session_id) ON DELETE CASCADE;


--
-- Name: sequence_search_results fk_seq_search_results_session; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_search_results
    ADD CONSTRAINT fk_seq_search_results_session FOREIGN KEY (session_id) REFERENCES public.sequence_search_sessions(session_id) ON DELETE CASCADE;


--
-- Name: gcf_mibig_anchor gcf_mibig_anchor_gcf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_mibig_anchor
    ADD CONSTRAINT gcf_mibig_anchor_gcf_id_fkey FOREIGN KEY (gcf_id) REFERENCES public.gcfs(id) ON DELETE CASCADE;


--
-- Name: gcf_successor gcf_successor_old_gcf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcf_successor
    ADD CONSTRAINT gcf_successor_old_gcf_id_fkey FOREIGN KEY (old_gcf_id) REFERENCES public.gcf_legacy(gcf_id) ON DELETE CASCADE;


--
-- Name: gcfs gcfs_representative_bgc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcfs
    ADD CONSTRAINT gcfs_representative_bgc_id_fkey FOREIGN KEY (representative_bgc_id) REFERENCES public.bgcs(id) ON DELETE SET NULL;


--
-- Name: mgnify_genomes mgnify_genomes_genome_catalogue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mgnify_genomes
    ADD CONSTRAINT mgnify_genomes_genome_catalogue_id_fkey FOREIGN KEY (genome_catalogue_id) REFERENCES public.mgnify_genome_catalogues(id) ON DELETE CASCADE;


--
-- Name: run_analyses run_analyses_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_analyses
    ADD CONSTRAINT run_analyses_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE CASCADE;


--
-- Name: run_analyses run_analyses_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_analyses
    ADD CONSTRAINT run_analyses_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs(id) ON DELETE CASCADE;


--
-- Name: run_assemblies run_assemblies_assembly_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_assemblies
    ADD CONSTRAINT run_assemblies_assembly_id_fkey FOREIGN KEY (assembly_id) REFERENCES public.assemblies(id) ON DELETE CASCADE;


--
-- Name: run_assemblies run_assemblies_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_assemblies
    ADD CONSTRAINT run_assemblies_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs(id) ON DELETE CASCADE;


--
-- Name: run_studies run_studies_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_studies
    ADD CONSTRAINT run_studies_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs(id) ON DELETE CASCADE;


--
-- Name: run_studies run_studies_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_studies
    ADD CONSTRAINT run_studies_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: sample_analyses sample_analyses_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_analyses
    ADD CONSTRAINT sample_analyses_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE CASCADE;


--
-- Name: sample_analyses sample_analyses_sample_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_analyses
    ADD CONSTRAINT sample_analyses_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.samples(id) ON DELETE CASCADE;


--
-- Name: sample_assemblies sample_assemblies_assembly_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_assemblies
    ADD CONSTRAINT sample_assemblies_assembly_id_fkey FOREIGN KEY (assembly_id) REFERENCES public.assemblies(id) ON DELETE CASCADE;


--
-- Name: sample_assemblies sample_assemblies_sample_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_assemblies
    ADD CONSTRAINT sample_assemblies_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.samples(id) ON DELETE CASCADE;


--
-- Name: sample_biomes sample_biomes_biome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_biomes
    ADD CONSTRAINT sample_biomes_biome_id_fkey FOREIGN KEY (biome_id) REFERENCES public.biomes(id) ON DELETE CASCADE;


--
-- Name: sample_biomes sample_biomes_sample_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_biomes
    ADD CONSTRAINT sample_biomes_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.samples(id) ON DELETE CASCADE;


--
-- Name: sample_measurements sample_measurements_sample_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_measurements
    ADD CONSTRAINT sample_measurements_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.samples(id) ON DELETE CASCADE;


--
-- Name: sample_runs sample_runs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_runs
    ADD CONSTRAINT sample_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs(id) ON DELETE CASCADE;


--
-- Name: sample_runs sample_runs_sample_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_runs
    ADD CONSTRAINT sample_runs_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.samples(id) ON DELETE CASCADE;


--
-- Name: study_biomes study_biomes_biome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_biomes
    ADD CONSTRAINT study_biomes_biome_id_fkey FOREIGN KEY (biome_id) REFERENCES public.biomes(id) ON DELETE CASCADE;


--
-- Name: study_biomes study_biomes_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_biomes
    ADD CONSTRAINT study_biomes_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: study_samples study_samples_sample_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_samples
    ADD CONSTRAINT study_samples_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.samples(id) ON DELETE CASCADE;


--
-- Name: study_samples study_samples_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_samples
    ADD CONSTRAINT study_samples_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: user_contribution_samples user_contribution_samples_contribution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contribution_samples
    ADD CONSTRAINT user_contribution_samples_contribution_id_fkey FOREIGN KEY (contribution_id) REFERENCES public.user_contributions(id) ON DELETE CASCADE;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE bgc_owner IN SCHEMA public GRANT SELECT ON TABLES TO bgc_app;


--
-- PostgreSQL database dump complete
--

\unrestrict YS1c0giVdwbesVv4iq0dw6Ckolbggc14gPMS70BjT0NfZFI4dHzN07wHANb2FGu

