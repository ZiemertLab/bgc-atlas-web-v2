--
-- PostgreSQL database dump
--

\restrict vjxT04EF3afXjUNrSLQDxvFDg5Qe76TtQxUa9ziSPzbXomRtaCEKPtrgGbdhpai

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
-- Name: pg_prewarm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_prewarm WITH SCHEMA public;


--
-- Name: EXTENSION pg_prewarm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_prewarm IS 'prewarm relation data';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: antismash_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.antismash_run_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: admin_refresh_matview(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_refresh_matview(p_view text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_oid  oid;
    v_kind "char";
BEGIN
    v_oid := to_regclass('public.' || quote_ident(p_view));
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'no such relation: %', p_view;
    END IF;
    SELECT relkind INTO v_kind FROM pg_class WHERE oid = v_oid;
    IF v_kind IS DISTINCT FROM 'm' THEN
        RETURN 'skipped';   -- externally maintained plain table; mirrors refreshIfMatview()
    END IF;
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %s', v_oid::regclass);
    RETURN 'refreshed';
END
$$;


--
-- Name: refresh_assembly_samples_mv(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_assembly_samples_mv() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY assembly_samples_mv;
END;
$$;


--
-- Name: FUNCTION refresh_assembly_samples_mv(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_assembly_samples_mv() IS 'Refreshes the assembly_samples_mv materialized view concurrently to avoid blocking queries';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analyses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    external_id text,
    name character varying(200),
    analysis_type character varying(100) NOT NULL,
    tool_name character varying(100),
    tool_version character varying(50),
    parameters text,
    run_date date,
    accession text,
    data_source_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT analyses_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: COLUMN analyses.accession; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analyses.accession IS 'Primary accession identifier for the analysis (e.g., MGYA/MGAB/MGA identifiers)';


--
-- Name: COLUMN analyses.data_source_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analyses.data_source_ids IS 'Array of data_sources.id values indicating provenance for this analysis';


--
-- Name: COLUMN analyses.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analyses.metadata IS 'Free-form key-value metadata as JSON object (use jsonb operators for querying)';


--
-- Name: antismash_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.antismash_runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(200),
    file_path text,
    analysis_id uuid,
    assembly_id uuid,
    num_bgcs integer,
    pipeline_version text DEFAULT '1.0'::text,
    antismash_version text,
    taxon character varying(50),
    processing_time_seconds integer,
    total_contigs integer,
    input_filename text,
    status public.antismash_run_status DEFAULT 'pending'::public.antismash_run_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: assemblies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assemblies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    external_id text,
    name character varying(200),
    source_type text NOT NULL,
    assembly_level character varying(50),
    sequencing_technology character varying(200),
    contig_count integer,
    accession text,
    data_source_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT assemblies_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT assemblies_source_type_check CHECK ((source_type = ANY (ARRAY['metagenome'::text, 'MAG'::text, 'SAG'::text, 'isolate'::text])))
);


--
-- Name: COLUMN assemblies.accession; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assemblies.accession IS 'Primary accession identifier for the assembly (e.g., GCA/GCF/MGX identifiers)';


--
-- Name: COLUMN assemblies.data_source_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assemblies.data_source_ids IS 'Array of data_sources.id values indicating provenance for this assembly';


--
-- Name: COLUMN assemblies.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assemblies.metadata IS 'Free-form key-value metadata as JSON object (use jsonb operators for querying)';


--
-- Name: assembly_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assembly_analyses (
    assembly_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sample_assemblies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_assemblies (
    sample_id uuid NOT NULL,
    assembly_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
)
WITH (autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02');


--
-- Name: samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.samples (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    external_id text,
    name text,
    description text,
    collection_date date,
    collection_date_end date,
    geographic_location text,
    location_resolution text,
    latitude numeric,
    longitude numeric,
    depth numeric(10,3),
    depth_min_meters numeric,
    depth_max_meters numeric,
    elevation_meters numeric,
    temperature numeric,
    ph numeric,
    salinity numeric,
    salinity_unit text,
    current_precipitation_mm numeric,
    mean_annual_precipitation_mm numeric,
    mean_annual_temperature numeric,
    environmental_package text,
    environment_biome text,
    environment_feature text,
    environment_material text,
    host_taxid integer,
    host_scientific_name text,
    geolocation_name text,
    sample_alias text,
    accession text,
    data_source_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gold_ecosystem_path text,
    gold_ecosystem_metadata jsonb DEFAULT '{}'::jsonb,
    dissolved_oxygen numeric,
    dissolved_oxygen_unit text,
    nitrate numeric,
    nitrate_unit text,
    nitrite numeric,
    nitrite_unit text,
    ammonium numeric,
    ammonium_unit text,
    phosphate numeric,
    phosphate_unit text,
    conductivity numeric,
    conductivity_unit text,
    dissolved_organic_carbon numeric,
    dissolved_organic_carbon_unit text,
    filtration_lower_threshold_um numeric,
    filtration_upper_threshold_um numeric,
    checkm_completeness numeric,
    checkm_contamination numeric,
    genome_size bigint,
    genome_quality text,
    checkm_tool text,
    checkm_source text,
    CONSTRAINT samples_checkm_tool_check CHECK (((checkm_tool IS NULL) OR (checkm_tool = ANY (ARRAY['CheckM'::text, 'CheckM2'::text])))),
    CONSTRAINT samples_genome_quality_check CHECK ((genome_quality = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT samples_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT samples_salinity_unit_check CHECK ((salinity_unit = ANY (ARRAY['psu'::text, 'ppt'::text, 'ppm'::text, '%'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02');


--
-- Name: COLUMN samples.collection_date_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.collection_date_end IS 'End of collection date window (if a range)';


--
-- Name: COLUMN samples.location_resolution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.location_resolution IS 'Granularity of location field (e.g., exact_location, region, country)';


--
-- Name: COLUMN samples.depth; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.depth IS 'Sampling depth in meters';


--
-- Name: COLUMN samples.depth_min_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.depth_min_meters IS 'Sampling depth minimum in meters';


--
-- Name: COLUMN samples.depth_max_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.depth_max_meters IS 'Sampling depth maximum in meters';


--
-- Name: COLUMN samples.elevation_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.elevation_meters IS 'Elevation of sampling site in meters (positive = above sea level)';


--
-- Name: COLUMN samples.temperature; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.temperature IS 'Temperature at sampling site in Celsius';


--
-- Name: COLUMN samples.ph; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.ph IS 'pH value at sampling site';


--
-- Name: COLUMN samples.salinity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.salinity IS 'Salinity measurement at sampling site';


--
-- Name: COLUMN samples.salinity_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.salinity_unit IS 'Unit for salinity when set (psu, ppt, ppm, or %)';


--
-- Name: COLUMN samples.current_precipitation_mm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.current_precipitation_mm IS 'Precipitation at time of sampling (mm)';


--
-- Name: COLUMN samples.mean_annual_precipitation_mm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.mean_annual_precipitation_mm IS 'Mean annual precipitation (mm)';


--
-- Name: COLUMN samples.mean_annual_temperature; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.mean_annual_temperature IS 'Mean annual temperature (Celsius)';


--
-- Name: COLUMN samples.environmental_package; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.environmental_package IS 'Environmental package label (e.g., MIxS)';


--
-- Name: COLUMN samples.environment_biome; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.environment_biome IS 'Text label for the sample''s environment biome (e.g., ENVO biome term label)';


--
-- Name: COLUMN samples.environment_feature; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.environment_feature IS 'Text label for the sample''s environment feature (e.g., ENVO feature term label)';


--
-- Name: COLUMN samples.environment_material; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.environment_material IS 'Text label for the sample''s environment material (e.g., ENVO material term label)';


--
-- Name: COLUMN samples.host_taxid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.host_taxid IS 'NCBI Taxonomy ID of the host, when applicable';


--
-- Name: COLUMN samples.host_scientific_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.host_scientific_name IS 'Scientific name of the host organism';


--
-- Name: COLUMN samples.geolocation_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.geolocation_name IS 'Human-readable location name (e.g., country/region/site)';


--
-- Name: COLUMN samples.sample_alias; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.sample_alias IS 'Alternate sample identifier/alias from source system';


--
-- Name: COLUMN samples.accession; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.accession IS 'Primary accession identifier for the sample (e.g., SRS/ERS/DRS from ENA/NCBI)';


--
-- Name: COLUMN samples.data_source_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.data_source_ids IS 'Array of data_sources.id values indicating provenance for this sample';


--
-- Name: COLUMN samples.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.metadata IS 'Free-form key-value metadata as JSON object (use jsonb operators for querying)';


--
-- Name: COLUMN samples.gold_ecosystem_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.gold_ecosystem_path IS 'GOLD 5-level ecosystem classification path (e.g., "Environmental:Aquatic:Marine:Coastal")';


--
-- Name: COLUMN samples.gold_ecosystem_metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.gold_ecosystem_metadata IS 'Mapping metadata including source, confidence level, and provenance tracking';


--
-- Name: COLUMN samples.dissolved_oxygen; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.dissolved_oxygen IS 'Dissolved oxygen concentration (see dissolved_oxygen_unit). Excludes COD/BOD.';


--
-- Name: COLUMN samples.dissolved_oxygen_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.dissolved_oxygen_unit IS 'Unit for dissolved_oxygen (e.g. uM, mg/L, %, mL/L)';


--
-- Name: COLUMN samples.nitrate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.nitrate IS 'Nitrate concentration (see nitrate_unit). Matrix inferred from unit (mg/L water vs mg/kg soil).';


--
-- Name: COLUMN samples.nitrate_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.nitrate_unit IS 'Unit for nitrate (e.g. uM, mg/L, mg/kg)';


--
-- Name: COLUMN samples.nitrite; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.nitrite IS 'Nitrite concentration (see nitrite_unit)';


--
-- Name: COLUMN samples.nitrite_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.nitrite_unit IS 'Unit for nitrite';


--
-- Name: COLUMN samples.ammonium; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.ammonium IS 'Ammonium concentration (see ammonium_unit)';


--
-- Name: COLUMN samples.ammonium_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.ammonium_unit IS 'Unit for ammonium (e.g. uM, mg/L, mg/kg)';


--
-- Name: COLUMN samples.phosphate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.phosphate IS 'Phosphate (PO4) concentration — NOT total/elemental phosphorus (see phosphate_unit)';


--
-- Name: COLUMN samples.phosphate_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.phosphate_unit IS 'Unit for phosphate';


--
-- Name: COLUMN samples.conductivity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.conductivity IS 'Electrical conductivity (see conductivity_unit)';


--
-- Name: COLUMN samples.conductivity_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.conductivity_unit IS 'Unit for conductivity (e.g. uS/cm, mS/cm, dS/m)';


--
-- Name: COLUMN samples.dissolved_organic_carbon; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.dissolved_organic_carbon IS 'Dissolved organic carbon (DOC) — NOT DIC/TOC/CO2 (see dissolved_organic_carbon_unit)';


--
-- Name: COLUMN samples.dissolved_organic_carbon_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.dissolved_organic_carbon_unit IS 'Unit for DOC (e.g. ppm, mg/L, uM)';


--
-- Name: COLUMN samples.filtration_lower_threshold_um; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.filtration_lower_threshold_um IS 'Lower pre-filtration pore-size threshold (micrometres)';


--
-- Name: COLUMN samples.filtration_upper_threshold_um; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.filtration_upper_threshold_um IS 'Upper pre-filtration pore-size threshold (micrometres)';


--
-- Name: COLUMN samples.checkm_completeness; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.checkm_completeness IS 'CheckM genome completeness (percent), from metadata JSONB';


--
-- Name: COLUMN samples.checkm_contamination; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.checkm_contamination IS 'CheckM genome contamination (percent), from metadata JSONB';


--
-- Name: COLUMN samples.genome_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.genome_size IS 'Genome/assembly size in bases, from metadata JSONB';


--
-- Name: COLUMN samples.genome_quality; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.genome_quality IS 'MIMAG quality tier (high/medium/low), derived from mimag_*_quality flags';


--
-- Name: COLUMN samples.checkm_tool; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.checkm_tool IS 'Tool behind checkm_completeness/contamination: CheckM (v1) or CheckM2; NULL when the source does not say. Migration 0121.';


--
-- Name: COLUMN samples.checkm_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.samples.checkm_source IS 'Where checkm_completeness/contamination were read from. Migration 0121.';


--
-- Name: assembly_samples_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.assembly_samples_mv AS
 WITH base AS (
         SELECT sa.assembly_id,
            sa.sample_id,
            s.id AS resolved_sample_id,
            s.external_id,
            s.name
           FROM (public.sample_assemblies sa
             JOIN public.samples s ON ((s.id = sa.sample_id)))
        ), agg AS (
         SELECT base.assembly_id,
            array_agg(DISTINCT base.resolved_sample_id) AS sample_ids,
            array_agg(DISTINCT COALESCE(base.external_id, base.name, (base.resolved_sample_id)::text)) AS sample_labels,
            count(DISTINCT base.resolved_sample_id) AS sample_count
           FROM base
          GROUP BY base.assembly_id
        ), gold AS (
         SELECT DISTINCT ON (sa.assembly_id) sa.assembly_id,
            s2.gold_ecosystem_path,
            s2.gold_ecosystem_metadata
           FROM (public.sample_assemblies sa
             JOIN public.samples s2 ON ((s2.id = sa.sample_id)))
          ORDER BY sa.assembly_id, sa.sample_id
        )
 SELECT agg.assembly_id,
    agg.sample_ids,
    agg.sample_labels,
    agg.sample_count,
    gold.gold_ecosystem_path,
    gold.gold_ecosystem_metadata
   FROM (agg
     LEFT JOIN gold ON ((gold.assembly_id = agg.assembly_id)))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW assembly_samples_mv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.assembly_samples_mv IS 'Pre-aggregated sample data + representative GOLD ecosystem per assembly. Refresh after bulk sample/assembly changes.';


--
-- Name: assembly_taxonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assembly_taxonomy (
    assembly_id uuid NOT NULL,
    taxonomy_id uuid,
    domain text NOT NULL,
    phylum text,
    class text,
    order_name text,
    family text,
    genus text,
    species text,
    rank text NOT NULL,
    method text NOT NULL,
    n_bgcs integer NOT NULL,
    n_voting integer NOT NULL,
    agreement real,
    CONSTRAINT assembly_taxonomy_agreement_check CHECK (
CASE method
    WHEN 'consensus_v1'::text THEN ((agreement IS NOT NULL) AND (agreement > (0)::double precision) AND (agreement <= (1)::double precision))
    ELSE (agreement IS NULL)
END),
    CONSTRAINT assembly_taxonomy_counts_check CHECK (((n_bgcs > 0) AND (n_voting > 0) AND (n_voting <= n_bgcs))),
    CONSTRAINT assembly_taxonomy_dense_prefix CHECK ((((phylum IS NULL) OR (domain IS NOT NULL)) AND ((class IS NULL) OR (phylum IS NOT NULL)) AND ((order_name IS NULL) OR (class IS NOT NULL)) AND ((family IS NULL) OR (order_name IS NOT NULL)) AND ((genus IS NULL) OR (family IS NOT NULL)) AND ((species IS NULL) OR (genus IS NOT NULL)))),
    CONSTRAINT assembly_taxonomy_method_check CHECK ((method = ANY (ARRAY['gtdb_r232'::text, 'gtdb_legacy'::text, 'consensus_v1'::text]))),
    CONSTRAINT assembly_taxonomy_rank_check CHECK ((rank = ANY (ARRAY['domain'::text, 'phylum'::text, 'class'::text, 'order'::text, 'family'::text, 'genus'::text, 'species'::text]))),
    CONSTRAINT assembly_taxonomy_rank_is_deepest CHECK ((rank =
CASE
    WHEN (species IS NOT NULL) THEN 'species'::text
    WHEN (genus IS NOT NULL) THEN 'genus'::text
    WHEN (family IS NOT NULL) THEN 'family'::text
    WHEN (order_name IS NOT NULL) THEN 'order'::text
    WHEN (class IS NOT NULL) THEN 'class'::text
    WHEN (phylum IS NOT NULL) THEN 'phylum'::text
    ELSE 'domain'::text
END))
);


--
-- Name: TABLE assembly_taxonomy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.assembly_taxonomy IS 'One resolved lineage per genome. Genome-derived where GTDB classified the genome, otherwise a nested-majority consensus of its BGCs, truncated at the first rank without a majority. No row means unclassified; readers LEFT JOIN. Rebuilt after every BGC or taxonomy load.';


--
-- Name: COLUMN assembly_taxonomy.taxonomy_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assembly_taxonomy.taxonomy_id IS 'NULL when the consensus was truncated to a prefix that is not itself a taxonomies row. The rank columns, not this, are authoritative.';


--
-- Name: COLUMN assembly_taxonomy.agreement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assembly_taxonomy.agreement IS 'Share of voting BGCs backing the lineage at its deepest rank; NULL for genome-derived rows.';


--
-- Name: bgcs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bgcs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    filename text NOT NULL,
    assembly uuid NOT NULL,
    analysis_id uuid,
    antismash_run_id uuid,
    contig text NOT NULL,
    start_pos integer NOT NULL,
    end_pos integer NOT NULL,
    core_start_pos integer,
    core_end_pos integer,
    product_category text[] DEFAULT '{}'::text[] NOT NULL,
    product text[] DEFAULT '{}'::text[] CONSTRAINT bgcs_product_type_not_null NOT NULL,
    anchor character varying(15),
    gc_content numeric(5,4),
    detection_tool character varying(100),
    cutoff_distance integer,
    num_cds_features integer,
    num_domains integer,
    tax_id integer,
    is_complete boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bgcs_check CHECK ((end_pos >= start_pos)),
    CONSTRAINT bgcs_start_pos_check CHECK ((start_pos >= 0)),
    CONSTRAINT chk_core_coordinates CHECK (((core_start_pos IS NULL) OR ((core_start_pos >= start_pos) AND (core_end_pos <= end_pos)))),
    CONSTRAINT chk_gc_content CHECK (((gc_content IS NULL) OR ((gc_content >= 0.0) AND (gc_content <= 1.0))))
)
WITH (autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02', autovacuum_vacuum_threshold='50000', autovacuum_analyze_threshold='25000');


--
-- Name: biomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biomes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    parent_id uuid,
    level integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT biomes_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: COLUMN biomes.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.biomes.metadata IS 'Free-form key-value metadata as JSON object (use jsonb operators for querying)';


--
-- Name: run_assemblies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.run_assemblies (
    run_id uuid NOT NULL,
    assembly_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sample_biomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_biomes (
    sample_id uuid NOT NULL,
    biome_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sample_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_runs (
    sample_id uuid NOT NULL,
    run_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bgc_biome_analysis_mapping; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bgc_biome_analysis_mapping AS
 SELECT DISTINCT b.id AS bgc_id,
    b.assembly,
    sb.biome_id,
    bio.name AS biome_name,
    s.geographic_location,
    s.latitude,
    s.longitude
   FROM (((((((public.bgcs b
     JOIN public.assembly_analyses aa ON ((aa.assembly_id = b.assembly)))
     JOIN public.analyses a ON ((a.id = aa.analysis_id)))
     JOIN public.run_assemblies ra ON ((ra.assembly_id = b.assembly)))
     JOIN public.sample_runs sr ON ((sr.run_id = ra.run_id)))
     JOIN public.samples s ON ((s.id = sr.sample_id)))
     JOIN public.sample_biomes sb ON ((sb.sample_id = s.id)))
     JOIN public.biomes bio ON ((bio.id = sb.biome_id)));


--
-- Name: sample_biome_levels_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.sample_biome_levels_mv AS
 WITH RECURSIVE biome_tree AS (
         SELECT sb.sample_id,
            b.id AS biome_id,
            b.parent_id,
            NULLIF((b.name)::text, ''::text) AS name,
            b.level,
            0 AS depth
           FROM (public.sample_biomes sb
             JOIN public.biomes b ON ((b.id = sb.biome_id)))
        UNION ALL
         SELECT bt.sample_id,
            parent.id AS biome_id,
            parent.parent_id,
            NULLIF((parent.name)::text, ''::text) AS name,
            parent.level,
            (bt.depth + 1)
           FROM (biome_tree bt
             JOIN public.biomes parent ON ((parent.id = bt.parent_id)))
          WHERE (bt.parent_id IS NOT NULL)
        ), ranked AS (
         SELECT biome_tree.sample_id,
            biome_tree.level,
            biome_tree.name,
            biome_tree.depth,
            row_number() OVER (PARTITION BY biome_tree.sample_id, biome_tree.level ORDER BY biome_tree.depth) AS level_rank
           FROM biome_tree
          WHERE (biome_tree.level IS NOT NULL)
        )
 SELECT sample_id,
    level,
    name
   FROM ranked
  WHERE (level_rank = 1)
  WITH NO DATA;


--
-- Name: bgc_biome_summary_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_biome_summary_mv AS
 WITH bgc_samples AS (
         SELECT DISTINCT b.id AS bgc_id,
            sa.sample_id
           FROM ((public.bgcs b
             JOIN public.assemblies a ON ((a.id = b.assembly)))
             JOIN public.sample_assemblies sa ON ((sa.assembly_id = a.id)))
        ), sample_levels AS (
         SELECT sample_biome_levels_mv.sample_id,
            max(
                CASE
                    WHEN (sample_biome_levels_mv.level = 1) THEN sample_biome_levels_mv.name
                    ELSE NULL::text
                END) AS biome_level_1,
            max(
                CASE
                    WHEN (sample_biome_levels_mv.level = 2) THEN sample_biome_levels_mv.name
                    ELSE NULL::text
                END) AS biome_level_2,
            max(
                CASE
                    WHEN (sample_biome_levels_mv.level = 3) THEN sample_biome_levels_mv.name
                    ELSE NULL::text
                END) AS biome_level_3,
            max(
                CASE
                    WHEN (sample_biome_levels_mv.level = 4) THEN sample_biome_levels_mv.name
                    ELSE NULL::text
                END) AS biome_level_4
           FROM public.sample_biome_levels_mv
          GROUP BY sample_biome_levels_mv.sample_id
        ), ranked_samples AS (
         SELECT bs.bgc_id,
            bs.sample_id,
            sl.biome_level_1,
            sl.biome_level_2,
            sl.biome_level_3,
            sl.biome_level_4,
            NULLIF(s.environment_biome, ''::text) AS environment_biome,
            NULLIF(s.environment_feature, ''::text) AS environment_feature,
            NULLIF(s.environment_material, ''::text) AS environment_material,
            row_number() OVER (PARTITION BY bs.bgc_id ORDER BY (((
                CASE
                    WHEN (sl.biome_level_1 IS NOT NULL) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN (sl.biome_level_2 IS NOT NULL) THEN 1
                    ELSE 0
                END) +
                CASE
                    WHEN (sl.biome_level_3 IS NOT NULL) THEN 1
                    ELSE 0
                END) +
                CASE
                    WHEN (sl.biome_level_4 IS NOT NULL) THEN 1
                    ELSE 0
                END) DESC, ((
                CASE
                    WHEN ((s.environment_biome IS NOT NULL) AND (s.environment_biome <> ''::text)) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN ((s.environment_feature IS NOT NULL) AND (s.environment_feature <> ''::text)) THEN 1
                    ELSE 0
                END) +
                CASE
                    WHEN ((s.environment_material IS NOT NULL) AND (s.environment_material <> ''::text)) THEN 1
                    ELSE 0
                END) DESC, bs.sample_id) AS rn
           FROM ((bgc_samples bs
             JOIN public.samples s ON ((s.id = bs.sample_id)))
             LEFT JOIN sample_levels sl ON ((sl.sample_id = bs.sample_id)))
        )
 SELECT bgc_id,
    sample_id,
    biome_level_1,
    biome_level_2,
    biome_level_3,
    biome_level_4,
    environment_biome,
    environment_feature,
    environment_material,
    COALESCE(biome_level_1, environment_biome, environment_feature, environment_material, 'Unknown'::text) AS resolved_biome_level_1,
    COALESCE(biome_level_2, biome_level_1, environment_biome, environment_feature, environment_material, 'Unknown'::text) AS resolved_biome_level_2,
    COALESCE(biome_level_3, biome_level_2, biome_level_1, environment_biome, environment_feature, environment_material, 'Unknown'::text) AS resolved_biome_level_3,
    COALESCE(biome_level_4, biome_level_3, biome_level_2, biome_level_1, environment_biome, environment_feature, environment_material, 'Unknown'::text) AS resolved_biome_level_4
   FROM ranked_samples
  WHERE (rn = 1)
  WITH NO DATA;


--
-- Name: bgc_biome_level_1_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_biome_level_1_distribution_mv AS
 WITH grouping_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            bbs.resolved_biome_level_1 AS group_label
           FROM (public.bgcs b
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
        )
 SELECT COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text) AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM grouping_base
  GROUP BY COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  WITH NO DATA;


--
-- Name: bgc_biome_level_2_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_biome_level_2_distribution_mv AS
 WITH grouping_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            bbs.resolved_biome_level_2 AS group_label
           FROM (public.bgcs b
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
        )
 SELECT COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text) AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM grouping_base
  GROUP BY COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  WITH NO DATA;


--
-- Name: bgc_biome_level_3_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_biome_level_3_distribution_mv AS
 WITH grouping_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            bbs.resolved_biome_level_3 AS group_label
           FROM (public.bgcs b
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
        )
 SELECT COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text) AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM grouping_base
  GROUP BY COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  WITH NO DATA;


--
-- Name: bgc_biome_level_4_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_biome_level_4_distribution_mv AS
 WITH grouping_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            bbs.resolved_biome_level_4 AS group_label
           FROM (public.bgcs b
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
        )
 SELECT COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text) AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM grouping_base
  GROUP BY COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  WITH NO DATA;


--
-- Name: data_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_sources (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    source_type text NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    source_url text,
    user_upload_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    display_name text,
    CONSTRAINT data_sources_source_type_check CHECK ((source_type = ANY (ARRAY['third_party'::text, 'user_upload'::text, 'custom'::text])))
);


--
-- Name: COLUMN data_sources.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.data_sources.display_name IS 'Presentation name for UI. NULL when `name` is already presentable; read as COALESCE(display_name, name).';


--
-- Name: studies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    external_id text,
    title text,
    abstract text,
    study_type text,
    study_name text,
    center_name text,
    accession text,
    bioproject text,
    secondary_accession text,
    data_source_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    biome_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    abstract_source text,
    abstract_doi text,
    abstract_license text,
    abstract_publisher text,
    abstract_withheld boolean DEFAULT false NOT NULL,
    CONSTRAINT studies_abstract_source_check CHECK (((abstract_source IS NULL) OR (abstract_source = ANY (ARRAY['crossref'::text, 'europepmc'::text, 'ena'::text, 'mgnify'::text])))),
    CONSTRAINT studies_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: COLUMN studies.accession; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.accession IS 'Primary accession identifier for the study (e.g., from ENA/NCBI)';


--
-- Name: COLUMN studies.bioproject; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.bioproject IS 'BioProject identifier associated with the study';


--
-- Name: COLUMN studies.secondary_accession; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.secondary_accession IS 'Secondary accession identifier for the study';


--
-- Name: COLUMN studies.data_source_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.data_source_ids IS 'Array of data_sources.id values indicating provenance for this study';


--
-- Name: COLUMN studies.biome_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.biome_ids IS 'Array of biomes.id values linked to this study';


--
-- Name: COLUMN studies.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.metadata IS 'Free-form key-value metadata as JSON object (use jsonb operators for querying)';


--
-- Name: COLUMN studies.abstract_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.abstract_source IS 'Where abstract came from: crossref | europepmc (both verbatim publisher text -- check abstract_license before rendering) | ena | mgnify. NULL = no abstract, or provenance never established; treat NULL as not redistributable.';


--
-- Name: COLUMN studies.abstract_doi; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.abstract_doi IS 'The single DOI that actually supplied abstract, resolved from the comma-joined metadata->>''doi'' list. NULL unless abstract_source = ''crossref''.';


--
-- Name: COLUMN studies.abstract_license; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.abstract_license IS 'Raw licence URL from the Crossref work record, CC preferred over TDM-only when the work lists both. NULL means Crossref published no licence, which reads as closed.';


--
-- Name: COLUMN studies.abstract_publisher; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.abstract_publisher IS 'Crossref publisher name, for the attribution line under a rendered abstract.';


--
-- Name: COLUMN studies.abstract_withheld; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.studies.abstract_withheld IS 'True when an abstract was held and then deleted as not redistributable. Distinguishes a deliberate removal from a study that simply has no abstract; the fill-only backfills must not refetch text for these rows.';


--
-- Name: study_samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_samples (
    study_id uuid NOT NULL,
    sample_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sample_summary; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.sample_summary AS
 WITH assembly_count_agg AS (
         SELECT sample_assemblies.sample_id,
            (count(*))::integer AS assembly_count
           FROM public.sample_assemblies
          GROUP BY sample_assemblies.sample_id
        ), bgc_count_agg AS (
         SELECT sa.sample_id,
            (count(b.id))::integer AS bgc_count
           FROM (public.sample_assemblies sa
             JOIN public.bgcs b ON ((b.assembly = sa.assembly_id)))
          GROUP BY sa.sample_id
        ), data_source_names_agg AS (
         SELECT s_1.id AS sample_id,
            array_agg(ds.name ORDER BY ds.name) AS names
           FROM (public.samples s_1
             JOIN public.data_sources ds ON ((ds.id = ANY (s_1.data_source_ids))))
          GROUP BY s_1.id
        ), study_titles_agg AS (
         SELECT ss.sample_id,
            array_agg(COALESCE(stu.title, stu.study_name) ORDER BY stu.title, stu.study_name) AS study_titles
           FROM (public.study_samples ss
             JOIN public.studies stu ON ((stu.id = ss.study_id)))
          GROUP BY ss.sample_id
        ), source_types_agg AS (
         SELECT sa.sample_id,
            array_agg(DISTINCT a.source_type) AS source_types
           FROM (public.sample_assemblies sa
             JOIN public.assemblies a ON ((a.id = sa.assembly_id)))
          GROUP BY sa.sample_id
        ), biome_candidates AS (
         SELECT sb.sample_id,
            b.name AS biome_name,
            1 AS priority,
            b.level AS lvl
           FROM (public.sample_biomes sb
             JOIN public.biomes b ON ((b.id = sb.biome_id)))
          WHERE ((b.parent_id IS NULL) AND ((b.name IS NULL) OR ((b.name)::text !~* '^root$'::text)))
        UNION ALL
         SELECT sb.sample_id,
            p.name AS biome_name,
            2 AS priority,
            p.level AS lvl
           FROM ((public.sample_biomes sb
             JOIN public.biomes c ON ((c.id = sb.biome_id)))
             JOIN public.biomes p ON ((p.id = c.parent_id)))
          WHERE ((p.name IS NULL) OR ((p.name)::text !~* '^root$'::text))
        UNION ALL
         SELECT sb.sample_id,
            b.name AS biome_name,
            3 AS priority,
            b.level AS lvl
           FROM (public.sample_biomes sb
             JOIN public.biomes b ON ((b.id = sb.biome_id)))
          WHERE ((b.name IS NULL) OR ((b.name)::text !~* '^root$'::text))
        ), primary_biome_agg AS (
         SELECT DISTINCT ON (biome_candidates.sample_id) biome_candidates.sample_id,
            biome_candidates.biome_name AS primary_biome
           FROM biome_candidates
          ORDER BY biome_candidates.sample_id, biome_candidates.priority, biome_candidates.lvl NULLS FIRST, biome_candidates.biome_name
        )
 SELECT s.id,
    s.external_id,
    s.name,
    s.description,
    s.geographic_location,
    s.geolocation_name,
    s.location_resolution,
    s.latitude,
    s.longitude,
    s.depth,
    s.depth_min_meters,
    s.depth_max_meters,
    s.elevation_meters,
    s.temperature,
    s.ph,
    s.salinity,
    s.salinity_unit,
    s.current_precipitation_mm,
    s.mean_annual_precipitation_mm,
    s.mean_annual_temperature,
    s.environmental_package,
    s.environment_biome,
    pb.primary_biome,
    s.environment_feature,
    s.environment_material,
    s.host_taxid,
    s.host_scientific_name,
    s.sample_alias,
    s.accession,
    s.data_source_ids,
    s.collection_date,
    s.collection_date_end,
    s.metadata,
    s.gold_ecosystem_path,
    s.gold_ecosystem_metadata,
    s.created_at,
    s.updated_at,
    COALESCE(ac.assembly_count, 0) AS assembly_count,
    COALESCE(bc.bgc_count, 0) AS bgc_count,
    COALESCE(dsn.names, (ARRAY[]::text[])::character varying[]) AS data_source_names,
    COALESCE(stt.study_titles, ARRAY[]::text[]) AS study_titles,
    COALESCE(sty.source_types, ARRAY[]::text[]) AS source_types
   FROM ((((((public.samples s
     LEFT JOIN assembly_count_agg ac ON ((ac.sample_id = s.id)))
     LEFT JOIN bgc_count_agg bc ON ((bc.sample_id = s.id)))
     LEFT JOIN data_source_names_agg dsn ON ((dsn.sample_id = s.id)))
     LEFT JOIN study_titles_agg stt ON ((stt.sample_id = s.id)))
     LEFT JOIN source_types_agg sty ON ((sty.sample_id = s.id)))
     LEFT JOIN primary_biome_agg pb ON ((pb.sample_id = s.id)))
  WITH NO DATA;


--
-- Name: bgc_data_source_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_data_source_counts AS
 SELECT ds.name AS data_source,
    count(DISTINCT b.id) AS bgc_count
   FROM ((((public.bgcs b
     JOIN public.sample_assemblies sa ON ((sa.assembly_id = b.assembly)))
     JOIN public.sample_summary ss ON ((ss.id = sa.sample_id)))
     CROSS JOIN LATERAL unnest(ss.data_source_names) dn(dn))
     JOIN public.data_sources ds ON (((ds.name)::text = (dn.dn)::text)))
  GROUP BY ds.name
  WITH NO DATA;


--
-- Name: bgc_environment_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_environment_distribution_mv AS
 WITH grouping_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            COALESCE(bbs.environment_biome, bbs.resolved_biome_level_1, 'Unknown'::text) AS group_label
           FROM (public.bgcs b
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
        )
 SELECT COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text) AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM grouping_base
  GROUP BY COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  WITH NO DATA;


--
-- Name: bgc_feature_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_feature_distribution_mv AS
 WITH grouping_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            COALESCE(bbs.environment_feature, bbs.resolved_biome_level_2, bbs.resolved_biome_level_1, 'Unknown'::text) AS group_label
           FROM (public.bgcs b
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
        )
 SELECT COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text) AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM grouping_base
  GROUP BY COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  WITH NO DATA;


--
-- Name: bgc_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bgc_features (
    bgc_id uuid CONSTRAINT bgc_features_v3_stage_bgc_id_not_null NOT NULL,
    completeness_class text,
    route text,
    placement_status text,
    final_cluster_id uuid,
    n_biosynthetic integer,
    n_biosynthetic_add integer,
    n_regulatory integer,
    n_transport integer,
    n_resistance integer,
    n_other integer,
    hypothetical_count integer,
    n_pfam_domain integer,
    n_asdomain integer,
    n_asmodule integer,
    asdomain_types_ordered text[],
    sec_met_domains text[],
    core_gene_types text[],
    ordered_asdomain_string text,
    cand_kinds text[],
    n_protoclusters integer,
    proto_core_span_bp bigint,
    hybrid_structure text,
    contig_length bigint,
    contig_edge boolean,
    warnings text[],
    record_id text,
    region integer,
    primary_category text
);


--
-- Name: bgc_gbk_offsets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bgc_gbk_offsets (
    bgc_id uuid NOT NULL,
    gbk_offset bigint NOT NULL,
    gbk_length integer NOT NULL,
    archive_build text NOT NULL
);


--
-- Name: bgc_gcf; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bgc_gcf (
    bgc_id uuid CONSTRAINT bgc_gcf_v3_stage_bgc_id_not_null NOT NULL,
    gcf_id uuid CONSTRAINT bgc_gcf_v3_stage_gcf_id_not_null NOT NULL,
    distance double precision,
    is_primary boolean CONSTRAINT bgc_gcf_v3_stage_is_primary_not_null NOT NULL,
    rank smallint CONSTRAINT bgc_gcf_v3_stage_rank_not_null NOT NULL
);


--
-- Name: bgc_gold_bucket_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_gold_bucket_counts AS
 SELECT bucket,
    count(DISTINCT bgc_id) AS bgc_count
   FROM ( SELECT b.id AS bgc_id,
                CASE
                    WHEN (s.gold_ecosystem_path ~~* 'Host-associated:Plants%'::text) THEN 'host-plant'::text
                    WHEN (s.gold_ecosystem_path ~~* 'Host-associated%'::text) THEN 'host-animal'::text
                    WHEN (s.gold_ecosystem_path ~~* 'Environmental:Aquatic:Marine%'::text) THEN 'marine'::text
                    WHEN (s.gold_ecosystem_path ~~* 'Environmental:Aquatic:Freshwater%'::text) THEN 'freshwater'::text
                    WHEN (s.gold_ecosystem_path ~~* 'Environmental:Terrestrial%'::text) THEN 'soil-terrestrial'::text
                    WHEN (s.gold_ecosystem_path ~~* 'Environmental%'::text) THEN 'other-environmental'::text
                    WHEN (s.gold_ecosystem_path ~~* 'Engineered%'::text) THEN 'engineered'::text
                    WHEN (s.gold_ecosystem_path ~~* 'Mixed%'::text) THEN 'mixed'::text
                    ELSE NULL::text
                END AS bucket
           FROM ((public.bgcs b
             JOIN public.sample_assemblies sa ON ((sa.assembly_id = b.assembly)))
             JOIN public.samples s ON ((s.id = sa.sample_id)))
          WHERE (s.gold_ecosystem_path IS NOT NULL)) x
  WHERE (bucket IS NOT NULL)
  GROUP BY bucket
  WITH NO DATA;


--
-- Name: bgc_gold_ecosystem_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_gold_ecosystem_distribution_mv AS
 WITH gold AS MATERIALIZED (
         SELECT b.is_complete,
            sb.gold_ecosystem_path AS path
           FROM (((public.bgcs b
             JOIN public.assemblies a ON ((b.assembly = a.id)))
             JOIN public.sample_assemblies sa ON ((sa.assembly_id = a.id)))
             JOIN public.sample_summary sb ON ((sb.id = sa.sample_id)))
          WHERE ((sb.gold_ecosystem_path IS NOT NULL) AND (sb.gold_ecosystem_path <> ''::text))
        ), levels AS (
         SELECT 1 AS level,
            split_part(gold.path, ':'::text, 1) AS name,
            gold.is_complete
           FROM gold
        UNION ALL
         SELECT 2,
                CASE
                    WHEN (split_part(gold.path, ':'::text, 2) <> ''::text) THEN ((split_part(gold.path, ':'::text, 1) || ':'::text) || split_part(gold.path, ':'::text, 2))
                    ELSE NULL::text
                END AS "case",
            gold.is_complete
           FROM gold
        UNION ALL
         SELECT 3,
                CASE
                    WHEN (split_part(gold.path, ':'::text, 3) <> ''::text) THEN ((((split_part(gold.path, ':'::text, 1) || ':'::text) || split_part(gold.path, ':'::text, 2)) || ':'::text) || split_part(gold.path, ':'::text, 3))
                    ELSE NULL::text
                END AS "case",
            gold.is_complete
           FROM gold
        UNION ALL
         SELECT 4,
                CASE
                    WHEN (split_part(gold.path, ':'::text, 4) <> ''::text) THEN ((((((split_part(gold.path, ':'::text, 1) || ':'::text) || split_part(gold.path, ':'::text, 2)) || ':'::text) || split_part(gold.path, ':'::text, 3)) || ':'::text) || split_part(gold.path, ':'::text, 4))
                    ELSE NULL::text
                END AS "case",
            gold.is_complete
           FROM gold
        UNION ALL
         SELECT 5,
                CASE
                    WHEN (split_part(gold.path, ':'::text, 5) <> ''::text) THEN gold.path
                    ELSE NULL::text
                END AS "case",
            gold.is_complete
           FROM gold
        )
 SELECT level,
    name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial
   FROM levels
  WHERE ((name IS NOT NULL) AND (name <> ''::text))
  GROUP BY level, name
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW bgc_gold_ecosystem_distribution_mv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.bgc_gold_ecosystem_distribution_mv IS 'Global BGC distribution by GOLD ecosystem path at each level (1-5): level, name (path prefix), complete, partial. Refresh via refresh_bgc_statistics().';


--
-- Name: bgc_material_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_material_distribution_mv AS
 WITH grouping_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            COALESCE(bbs.environment_material, bbs.environment_feature, bbs.environment_biome, bbs.resolved_biome_level_1, 'Unknown'::text) AS group_label
           FROM (public.bgcs b
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
        )
 SELECT COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text) AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM grouping_base
  GROUP BY COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, COALESCE(NULLIF(group_label, ''::text), 'Unknown'::text)
  WITH NO DATA;


--
-- Name: bgc_product_category_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_product_category_distribution_mv AS
 WITH class_base AS (
         SELECT b.id AS bgc_id,
            b.is_complete,
            COALESCE(NULLIF(pc.class_name, ''::text), 'Unclassified'::text) AS product_class
           FROM (public.bgcs b
             LEFT JOIN LATERAL ( SELECT unnest(
                        CASE
                            WHEN (array_length(b.product_category, 1) > 0) THEN b.product_category
                            ELSE ARRAY['Unclassified'::text]
                        END) AS class_name) pc ON (true))
        )
 SELECT product_class AS name,
    sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END) AS complete,
    sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END) AS partial,
    count(*) AS total
   FROM class_base
  GROUP BY product_class
  ORDER BY (sum(
        CASE
            WHEN is_complete THEN 1
            ELSE 0
        END)) DESC, (sum(
        CASE
            WHEN (NOT is_complete) THEN 1
            ELSE 0
        END)) DESC, product_class
  WITH NO DATA;


--
-- Name: bgc_product_facet_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.bgc_product_facet_counts AS
 SELECT 'product'::text AS kind,
    s.t AS value,
    count(*) AS bgc_count
   FROM ( SELECT unnest(b.product) AS t
           FROM public.bgcs b) s
  WHERE (s.t IS NOT NULL)
  GROUP BY s.t
UNION ALL
 SELECT 'category'::text AS kind,
    s.c AS value,
    count(*) AS bgc_count
   FROM ( SELECT unnest(b.product_category) AS c
           FROM public.bgcs b) s
  WHERE (s.c IS NOT NULL)
  GROUP BY s.c
  WITH NO DATA;


--
-- Name: bgc_redirect; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bgc_redirect (
    old_bgc_id uuid NOT NULL,
    twin_bgc_id uuid NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bgc_taxonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bgc_taxonomy (
    bgc_id uuid NOT NULL,
    taxonomy_id uuid NOT NULL,
    rank text NOT NULL,
    support real,
    method text NOT NULL,
    CONSTRAINT bgc_taxonomy_method_check CHECK ((method = ANY (ARRAY['gtdb_r232'::text, 'gtdb_legacy'::text, 'orf_lca_v1'::text, 'mmseqs_v1'::text]))),
    CONSTRAINT bgc_taxonomy_rank_check CHECK ((rank = ANY (ARRAY['domain'::text, 'phylum'::text, 'class'::text, 'order'::text, 'family'::text, 'genus'::text, 'species'::text])))
);


--
-- Name: TABLE bgc_taxonomy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bgc_taxonomy IS 'Authoritative per-BGC taxonomy (taxonomy v2). Replaces bgcs.taxonomy_id.';


--
-- Name: COLUMN bgc_taxonomy.rank; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bgc_taxonomy.rank IS 'Deepest rank called; equals the depth of the joined taxonomies.gtdb_lineage.';


--
-- Name: COLUMN bgc_taxonomy.support; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bgc_taxonomy.support IS 'ORF-LCA agreement fraction (0.5-1.0); NULL when genome-derived.';


--
-- Name: COLUMN bgc_taxonomy.method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bgc_taxonomy.method IS 'gtdb_r232 = genome-derived (GTDB isolates); orf_lca_v1 = predicted.';


--
-- Name: bgcs_per_assembly; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bgcs_per_assembly AS
 SELECT b.assembly,
    count(*) AS bgc_count,
    count(
        CASE
            WHEN b.is_complete THEN 1
            ELSE NULL::integer
        END) AS complete_bgc_count,
    count(cl.bgc_id) AS clustered_bgc_count,
    min(b.created_at) AS first_bgc_added,
    max(b.created_at) AS last_bgc_added
   FROM (public.bgcs b
     LEFT JOIN ( SELECT DISTINCT bgc_gcf.bgc_id
           FROM public.bgc_gcf) cl ON ((cl.bgc_id = b.id)))
  GROUP BY b.assembly;


--
-- Name: bgcs_per_run; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bgcs_per_run AS
 SELECT ra.run_id,
    count(b.id) AS bgc_count,
    count(
        CASE
            WHEN b.is_complete THEN 1
            ELSE NULL::integer
        END) AS complete_bgc_count,
    count(DISTINCT b.assembly) AS assembly_count,
    min(b.created_at) AS first_bgc_added,
    max(b.created_at) AS last_bgc_added
   FROM (public.run_assemblies ra
     LEFT JOIN public.bgcs b ON ((b.assembly = ra.assembly_id)))
  GROUP BY ra.run_id;


--
-- Name: bigslice_search_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bigslice_search_results (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(255) NOT NULL,
    orig_filename text NOT NULL,
    bgc_id uuid,
    gcf_id uuid,
    distance numeric(10,6) NOT NULL,
    rank integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bigslice_gcf_id integer,
    tier text NOT NULL,
    CONSTRAINT bigslice_search_results_tier_check CHECK ((tier = ANY (ARRAY['seed'::text, 'fragmented'::text])))
);


--
-- Name: COLUMN bigslice_search_results.gcf_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bigslice_search_results.gcf_id IS 'Atlas gcfs.id (nullable). NULL until BiG-SLiCE GCFs are linked to Atlas GCFs.';


--
-- Name: COLUMN bigslice_search_results.distance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bigslice_search_results.distance IS 'BiG-SLiCE feature distance to the family centroid; lower is nearer. The 0.4 clustering threshold is applied by the app AFTER parsing -- BiG-SLiCE query mode ignores --threshold (Membership.assign is called with threshold=None).';


--
-- Name: COLUMN bigslice_search_results.bigslice_gcf_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bigslice_search_results.bigslice_gcf_id IS 'Raw BiG-SLiCE gcf.id from the queried model. Resolve to an Atlas family via the tier: seed -> GCF-{id:06d}, fragmented -> GCF-F-{400000+id:06d}.';


--
-- Name: COLUMN bigslice_search_results.tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bigslice_search_results.tier IS 'Which v3 model produced this hit: seed (bigslice-output-v3) or fragmented (bigslice-output-residual-v3). Required to interpret bigslice_gcf_id, whose id space differs between the two models.';


--
-- Name: bigslice_search_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bigslice_search_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(255) NOT NULL,
    session_hash character varying(64) NOT NULL,
    num_files integer NOT NULL,
    total_file_size_bytes bigint NOT NULL,
    distance_threshold numeric(3,2) NOT NULL,
    job_id character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    progress integer DEFAULT 0,
    error_message text,
    total_matches integer DEFAULT 0,
    search_duration_ms integer,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: data_source_statistics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.data_source_statistics AS
 WITH direct AS (
         SELECT a.id AS assembly_id,
            ds.id AS data_source_id
           FROM (public.assemblies a
             JOIN public.data_sources ds ON ((ds.id = ANY (a.data_source_ids))))
          WHERE ((ds.name)::text <> 'metalog'::text)
        ), via_sample AS (
         SELECT a.id AS assembly_id,
            ds.id AS data_source_id
           FROM (((public.assemblies a
             JOIN public.sample_assemblies sa ON ((sa.assembly_id = a.id)))
             JOIN public.samples s ON ((s.id = sa.sample_id)))
             JOIN public.data_sources ds ON ((ds.id = ANY (s.data_source_ids))))
          WHERE ((a.data_source_ids = '{}'::uuid[]) AND ((ds.name)::text <> 'metalog'::text))
        ), assembly_source AS (
         SELECT direct.assembly_id,
            direct.data_source_id
           FROM direct
        UNION ALL
         SELECT via_sample.assembly_id,
            via_sample.data_source_id
           FROM via_sample
        ), per_source AS (
         SELECT asrc.data_source_id,
            (count(*))::integer AS assembly_count,
            mode() WITHIN GROUP (ORDER BY a.source_type) AS primary_source_type
           FROM (assembly_source asrc
             JOIN public.assemblies a ON ((a.id = asrc.assembly_id)))
          GROUP BY asrc.data_source_id
        ), per_source_bgcs AS (
         SELECT asrc.data_source_id,
            (count(*))::integer AS bgc_count
           FROM (assembly_source asrc
             JOIN public.bgcs b ON ((b.assembly = asrc.assembly_id)))
          GROUP BY asrc.data_source_id
        )
 SELECT p.data_source_id,
    p.assembly_count,
    COALESCE(pb.bgc_count, 0) AS bgc_count,
    p.primary_source_type
   FROM (per_source p
     LEFT JOIN per_source_bgcs pb ON ((pb.data_source_id = p.data_source_id)))
  WITH NO DATA;


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    message text NOT NULL,
    email text,
    page text,
    status text DEFAULT 'new'::text NOT NULL,
    CONSTRAINT feedback_email_check CHECK (((email IS NULL) OR (char_length(email) <= 320))),
    CONSTRAINT feedback_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 5000))),
    CONSTRAINT feedback_page_check CHECK (((page IS NULL) OR (char_length(page) <= 2000))),
    CONSTRAINT feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'done'::text])))
);


--
-- Name: gcf_assembly_source_stats_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_assembly_source_stats_mv AS
 SELECT bg.gcf_id,
    a.source_type,
    count(DISTINCT b.assembly) AS assembly_count,
    count(b.id) AS bgc_count,
    avg(bg.distance) AS avg_distance
   FROM ((public.bgcs b
     JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
     JOIN public.assemblies a ON ((a.id = b.assembly)))
  GROUP BY bg.gcf_id, a.source_type
  WITH NO DATA;


--
-- Name: gcf_category_combination_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_category_combination_mv AS
 SELECT bg.gcf_id,
    combo.combination,
    count(*) AS bgc_count
   FROM ((public.bgc_gcf bg
     JOIN public.bgcs b ON ((b.id = bg.bgc_id)))
     CROSS JOIN LATERAL ( SELECT string_agg(d.c, '+'::text ORDER BY COALESCE(array_position(ARRAY['NRPS'::text, 'PKS'::text, 'RiPP'::text, 'terpene'::text, 'saccharide'::text, 'other'::text], d.c), 99), d.c) AS combination
           FROM ( SELECT DISTINCT u.c
                   FROM unnest(b.product_category) u(c)
                  WHERE ((u.c IS NOT NULL) AND (u.c <> ''::text))) d) combo)
  WHERE (bg.is_primary AND (combo.combination IS NOT NULL))
  GROUP BY bg.gcf_id, combo.combination
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW gcf_category_combination_mv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.gcf_category_combination_mv IS 'Primary members per GCF per EXACT product-category set (''NRPS+PKS''), categories in canonical order. A partition of each family: every member with a category is in exactly one row. Migration 0119.';


--
-- Name: gcf_gold_ecosystem_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_gold_ecosystem_distribution_mv AS
 WITH gcf_gold_paths AS (
         SELECT bg.gcf_id,
            split_part(ss.gold_ecosystem_path, ':'::text, 1) AS gold_level_1,
            split_part(ss.gold_ecosystem_path, ':'::text, 2) AS gold_level_2,
            split_part(ss.gold_ecosystem_path, ':'::text, 3) AS gold_level_3,
            split_part(ss.gold_ecosystem_path, ':'::text, 4) AS gold_level_4,
            split_part(ss.gold_ecosystem_path, ':'::text, 5) AS gold_level_5,
            b.id AS bgc_id
           FROM ((((public.bgcs b
             JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
             JOIN public.assemblies a ON ((b.assembly = a.id)))
             JOIN public.sample_assemblies sa ON ((sa.assembly_id = a.id)))
             JOIN public.sample_summary ss ON ((ss.id = sa.sample_id)))
          WHERE ((ss.gold_ecosystem_path IS NOT NULL) AND (ss.gold_ecosystem_path <> ''::text))
        ), level_1_counts AS (
         SELECT gcf_gold_paths.gcf_id,
            1 AS level,
            gcf_gold_paths.gold_level_1 AS ecosystem,
            count(DISTINCT gcf_gold_paths.bgc_id) AS bgc_count
           FROM gcf_gold_paths
          WHERE ((gcf_gold_paths.gold_level_1 IS NOT NULL) AND (gcf_gold_paths.gold_level_1 <> ''::text))
          GROUP BY gcf_gold_paths.gcf_id, gcf_gold_paths.gold_level_1
        ), level_2_counts AS (
         SELECT gcf_gold_paths.gcf_id,
            2 AS level,
            gcf_gold_paths.gold_level_2 AS ecosystem,
            count(DISTINCT gcf_gold_paths.bgc_id) AS bgc_count
           FROM gcf_gold_paths
          WHERE ((gcf_gold_paths.gold_level_2 IS NOT NULL) AND (gcf_gold_paths.gold_level_2 <> ''::text))
          GROUP BY gcf_gold_paths.gcf_id, gcf_gold_paths.gold_level_2
        ), level_3_counts AS (
         SELECT gcf_gold_paths.gcf_id,
            3 AS level,
            gcf_gold_paths.gold_level_3 AS ecosystem,
            count(DISTINCT gcf_gold_paths.bgc_id) AS bgc_count
           FROM gcf_gold_paths
          WHERE ((gcf_gold_paths.gold_level_3 IS NOT NULL) AND (gcf_gold_paths.gold_level_3 <> ''::text))
          GROUP BY gcf_gold_paths.gcf_id, gcf_gold_paths.gold_level_3
        ), level_4_counts AS (
         SELECT gcf_gold_paths.gcf_id,
            4 AS level,
            gcf_gold_paths.gold_level_4 AS ecosystem,
            count(DISTINCT gcf_gold_paths.bgc_id) AS bgc_count
           FROM gcf_gold_paths
          WHERE ((gcf_gold_paths.gold_level_4 IS NOT NULL) AND (gcf_gold_paths.gold_level_4 <> ''::text))
          GROUP BY gcf_gold_paths.gcf_id, gcf_gold_paths.gold_level_4
        ), level_5_counts AS (
         SELECT gcf_gold_paths.gcf_id,
            5 AS level,
            gcf_gold_paths.gold_level_5 AS ecosystem,
            count(DISTINCT gcf_gold_paths.bgc_id) AS bgc_count
           FROM gcf_gold_paths
          WHERE ((gcf_gold_paths.gold_level_5 IS NOT NULL) AND (gcf_gold_paths.gold_level_5 <> ''::text))
          GROUP BY gcf_gold_paths.gcf_id, gcf_gold_paths.gold_level_5
        ), all_counts AS (
         SELECT level_1_counts.gcf_id,
            level_1_counts.level,
            level_1_counts.ecosystem,
            level_1_counts.bgc_count
           FROM level_1_counts
        UNION ALL
         SELECT level_2_counts.gcf_id,
            level_2_counts.level,
            level_2_counts.ecosystem,
            level_2_counts.bgc_count
           FROM level_2_counts
        UNION ALL
         SELECT level_3_counts.gcf_id,
            level_3_counts.level,
            level_3_counts.ecosystem,
            level_3_counts.bgc_count
           FROM level_3_counts
        UNION ALL
         SELECT level_4_counts.gcf_id,
            level_4_counts.level,
            level_4_counts.ecosystem,
            level_4_counts.bgc_count
           FROM level_4_counts
        UNION ALL
         SELECT level_5_counts.gcf_id,
            level_5_counts.level,
            level_5_counts.ecosystem,
            level_5_counts.bgc_count
           FROM level_5_counts
        )
 SELECT gcf_id,
    level,
    ecosystem,
    bgc_count,
    sum(bgc_count) OVER (PARTITION BY gcf_id, level) AS total_bgcs_at_level,
    round((((bgc_count)::numeric / NULLIF(sum(bgc_count) OVER (PARTITION BY gcf_id, level), (0)::numeric)) * (100)::numeric), 1) AS percentage
   FROM all_counts
  WITH NO DATA;


--
-- Name: gcf_product_category_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_product_category_distribution_mv AS
 WITH category_counts AS (
         SELECT bg.gcf_id,
            pc.pc AS category,
            count(*) AS bgc_count
           FROM ((public.bgcs b
             JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
             CROSS JOIN LATERAL unnest(b.product_category) pc(pc))
          GROUP BY bg.gcf_id, pc.pc
        ), gcf_totals AS (
         SELECT category_counts.gcf_id,
            sum(category_counts.bgc_count) AS total_bgcs
           FROM category_counts
          GROUP BY category_counts.gcf_id
        )
 SELECT cc.gcf_id,
    cc.category,
    cc.bgc_count,
    gt.total_bgcs,
    round((((cc.bgc_count)::numeric / NULLIF(gt.total_bgcs, (0)::numeric)) * (100)::numeric), 1) AS percentage
   FROM (category_counts cc
     JOIN gcf_totals gt ON ((cc.gcf_id = gt.gcf_id)))
  WITH NO DATA;


--
-- Name: gcfs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcfs (
    id uuid CONSTRAINT gcfs_v3_stage_id_not_null NOT NULL,
    name character varying(200) CONSTRAINT gcfs_v3_stage_name_not_null NOT NULL,
    pet_name character varying(32) CONSTRAINT gcfs_v3_stage_pet_name_not_null NOT NULL,
    family_class text CONSTRAINT gcfs_v3_stage_family_class_not_null NOT NULL,
    listed boolean CONSTRAINT gcfs_v3_stage_listed_not_null NOT NULL,
    n_bgc integer CONSTRAINT gcfs_v3_stage_n_bgc_not_null NOT NULL,
    dom_category text,
    cluster_method character varying(100),
    representative_bgc_id uuid,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gcfs_family_class_check CHECK ((family_class = ANY (ARRAY['seed'::text, 'fragmented'::text])))
);


--
-- Name: gcf_summary_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_summary_mv AS
 WITH pc AS (
         SELECT bg_1.gcf_id,
            count(DISTINCT elem.elem) AS unique_product_categories,
            array_agg(DISTINCT elem.elem ORDER BY elem.elem) AS product_categories
           FROM ((public.bgc_gcf bg_1
             JOIN public.bgcs b_1 ON (((b_1.id = bg_1.bgc_id) AND bg_1.is_primary)))
             CROSS JOIN LATERAL unnest(b_1.product_category) elem(elem))
          WHERE (b_1.product_category IS NOT NULL)
          GROUP BY bg_1.gcf_id
        )
 SELECT g.id AS gcf_id,
    g.name AS gcf_name,
    g.cluster_method,
    g.family_class,
    g.listed,
    g.representative_bgc_id,
    g.description,
    g.created_at AS gcf_created_at,
    g.updated_at AS gcf_updated_at,
    count(b.id) AS member_bgc_count,
    count(DISTINCT b.assembly) AS assembly_count,
    count(DISTINCT
        CASE
            WHEN b.is_complete THEN b.id
            ELSE NULL::uuid
        END) AS complete_bgc_count,
    count(DISTINCT
        CASE
            WHEN (NOT b.is_complete) THEN b.id
            ELSE NULL::uuid
        END) AS partial_bgc_count,
    avg(bg.distance) AS avg_distance,
    min(bg.distance) AS min_distance,
    max(bg.distance) AS max_distance,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY bg.distance) AS median_distance,
    COALESCE(pc.unique_product_categories, (0)::bigint) AS unique_product_categories,
    COALESCE(pc.product_categories, ARRAY[]::text[]) AS product_categories,
    count(DISTINCT bt.taxonomy_id) FILTER (WHERE (bt.taxonomy_id IS NOT NULL)) AS unique_taxa_count,
    count(*) FILTER (WHERE (bf.route = 'seed'::text)) AS seed_assignments,
    count(*) FILTER (WHERE (bf.route = ANY (ARRAY['contained'::text, 'orphan_query'::text]))) AS derived_assignments,
    count(*) FILTER (WHERE (bf.route = 'novel'::text)) AS novel_assignments,
    min(b.created_at) AS first_bgc_added,
    max(b.created_at) AS last_bgc_added
   FROM (((((public.gcfs g
     LEFT JOIN public.bgc_gcf bg ON (((bg.gcf_id = g.id) AND bg.is_primary)))
     LEFT JOIN public.bgcs b ON ((b.id = bg.bgc_id)))
     LEFT JOIN public.bgc_taxonomy bt ON ((bt.bgc_id = b.id)))
     LEFT JOIN public.bgc_features bf ON ((bf.bgc_id = b.id)))
     LEFT JOIN pc ON ((pc.gcf_id = g.id)))
  GROUP BY g.id, g.name, g.cluster_method, g.family_class, g.listed, g.representative_bgc_id, g.description, g.created_at, g.updated_at, pc.unique_product_categories, pc.product_categories
  WITH NO DATA;


--
-- Name: gcf_taxonomy_distribution_mv; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcf_taxonomy_distribution_mv (
    gcf_id uuid NOT NULL,
    domain_distribution jsonb,
    rank_distributions jsonb
);


--
-- Name: TABLE gcf_taxonomy_distribution_mv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gcf_taxonomy_distribution_mv IS 'clustering-v2 cutover: EMPTY STUB (2026-07-24). Real per-gcf taxonomy JSONB backfill pending (optimized build, no correlated subquery). /api/gcfs COALESCEs the empty join to {}.';


--
-- Name: gcf_distributions_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_distributions_mv AS
 WITH eco_l1 AS (
         SELECT d.gcf_id,
            d.ecosystem,
            d.bgc_count,
            d.total_bgcs_at_level
           FROM public.gcf_gold_ecosystem_distribution_mv d
          WHERE (d.level = 1)
        ), eco_l2_plants AS (
         SELECT d.gcf_id,
            d.bgc_count AS plants_count
           FROM public.gcf_gold_ecosystem_distribution_mv d
          WHERE ((d.level = 2) AND (d.ecosystem = 'Plants'::text))
        ), eco_l1_split AS (
         SELECT s_1.gcf_id,
            s_1.ecosystem,
            s_1.bgc_count,
            s_1.total_bgcs_at_level
           FROM ( SELECT l1.gcf_id,
                    l1.ecosystem,
                        CASE
                            WHEN (l1.ecosystem = 'Host-associated'::text) THEN (l1.bgc_count - COALESCE(p.plants_count, (0)::bigint))
                            ELSE l1.bgc_count
                        END AS bgc_count,
                    l1.total_bgcs_at_level
                   FROM (eco_l1 l1
                     LEFT JOIN eco_l2_plants p ON ((p.gcf_id = l1.gcf_id)))
                UNION ALL
                 SELECT l1.gcf_id,
                    'Host-assoc.: Plants'::text AS ecosystem,
                    p.plants_count AS bgc_count,
                    l1.total_bgcs_at_level
                   FROM (eco_l1 l1
                     JOIN eco_l2_plants p ON ((p.gcf_id = l1.gcf_id)))
                  WHERE (l1.ecosystem = 'Host-associated'::text)) s_1
          WHERE (s_1.bgc_count > 0)
        ), eco_l1_pct AS (
         SELECT eco_l1_split.gcf_id,
            1 AS level,
            eco_l1_split.ecosystem,
            round((((eco_l1_split.bgc_count)::numeric / NULLIF(eco_l1_split.total_bgcs_at_level, (0)::numeric)) * (100)::numeric), 1) AS percentage
           FROM eco_l1_split
        ), eco_all AS (
         SELECT d.gcf_id,
            d.level,
            d.ecosystem,
            d.percentage
           FROM public.gcf_gold_ecosystem_distribution_mv d
          WHERE (d.level <> 1)
        UNION ALL
         SELECT eco_l1_pct.gcf_id,
            eco_l1_pct.level,
            eco_l1_pct.ecosystem,
            eco_l1_pct.percentage
           FROM eco_l1_pct
        ), eco AS (
         SELECT s_1.gcf_id,
            d.level,
            d.ecosystem,
            d.percentage
           FROM (public.gcf_summary_mv s_1
             LEFT JOIN eco_all d ON ((d.gcf_id = s_1.gcf_id)))
        ), eco_per_level AS (
         SELECT eco.gcf_id,
            eco.level,
            jsonb_object_agg(eco.ecosystem, eco.percentage) FILTER (WHERE (eco.ecosystem IS NOT NULL)) AS distribution,
            max(eco.percentage) AS max_pct,
            (array_agg(eco.ecosystem ORDER BY eco.percentage DESC NULLS LAST, eco.ecosystem))[1] AS dom_ecosystem
           FROM eco
          WHERE (eco.level IS NOT NULL)
          GROUP BY eco.gcf_id, eco.level
        ), eco_pivot AS (
         SELECT eco_per_level.gcf_id,
            jsonb_object_agg((eco_per_level.level)::text, eco_per_level.distribution) AS by_level,
            jsonb_object_agg((eco_per_level.level)::text, to_jsonb(eco_per_level.max_pct)) AS max_by_level,
            jsonb_object_agg((eco_per_level.level)::text, to_jsonb(eco_per_level.dom_ecosystem)) FILTER (WHERE (eco_per_level.dom_ecosystem IS NOT NULL)) AS dom_by_level
           FROM eco_per_level
          GROUP BY eco_per_level.gcf_id
        ), tax_dom AS (
         SELECT t.gcf_id,
            d.taxon AS dom_phylum,
            d.share AS dom_phylum_pct
           FROM (public.gcf_taxonomy_distribution_mv t
             LEFT JOIN LATERAL ( SELECT kv.key AS taxon,
                    ((kv.value #>> '{}'::text[]))::numeric AS share
                   FROM jsonb_each((t.rank_distributions -> 'phylum'::text)) kv(key, value)
                  WHERE (("right"(kv.key, 9) <> '__Unknown'::text) AND (jsonb_typeof(kv.value) = 'number'::text))
                  ORDER BY ((kv.value #>> '{}'::text[]))::numeric DESC, ((kv.key || '￿'::text) COLLATE "C")
                 LIMIT 1) d ON (true))
        ), prod AS (
         SELECT c.gcf_id,
            jsonb_object_agg(c.combination, round((((c.bgc_count)::numeric / (NULLIF(s_2.member_bgc_count, 0))::numeric) * (100)::numeric), 1)) AS distribution
           FROM (public.gcf_category_combination_mv c
             JOIN public.gcf_summary_mv s_2 ON ((s_2.gcf_id = c.gcf_id)))
          WHERE (s_2.member_bgc_count > 0)
          GROUP BY c.gcf_id
        ), cat_share AS (
         SELECT p.gcf_id,
            jsonb_object_agg(p.category, p.share) AS shares,
            array_agg(p.category ORDER BY p.share DESC, p.category) FILTER (WHERE (p.share >= (50)::numeric)) AS majority
           FROM ( SELECT d.gcf_id,
                    d.category,
                    round((((d.bgc_count)::numeric / (NULLIF(s_3.member_bgc_count, 0))::numeric) * (100)::numeric), 2) AS share
                   FROM (public.gcf_product_category_distribution_mv d
                     JOIN public.gcf_summary_mv s_3 ON ((s_3.gcf_id = d.gcf_id)))
                  WHERE (s_3.member_bgc_count > 0)) p
          GROUP BY p.gcf_id
        )
 SELECT s.gcf_id,
    COALESCE(((ep.by_level ->> '1'::text))::jsonb, '{}'::jsonb) AS biome_distribution_l1,
    COALESCE(((ep.by_level ->> '2'::text))::jsonb, '{}'::jsonb) AS biome_distribution_l2,
    COALESCE(((ep.by_level ->> '3'::text))::jsonb, '{}'::jsonb) AS biome_distribution_l3,
    COALESCE(((ep.by_level ->> '4'::text))::jsonb, '{}'::jsonb) AS biome_distribution_l4,
    COALESCE(((ep.by_level ->> '5'::text))::jsonb, '{}'::jsonb) AS biome_distribution_l5,
    ((ep.max_by_level ->> '1'::text))::numeric AS max_pct_l1,
    ((ep.max_by_level ->> '2'::text))::numeric AS max_pct_l2,
    ((ep.max_by_level ->> '3'::text))::numeric AS max_pct_l3,
    ((ep.max_by_level ->> '4'::text))::numeric AS max_pct_l4,
    ((ep.max_by_level ->> '5'::text))::numeric AS max_pct_l5,
    (ep.dom_by_level ->> '1'::text) AS dom_ecosystem_l1,
    (ep.dom_by_level ->> '3'::text) AS dom_ecosystem_l3,
    COALESCE(prod.distribution, '{}'::jsonb) AS product_category_distribution,
    td.dom_phylum,
    td.dom_phylum_pct,
    COALESCE(cs.shares, '{}'::jsonb) AS category_member_share,
    COALESCE(cs.majority, ARRAY[]::text[]) AS majority_categories
   FROM ((((public.gcf_summary_mv s
     LEFT JOIN eco_pivot ep ON ((ep.gcf_id = s.gcf_id)))
     LEFT JOIN prod ON ((prod.gcf_id = s.gcf_id)))
     LEFT JOIN tax_dom td ON ((td.gcf_id = s.gcf_id)))
     LEFT JOIN cat_share cs ON ((cs.gcf_id = s.gcf_id)))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW gcf_distributions_mv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.gcf_distributions_mv IS 'Per-GCF distributions as JSONB: GOLD ecosystem per level (level 1 with a synthetic ''Host-assoc.: Plants'' bucket, 0086), dominant ecosystem and phylum (0112), and product categories as shares of MEMBERS (0119): product_category_distribution is the exact-combination partition, category_member_share the overlapping per-category share, majority_categories those at >= 50%.';


--
-- Name: gcf_environmental_distribution_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_environmental_distribution_mv AS
 WITH gcf_biomes AS (
         SELECT bg.gcf_id,
            bbs.resolved_biome_level_1,
            bbs.resolved_biome_level_2,
            bbs.resolved_biome_level_3,
            count(*) AS bgc_count
           FROM ((public.bgcs b
             JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
             JOIN public.bgc_biome_summary_mv bbs ON ((bbs.bgc_id = b.id)))
          GROUP BY bg.gcf_id, bbs.resolved_biome_level_1, bbs.resolved_biome_level_2, bbs.resolved_biome_level_3
        )
 SELECT gcf_id,
    resolved_biome_level_1 AS biome_level_1,
    resolved_biome_level_2 AS biome_level_2,
    resolved_biome_level_3 AS biome_level_3,
    bgc_count,
    sum(bgc_count) OVER (PARTITION BY gcf_id) AS total_bgcs_in_gcf,
    (((bgc_count)::double precision / (NULLIF(sum(bgc_count) OVER (PARTITION BY gcf_id), (0)::numeric))::double precision) * (100)::double precision) AS biome_percentage
   FROM gcf_biomes
  WITH NO DATA;


--
-- Name: gcf_export_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcf_export_jobs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    job_id character varying(100) NOT NULL,
    gcf_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    progress integer DEFAULT 0,
    total_bgcs integer,
    processed_bgcs integer DEFAULT 0,
    missing_files integer DEFAULT 0,
    output_filename character varying(255),
    output_path text,
    file_size_bytes bigint,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_ms integer,
    error_message text,
    user_email character varying(255),
    user_ip inet,
    expires_at timestamp with time zone,
    is_deleted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    kind character varying(16) DEFAULT 'gcf'::character varying NOT NULL,
    search_query jsonb,
    search_href text,
    CONSTRAINT gcf_export_jobs_kind_check CHECK (((kind)::text = ANY ((ARRAY['gcf'::character varying, 'regions'::character varying])::text[]))),
    CONSTRAINT gcf_export_jobs_kind_gcf_check CHECK ((((kind)::text = 'gcf'::text) = (gcf_id IS NOT NULL)))
);


--
-- Name: TABLE gcf_export_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gcf_export_jobs IS 'GBK zip export jobs: one GCF''s members (kind gcf) or a property search''s matches (kind regions)';


--
-- Name: COLUMN gcf_export_jobs.job_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gcf_export_jobs.job_id IS 'BullMQ job ID for tracking queue status';


--
-- Name: COLUMN gcf_export_jobs.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gcf_export_jobs.status IS 'Job status: pending, running, completed, failed';


--
-- Name: COLUMN gcf_export_jobs.progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gcf_export_jobs.progress IS 'Completion percentage (0-100)';


--
-- Name: COLUMN gcf_export_jobs.missing_files; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gcf_export_jobs.missing_files IS 'Count of BGC GBK files that could not be found';


--
-- Name: COLUMN gcf_export_jobs.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gcf_export_jobs.expires_at IS 'Timestamp when the export file expires and should be deleted';


--
-- Name: COLUMN gcf_export_jobs.is_deleted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gcf_export_jobs.is_deleted IS 'Whether the export file has been deleted from disk';


--
-- Name: gcf_legacy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcf_legacy (
    gcf_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    pet_name character varying(32),
    family_class text,
    listed boolean NOT NULL,
    n_bgc integer NOT NULL,
    clustering text NOT NULL
);


--
-- Name: gcf_length_stats_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_length_stats_mv AS
 SELECT bg.gcf_id,
    count(*) AS member_count,
    count(*) FILTER (WHERE b.is_complete) AS complete_count,
    percentile_disc((0.5)::double precision) WITHIN GROUP (ORDER BY (b.end_pos - b.start_pos)) FILTER (WHERE b.is_complete) AS median_complete_len,
    min((b.end_pos - b.start_pos)) AS min_len,
    max((b.end_pos - b.start_pos)) AS max_len
   FROM ((public.bgc_gcf bg
     JOIN public.gcfs g ON ((g.id = bg.gcf_id)))
     JOIN public.bgcs b ON ((b.id = bg.bgc_id)))
  WHERE bg.is_primary
  GROUP BY bg.gcf_id
  WITH NO DATA;


--
-- Name: gcf_mibig_anchor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcf_mibig_anchor (
    gcf_id uuid NOT NULL,
    mibig_accession text NOT NULL,
    compounds text[] DEFAULT '{}'::text[] NOT NULL,
    chem_classes text[] DEFAULT '{}'::text[] NOT NULL,
    producer text,
    mibig_version integer,
    mibig_status text,
    membership_distance real
);


--
-- Name: TABLE gcf_mibig_anchor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gcf_mibig_anchor IS 'Characterized MIBiG references that are MEMBERS (BiG-SLiCE distance <= 0.4) of an atlas GCF, recovered from the two clustering-v3 data.db files. Rebuild with scripts/mibig/build_gcf_mibig_anchor.py after any re-clustering -- family ids and names do not survive one. Reference-only: no rows are added to bgcs or bgc_gcf.';


--
-- Name: COLUMN gcf_mibig_anchor.membership_distance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gcf_mibig_anchor.membership_distance IS 'BiG-SLiCE membership_value at rank 0, LOWER = better. Rows beyond 0.4 are NOT stored: a rank-0 gcf_membership row is the NEAREST family, not necessarily a member, and 680 of the 4,618 rank-0 MIBiG placements across the two runs are beyond the threshold.';


--
-- Name: product_category_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_category_map (
    product text NOT NULL,
    product_category text NOT NULL
);


--
-- Name: TABLE product_category_map; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_category_map IS 'antiSMASH product -> its category. Proven against all 16,491,574 BGCs on 2026-09-23 (migration 0116); re-prove after an antiSMASH version change.';


--
-- Name: gcf_product_type_matrix_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_product_type_matrix_mv AS
 SELECT bg.gcf_id,
    pcm.product_category,
    p.product,
    count(*) AS bgc_count
   FROM (((public.bgcs b
     JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
     CROSS JOIN LATERAL unnest(b.product) p(product))
     LEFT JOIN public.product_category_map pcm ON ((pcm.product = p.product)))
  WHERE (p.product IS NOT NULL)
  GROUP BY bg.gcf_id, pcm.product_category, p.product
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW gcf_product_type_matrix_mv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.gcf_product_type_matrix_mv IS 'Per-family (category, product) -> primary-member BGC count. Each product is paired with its own category via product_category_map (migration 0116), not by array position.';


--
-- Name: gcf_route_counts_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_route_counts_mv AS
 SELECT bg.gcf_id,
    count(*) FILTER (WHERE (bf.route = 'seed'::text)) AS seed_assignments,
    count(*) FILTER (WHERE (bf.route = 'contained'::text)) AS contained_assignments,
    count(*) FILTER (WHERE (bf.route = 'orphan_query'::text)) AS orphan_query_assignments,
    count(*) FILTER (WHERE (bf.route = 'novel'::text)) AS novel_assignments,
    count(*) AS total_assignments
   FROM (public.bgc_gcf bg
     JOIN public.bgc_features bf ON ((bf.bgc_id = bg.bgc_id)))
  WHERE bg.is_primary
  GROUP BY bg.gcf_id
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW gcf_route_counts_mv; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.gcf_route_counts_mv IS 'Per-family counts of bgc_features.route over PRIMARY memberships. Backs the "Assignment statistics" panel on /gcfs/[id]. Refresh after any re-clustering or bgc_features reload.';


--
-- Name: gcf_sample_map_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.gcf_sample_map_mv AS
 SELECT bg.gcf_id,
    s.id,
    s.external_id,
    s.name,
    s.geographic_location,
    s.geolocation_name,
    s.latitude,
    s.longitude,
    s.environment_biome,
    fb.first_biome_name AS primary_biome,
    s.environment_feature,
    s.environment_material,
    s.host_scientific_name,
    COALESCE(ds.names, (ARRAY[]::text[])::character varying[]) AS data_source_names,
    COALESCE(st.study_titles, ARRAY[]::text[]) AS study_titles,
    COALESCE(sa_agg.assembly_count, 0) AS assembly_count,
    COALESCE(bg_agg.bgc_count, 0) AS bgc_count,
    COALESCE(sty.source_types, ARRAY[]::text[]) AS source_types,
    (count(DISTINCT b.id))::integer AS bgc_count_from_gcf,
    (count(DISTINCT b.assembly))::integer AS assembly_count_from_gcf
   FROM (((((((((public.samples s
     JOIN public.sample_assemblies sa ON ((sa.sample_id = s.id)))
     JOIN public.bgcs b ON ((b.assembly = sa.assembly_id)))
     JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
     LEFT JOIN ( SELECT sample_assemblies.sample_id,
            (count(*))::integer AS assembly_count
           FROM public.sample_assemblies
          GROUP BY sample_assemblies.sample_id) sa_agg ON ((sa_agg.sample_id = s.id)))
     LEFT JOIN ( SELECT sa2.sample_id,
            (count(b2.id))::integer AS bgc_count
           FROM (public.sample_assemblies sa2
             JOIN public.bgcs b2 ON ((b2.assembly = sa2.assembly_id)))
          GROUP BY sa2.sample_id) bg_agg ON ((bg_agg.sample_id = s.id)))
     LEFT JOIN LATERAL ( SELECT array_agg(ds_inner.name ORDER BY ds_inner.name) AS names
           FROM public.data_sources ds_inner
          WHERE (ds_inner.id = ANY (s.data_source_ids))) ds ON (true))
     LEFT JOIN LATERAL ( SELECT array_agg(COALESCE(stu.title, stu.study_name) ORDER BY stu.title, stu.study_name) AS study_titles
           FROM (public.study_samples ss
             JOIN public.studies stu ON ((stu.id = ss.study_id)))
          WHERE (ss.sample_id = s.id)) st ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(( SELECT b0.name
                   FROM (public.sample_biomes sb2
                     JOIN public.biomes b0 ON ((b0.id = sb2.biome_id)))
                  WHERE ((sb2.sample_id = s.id) AND (b0.parent_id IS NULL) AND ((b0.name IS NULL) OR ((b0.name)::text !~* '^root$'::text)))
                  ORDER BY b0.level NULLS FIRST, b0.name
                 LIMIT 1), ( SELECT p.name
                   FROM ((public.sample_biomes sb3
                     JOIN public.biomes c ON ((c.id = sb3.biome_id)))
                     JOIN public.biomes p ON ((p.id = c.parent_id)))
                  WHERE ((sb3.sample_id = s.id) AND ((p.name IS NULL) OR ((p.name)::text !~* '^root$'::text)))
                  ORDER BY p.level NULLS FIRST, p.name
                 LIMIT 1), ( SELECT b1.name
                   FROM (public.sample_biomes sb4
                     JOIN public.biomes b1 ON ((b1.id = sb4.biome_id)))
                  WHERE ((sb4.sample_id = s.id) AND ((b1.name IS NULL) OR ((b1.name)::text !~* '^root$'::text)))
                  ORDER BY b1.level NULLS FIRST, b1.name
                 LIMIT 1)) AS first_biome_name) fb ON (true))
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT a.source_type ORDER BY a.source_type) AS source_types
           FROM (public.sample_assemblies sa3
             JOIN public.assemblies a ON ((a.id = sa3.assembly_id)))
          WHERE (sa3.sample_id = s.id)) sty ON (true))
  WHERE ((s.latitude IS NOT NULL) AND (s.longitude IS NOT NULL))
  GROUP BY bg.gcf_id, s.id, s.external_id, s.name, s.geographic_location, s.geolocation_name, s.latitude, s.longitude, s.environment_biome, fb.first_biome_name, s.environment_feature, s.environment_material, s.host_scientific_name, ds.names, st.study_titles, sa_agg.assembly_count, bg_agg.bgc_count, sty.source_types
  WITH NO DATA;


--
-- Name: gcf_study_count; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcf_study_count (
    gcf_id uuid NOT NULL,
    study_count integer NOT NULL
);


--
-- Name: gcf_successor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcf_successor (
    old_gcf_id uuid NOT NULL,
    new_gcf_id uuid NOT NULL,
    shared_bgcs integer NOT NULL,
    share_of_old real NOT NULL,
    share_of_new real NOT NULL,
    CONSTRAINT gcf_successor_share_of_new_check CHECK (((share_of_new > (0)::double precision) AND (share_of_new <= (1)::double precision))),
    CONSTRAINT gcf_successor_share_of_old_check CHECK (((share_of_old > (0)::double precision) AND (share_of_old <= (1)::double precision))),
    CONSTRAINT gcf_successor_shared_bgcs_check CHECK ((shared_bgcs > 0))
);


--
-- Name: gcf_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gcf_summary AS
 SELECT g.id AS gcf_id,
    g.name,
    g.cluster_method,
    g.family_class,
    g.listed,
    count(b.id) AS member_bgc_count,
    count(DISTINCT b.assembly) AS assembly_count,
    avg(bg.distance) AS avg_distance,
    min(bg.distance) AS min_distance,
    max(bg.distance) AS max_distance
   FROM ((public.gcfs g
     LEFT JOIN public.bgc_gcf bg ON (((bg.gcf_id = g.id) AND bg.is_primary)))
     LEFT JOIN public.bgcs b ON ((b.id = bg.bgc_id)))
  GROUP BY g.id, g.name, g.cluster_method, g.family_class, g.listed;


--
-- Name: loader_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loader_progress (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    loader_name text NOT NULL,
    run_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    status text NOT NULL,
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT loader_progress_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: TABLE loader_progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loader_progress IS 'Tracks progress of data loading operations for resume capability';


--
-- Name: COLUMN loader_progress.loader_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loader_progress.loader_name IS 'Name of the loader (e.g., gtdb_parallel, mgnify_studies)';


--
-- Name: COLUMN loader_progress.run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loader_progress.run_id IS 'Unique identifier for a loader run session';


--
-- Name: COLUMN loader_progress.entity_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loader_progress.entity_type IS 'Type of entity being processed';


--
-- Name: COLUMN loader_progress.entity_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loader_progress.entity_id IS 'Unique identifier for the entity (accession, external_id, etc.)';


--
-- Name: COLUMN loader_progress.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loader_progress.status IS 'Current processing status of the entity';


--
-- Name: COLUMN loader_progress.error_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loader_progress.error_message IS 'Error message if status is failed';


--
-- Name: loader_progress_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.loader_progress_summary AS
 SELECT loader_name,
    run_id,
    entity_type,
    count(*) AS total_entities,
    count(*) FILTER (WHERE (status = 'completed'::text)) AS completed,
    count(*) FILTER (WHERE (status = 'failed'::text)) AS failed,
    count(*) FILTER (WHERE (status = 'processing'::text)) AS in_progress,
    count(*) FILTER (WHERE (status = 'pending'::text)) AS pending,
    min(created_at) AS run_started_at,
    max(updated_at) AS last_updated_at,
    round(((100.0 * (count(*) FILTER (WHERE (status = 'completed'::text)))::numeric) / (count(*))::numeric), 2) AS completion_percentage
   FROM public.loader_progress
  GROUP BY loader_name, run_id, entity_type;


--
-- Name: VIEW loader_progress_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.loader_progress_summary IS 'Summary view of loader progress by run';


--
-- Name: mgnify_genome_catalogues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mgnify_genome_catalogues (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    catalogue_id text NOT NULL,
    name text,
    version text,
    description text,
    biome_lineage text,
    genome_count integer,
    unclustered_genome_count integer,
    ftp_url text,
    result_directory text,
    pipeline_version_tag text,
    catalogue_biome_label text,
    catalogue_type text,
    updated_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE mgnify_genome_catalogues; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mgnify_genome_catalogues IS 'MGnify genome catalogues (catalogue_id-keyed) from the native-v2 crawl.';


--
-- Name: mgnify_genomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mgnify_genomes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    accession text NOT NULL,
    genome_catalogue_id uuid,
    ena_genome_accession text,
    ena_sample_accession text,
    ena_study_accession text,
    ncbi_genome_accession text,
    img_genome_accession text,
    length bigint,
    num_contigs integer,
    n_50 integer,
    gc_content numeric,
    type text,
    completeness numeric,
    contamination numeric,
    taxon_lineage text,
    geographic_origin text,
    biome_lineage text,
    updated_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE mgnify_genomes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mgnify_genomes IS 'MGnify genomes (accession-keyed); FK -> mgnify_genome_catalogues.';


--
-- Name: mgnify_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mgnify_publications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    pubmed_id text NOT NULL,
    title text,
    published_year integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE mgnify_publications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mgnify_publications IS 'MGnify publications (PubMed-keyed) from the native-v2 crawl.';


--
-- Name: mgnify_super_studies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mgnify_super_studies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug text NOT NULL,
    title text,
    description text,
    logo_url text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE mgnify_super_studies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mgnify_super_studies IS 'MGnify super-studies (slug-keyed); flagship/related studies + catalogues in metadata.';


--
-- Name: run_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.run_analyses (
    run_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: run_studies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.run_studies (
    run_id uuid NOT NULL,
    study_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    external_id text,
    name character varying(200),
    instrument_model character varying(100),
    instrument_platform character varying(50),
    accession text,
    secondary_accession text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT runs_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: COLUMN runs.accession; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.runs.accession IS 'Primary accession identifier for the run (e.g., SRR/ERR)';


--
-- Name: COLUMN runs.secondary_accession; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.runs.secondary_accession IS 'Secondary accession identifier for the run';


--
-- Name: COLUMN runs.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.runs.metadata IS 'Free-form key-value metadata as JSON object (use jsonb operators for querying)';


--
-- Name: sample_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_analyses (
    sample_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sample_gcf_counts_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.sample_gcf_counts_mv AS
 SELECT sa.sample_id,
    (count(DISTINCT bg.gcf_id))::integer AS gcf_count,
    (count(bg.bgc_id))::integer AS clustered_bgc_count,
    ((count(b.id) - count(bg.bgc_id)))::integer AS unclustered_bgc_count
   FROM ((public.sample_assemblies sa
     JOIN public.bgcs b ON ((b.assembly = sa.assembly_id)))
     LEFT JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
  GROUP BY sa.sample_id
  WITH NO DATA;


--
-- Name: sample_map_view; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.sample_map_view AS
 SELECT s.id,
    s.external_id,
    s.name,
    s.geographic_location,
    s.geolocation_name,
    s.latitude,
    s.longitude,
    s.environment_biome,
    fb.first_biome_name AS primary_biome,
    s.environment_feature,
    s.environment_material,
    s.host_scientific_name,
    s.host_taxid,
    s.gold_ecosystem_path,
    s.data_source_ids,
    COALESCE(ds.names, (ARRAY[]::text[])::character varying[]) AS data_source_names,
    COALESCE(st.study_titles, ARRAY[]::text[]) AS study_titles,
    COALESCE(sa.assembly_count, 0) AS assembly_count,
    COALESCE(bg.bgc_count, 0) AS bgc_count,
    COALESCE(sty.source_types, ARRAY[]::text[]) AS source_types
   FROM ((((((public.samples s
     LEFT JOIN ( SELECT sample_assemblies.sample_id,
            (count(*))::integer AS assembly_count
           FROM public.sample_assemblies
          GROUP BY sample_assemblies.sample_id) sa ON ((sa.sample_id = s.id)))
     LEFT JOIN ( SELECT sa_1.sample_id,
            (count(b.id))::integer AS bgc_count
           FROM (public.sample_assemblies sa_1
             JOIN public.bgcs b ON ((b.assembly = sa_1.assembly_id)))
          GROUP BY sa_1.sample_id) bg ON ((bg.sample_id = s.id)))
     LEFT JOIN LATERAL ( SELECT array_agg(ds_1.name ORDER BY ds_1.name) AS names
           FROM public.data_sources ds_1
          WHERE (ds_1.id = ANY (s.data_source_ids))) ds ON (true))
     LEFT JOIN LATERAL ( SELECT array_agg(COALESCE(stu.title, stu.study_name) ORDER BY stu.title, stu.study_name) AS study_titles
           FROM (public.study_samples ss
             JOIN public.studies stu ON ((stu.id = ss.study_id)))
          WHERE (ss.sample_id = s.id)) st ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(( SELECT b0.name
                   FROM (public.sample_biomes sb2
                     JOIN public.biomes b0 ON ((b0.id = sb2.biome_id)))
                  WHERE ((sb2.sample_id = s.id) AND (b0.parent_id IS NULL) AND ((b0.name IS NULL) OR ((b0.name)::text !~* '^root$'::text)))
                  ORDER BY b0.level NULLS FIRST, b0.name
                 LIMIT 1), ( SELECT p.name
                   FROM ((public.sample_biomes sb3
                     JOIN public.biomes c ON ((c.id = sb3.biome_id)))
                     JOIN public.biomes p ON ((p.id = c.parent_id)))
                  WHERE ((sb3.sample_id = s.id) AND ((p.name IS NULL) OR ((p.name)::text !~* '^root$'::text)))
                  ORDER BY p.level NULLS FIRST, p.name
                 LIMIT 1), ( SELECT b1.name
                   FROM (public.sample_biomes sb4
                     JOIN public.biomes b1 ON ((b1.id = sb4.biome_id)))
                  WHERE ((sb4.sample_id = s.id) AND ((b1.name IS NULL) OR ((b1.name)::text !~* '^root$'::text)))
                  ORDER BY b1.level NULLS FIRST, b1.name
                 LIMIT 1)) AS first_biome_name) fb ON (true))
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT a.source_type ORDER BY a.source_type) AS source_types
           FROM (public.sample_assemblies sa2
             JOIN public.assemblies a ON ((a.id = sa2.assembly_id)))
          WHERE (sa2.sample_id = s.id)) sty ON (true))
  WHERE ((s.latitude IS NOT NULL) AND (s.longitude IS NOT NULL))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW sample_map_view; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.sample_map_view IS 'Subset of sample_summary for map visualization (only samples with coordinates). Carries host_taxid + data_source_ids so the map endpoint can apply the full samples-list filter set (host / data source).';


--
-- Name: sample_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_measurements (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sample_id uuid NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    unit text,
    measured_at date,
    source text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sample_parent_key; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.sample_parent_key AS
 SELECT id AS sample_id,
    COALESCE(((metadata -> 'spire'::text) ->> 'biosample'::text), ((metadata -> 'mfd'::text) ->> 'barcode'::text), ((metadata -> 'gem'::text) ->> 'metagenome_id'::text), "substring"(name, '^[A-Za-z0-9-]+_(SAM[END][A-Z]?[0-9]+)_MAG'::text), "substring"(name, '^(.*)_bin\.[0-9]+$'::text), "substring"(name, '^(SRR[0-9]+)bin\.[0-9]+$'::text), (id)::text) AS parent_key
   FROM public.samples s
  WITH NO DATA;


--
-- Name: sample_source_type_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.sample_source_type_counts AS
 SELECT COALESCE(source_types, '{}'::text[]) AS source_types,
    count(*) AS sample_count
   FROM public.sample_summary sb
  GROUP BY COALESCE(source_types, '{}'::text[])
  WITH NO DATA;


--
-- Name: sequence_search_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_search_results (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(100) NOT NULL,
    bgc_id uuid,
    bgc_filename text,
    identity numeric(5,2) NOT NULL,
    coverage numeric(5,2) NOT NULL,
    e_value double precision NOT NULL,
    bit_score numeric(10,2) NOT NULL,
    query_start integer NOT NULL,
    query_end integer NOT NULL,
    query_length integer NOT NULL,
    target_start integer NOT NULL,
    target_end integer NOT NULL,
    target_length integer NOT NULL,
    num_matches integer NOT NULL,
    num_mismatches integer,
    num_gaps integer,
    alignment_length integer NOT NULL,
    query_aligned text,
    target_aligned text,
    alignment_string text,
    rank integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_id text,
    query_id text
);


--
-- Name: TABLE sequence_search_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sequence_search_results IS 'Stores individual alignment hits from MMseqs2 searches with detailed metrics.';


--
-- Name: COLUMN sequence_search_results.bgc_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_search_results.bgc_id IS 'Region UUID of the hit, parsed from target_id (its first 36 characters are bgcs.id by construction). Not FK-checked: validating it cost a full random-read pass over bgcs per search. Readers must LEFT JOIN bgcs and treat a non-matching id as an unlinked hit.';


--
-- Name: COLUMN sequence_search_results.bgc_filename; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_search_results.bgc_filename IS 'Legacy denormalised copy of bgcs.filename, no longer written (NULL on new rows). The read path joins bgcs for the current filename; this column only still serves pre-0067 rows.';


--
-- Name: COLUMN sequence_search_results.coverage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_search_results.coverage IS 'Query coverage percentage: (alignment_length / query_length) * 100';


--
-- Name: COLUMN sequence_search_results.rank; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_search_results.rank IS 'Result ranking within session, ordered by e-value ascending (lower is better).';


--
-- Name: COLUMN sequence_search_results.target_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_search_results.target_id IS 'Raw DIAMOND target sequence id (<region-uuid>_ctgN_M). The <region-uuid> prefix is bgcs.id; bgc_id holds it once validated against bgcs, and stays NULL when the region has no Atlas row.';


--
-- Name: COLUMN sequence_search_results.query_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_search_results.query_id IS 'FASTA header id of the submitted query sequence that produced this hit.';


--
-- Name: sequence_search_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_search_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(100) NOT NULL,
    input_sequence text NOT NULL,
    sequence_hash character varying(64) NOT NULL,
    sequence_type character varying(20) DEFAULT 'nucleotide'::character varying NOT NULL,
    algorithm character varying(50) DEFAULT 'diamond'::character varying NOT NULL,
    e_value double precision DEFAULT 0.00001,
    min_identity numeric(5,2) DEFAULT 50.0,
    min_coverage numeric(5,2) DEFAULT 80.0,
    max_results integer DEFAULT 1000,
    job_id character varying(100),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    progress integer DEFAULT 0,
    error_message text,
    total_hits integer DEFAULT 0,
    search_duration_ms integer,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: TABLE sequence_search_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sequence_search_sessions IS 'Tracks MMseqs2 sequence similarity search sessions. Sessions older than 30 days should be cleaned up via cron job.';


--
-- Name: COLUMN sequence_search_sessions.sequence_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_search_sessions.sequence_hash IS 'SHA256 hash of input sequence for duplicate detection within 24 hours.';


--
-- Name: source_type_statistics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.source_type_statistics AS
 SELECT a.source_type,
    count(DISTINCT a.id) AS assembly_count,
    count(DISTINCT b.id) AS bgc_count,
    count(DISTINCT b.id) FILTER (WHERE b.is_complete) AS complete_bgc_count,
    count(DISTINCT bg.gcf_id) AS gcf_count
   FROM ((public.assemblies a
     LEFT JOIN public.bgcs b ON ((b.assembly = a.id)))
     LEFT JOIN public.bgc_gcf bg ON (((bg.bgc_id = b.id) AND bg.is_primary)))
  GROUP BY a.source_type
  WITH NO DATA;


--
-- Name: study_bgc_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_bgc_summary (
    study_key text NOT NULL,
    study_id uuid NOT NULL,
    title text,
    study_name text,
    center_name text,
    accession text,
    bioproject text,
    study_type text,
    sample_count integer DEFAULT 0 NOT NULL,
    total_bgcs bigint DEFAULT 0 NOT NULL,
    clustered_bgcs bigint DEFAULT 0 NOT NULL,
    gcf_coverage real,
    distinct_gcfs bigint DEFAULT 0 NOT NULL,
    exclusive_gcfs bigint DEFAULT 0 NOT NULL,
    rare_gcfs bigint DEFAULT 0 NOT NULL,
    pct_complete real,
    product_type_count integer DEFAULT 0 NOT NULL,
    product_category_dist jsonb,
    top_exclusive_gcfs jsonb,
    primary_biome text,
    gold_bucket text,
    complete_bgcs bigint DEFAULT 0 NOT NULL,
    genome_count integer DEFAULT 0 NOT NULL,
    source_type_dist jsonb,
    data_sources jsonb
);


--
-- Name: study_biomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_biomes (
    study_id uuid NOT NULL,
    biome_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: study_ecosystem_dist; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.study_ecosystem_dist AS
 WITH logical_study AS (
         SELECT st.id AS study_id,
            COALESCE(NULLIF(st.study_name, ''::text), st.accession, (st.id)::text) AS study_key
           FROM public.studies st
        ), sample_env AS (
         SELECT DISTINCT ON (ls.study_key, pk.parent_key) ls.study_key,
            pk.parent_key,
            ssum.gold_ecosystem_path AS path
           FROM (((logical_study ls
             JOIN public.study_samples sts ON ((sts.study_id = ls.study_id)))
             JOIN public.sample_parent_key pk ON ((pk.sample_id = sts.sample_id)))
             JOIN public.sample_summary ssum ON ((ssum.id = sts.sample_id)))
          WHERE (COALESCE(ssum.gold_ecosystem_path, ''::text) <> ''::text)
          ORDER BY ls.study_key, pk.parent_key, ssum.gold_ecosystem_path
        ), levelled AS (
         SELECT sample_env.study_key,
            sample_env.parent_key,
                CASE
                    WHEN ((lower(split_part(sample_env.path, ':'::text, 1)) = 'host-associated'::text) AND (lower(split_part(sample_env.path, ':'::text, 2)) = 'plants'::text)) THEN 'Host-assoc.: Plants'::text
                    ELSE NULLIF(split_part(sample_env.path, ':'::text, 1), ''::text)
                END AS l1,
            NULLIF(split_part(sample_env.path, ':'::text, 2), ''::text) AS l2,
            NULLIF(split_part(sample_env.path, ':'::text, 3), ''::text) AS l3
           FROM sample_env
        ), counted AS (
         SELECT levelled.study_key,
            1 AS lvl,
            levelled.l1 AS ecosystem,
            (count(*))::integer AS n
           FROM levelled
          WHERE (levelled.l1 IS NOT NULL)
          GROUP BY levelled.study_key, levelled.l1
        UNION ALL
         SELECT levelled.study_key,
            2,
            levelled.l2,
            (count(*))::integer AS count
           FROM levelled
          WHERE (levelled.l2 IS NOT NULL)
          GROUP BY levelled.study_key, levelled.l2
        UNION ALL
         SELECT levelled.study_key,
            3,
            levelled.l3,
            (count(*))::integer AS count
           FROM levelled
          WHERE (levelled.l3 IS NOT NULL)
          GROUP BY levelled.study_key, levelled.l3
        )
 SELECT study_key,
    jsonb_object_agg(ecosystem, n) FILTER (WHERE (lvl = 1)) AS l1,
    jsonb_object_agg(ecosystem, n) FILTER (WHERE (lvl = 2)) AS l2,
    jsonb_object_agg(ecosystem, n) FILTER (WHERE (lvl = 3)) AS l3
   FROM counted
  GROUP BY study_key
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW study_ecosystem_dist; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.study_ecosystem_dist IS 'Per-logical-study GOLD ecosystem distribution over DISTINCT physical samples, as {ecosystem: sample_count} for levels 1-3. Denominator is samples carrying a GOLD path, not all samples. Level 1 carries the synthetic ''Host-assoc.: Plants'' bucket (migration 0086). Backs the /studies Environment column.';


--
-- Name: study_gcf; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_gcf (
    study_key text NOT NULL,
    gcf_id uuid NOT NULL,
    bgcs_in_study integer NOT NULL,
    is_exclusive boolean NOT NULL
);


--
-- Name: TABLE study_gcf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.study_gcf IS 'One row per (logical study, GCF). Precomputed offline; never derived from bgcs at request time.';


--
-- Name: taxonomies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taxonomies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gtdb_lineage text NOT NULL,
    domain text,
    phylum text,
    class text,
    order_name text,
    family text,
    genus text,
    species text,
    source text,
    is_partial boolean DEFAULT false,
    rank_depth integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_rank_depth CHECK (((rank_depth >= 1) AND (rank_depth <= 7)))
);


--
-- Name: TABLE taxonomies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.taxonomies IS 'Hierarchical taxonomy lineages in GTDB format';


--
-- Name: COLUMN taxonomies.gtdb_lineage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.gtdb_lineage IS 'Full GTDB-formatted taxonomy string (canonical form with double underscores)';


--
-- Name: COLUMN taxonomies.domain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.domain IS 'Domain rank (e.g., d__Bacteria)';


--
-- Name: COLUMN taxonomies.phylum; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.phylum IS 'Phylum rank (e.g., p__Actinomycetota)';


--
-- Name: COLUMN taxonomies.class; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.class IS 'Class rank (e.g., c__Actinomycetes)';


--
-- Name: COLUMN taxonomies.order_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.order_name IS 'Order rank (e.g., o__Actinomycetales)';


--
-- Name: COLUMN taxonomies.family; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.family IS 'Family rank (e.g., f__Streptomycetaceae)';


--
-- Name: COLUMN taxonomies.genus; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.genus IS 'Genus rank (e.g., g__Streptomyces)';


--
-- Name: COLUMN taxonomies.species; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.species IS 'Species rank (e.g., s__Streptomyces coelicolor)';


--
-- Name: COLUMN taxonomies.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.source IS 'Data source: metalog, mgnify, gtdb, etc.';


--
-- Name: COLUMN taxonomies.is_partial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.is_partial IS 'TRUE if lineage is incomplete (e.g., only domain level)';


--
-- Name: COLUMN taxonomies.rank_depth; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.taxonomies.rank_depth IS 'Number of taxonomy ranks present (1=domain only, 7=complete to species)';


--
-- Name: user_contribution_samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_contribution_samples (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    contribution_id uuid NOT NULL,
    sample_alias character varying(255) NOT NULL,
    assembly_filenames text[] DEFAULT '{}'::text[],
    latitude numeric,
    longitude numeric,
    geographic_location character varying(500),
    location_resolution character varying(100),
    geolocation_name character varying(500),
    environment_biome character varying(500),
    environment_feature character varying(500),
    environment_material character varying(500),
    environmental_package character varying(100),
    depth_min_meters numeric,
    depth_max_meters numeric,
    elevation_meters numeric,
    temperature numeric,
    ph numeric,
    salinity numeric,
    salinity_unit character varying(20),
    current_precipitation_mm numeric,
    mean_annual_precipitation_mm numeric,
    mean_annual_temperature numeric,
    collection_date date,
    collection_date_end date,
    description text,
    host_taxid integer,
    host_scientific_name character varying(255),
    external_id character varying(255),
    accession character varying(255),
    additional_metadata jsonb DEFAULT '{}'::jsonb,
    validation_warnings jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE user_contribution_samples; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_contribution_samples IS 'Staging table for sample metadata from user contributions before admin review and approval';


--
-- Name: COLUMN user_contribution_samples.sample_alias; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_contribution_samples.sample_alias IS 'User-provided sample identifier (required field)';


--
-- Name: COLUMN user_contribution_samples.assembly_filenames; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_contribution_samples.assembly_filenames IS 'Array of FASTA filenames associated with this sample';


--
-- Name: COLUMN user_contribution_samples.additional_metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_contribution_samples.additional_metadata IS 'Flexible JSON field for metadata that does not fit standard fields';


--
-- Name: COLUMN user_contribution_samples.validation_warnings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_contribution_samples.validation_warnings IS 'Array of validation warnings (e.g., missing recommended fields)';


--
-- Name: user_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_contributions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    submission_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    institute character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    description text NOT NULL,
    assembly_count integer DEFAULT 0 NOT NULL,
    metadata_provided boolean DEFAULT false,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by character varying(100),
    reviewed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_uploads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    institution character varying(200),
    email character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO bgc_app;


--
-- Name: FUNCTION admin_refresh_matview(p_view text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_refresh_matview(p_view text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_refresh_matview(p_view text) TO bgc_app;


--
-- Name: TABLE analyses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.analyses TO bgc_app;


--
-- Name: TABLE antismash_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.antismash_runs TO bgc_app;


--
-- Name: TABLE assemblies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.assemblies TO bgc_app;


--
-- Name: TABLE assembly_analyses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.assembly_analyses TO bgc_app;


--
-- Name: TABLE sample_assemblies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_assemblies TO bgc_app;


--
-- Name: TABLE samples; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.samples TO bgc_app;


--
-- Name: TABLE assembly_samples_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.assembly_samples_mv TO bgc_app;


--
-- Name: TABLE assembly_taxonomy; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.assembly_taxonomy TO bgc_app;


--
-- Name: TABLE bgcs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgcs TO bgc_app;


--
-- Name: TABLE biomes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.biomes TO bgc_app;


--
-- Name: TABLE run_assemblies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.run_assemblies TO bgc_app;


--
-- Name: TABLE sample_biomes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_biomes TO bgc_app;


--
-- Name: TABLE sample_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_runs TO bgc_app;


--
-- Name: TABLE bgc_biome_analysis_mapping; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_biome_analysis_mapping TO bgc_app;


--
-- Name: TABLE sample_biome_levels_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_biome_levels_mv TO bgc_app;


--
-- Name: TABLE bgc_biome_summary_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_biome_summary_mv TO bgc_app;


--
-- Name: TABLE bgc_biome_level_1_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_biome_level_1_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_biome_level_2_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_biome_level_2_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_biome_level_3_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_biome_level_3_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_biome_level_4_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_biome_level_4_distribution_mv TO bgc_app;


--
-- Name: TABLE data_sources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.data_sources TO bgc_app;


--
-- Name: TABLE studies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.studies TO bgc_app;


--
-- Name: TABLE study_samples; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.study_samples TO bgc_app;


--
-- Name: TABLE sample_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_summary TO bgc_app;


--
-- Name: TABLE bgc_data_source_counts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_data_source_counts TO bgc_app;


--
-- Name: TABLE bgc_environment_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_environment_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_feature_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_feature_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_features; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_features TO bgc_app;


--
-- Name: TABLE bgc_gbk_offsets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_gbk_offsets TO bgc_app;


--
-- Name: TABLE bgc_gcf; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_gcf TO bgc_app;


--
-- Name: TABLE bgc_gold_bucket_counts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_gold_bucket_counts TO bgc_app;


--
-- Name: TABLE bgc_gold_ecosystem_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_gold_ecosystem_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_material_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_material_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_product_category_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_product_category_distribution_mv TO bgc_app;


--
-- Name: TABLE bgc_product_facet_counts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_product_facet_counts TO bgc_app;


--
-- Name: TABLE bgc_redirect; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_redirect TO bgc_app;


--
-- Name: TABLE bgc_taxonomy; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgc_taxonomy TO bgc_app;


--
-- Name: TABLE bgcs_per_assembly; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgcs_per_assembly TO bgc_app;


--
-- Name: TABLE bgcs_per_run; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bgcs_per_run TO bgc_app;


--
-- Name: TABLE bigslice_search_results; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bigslice_search_results TO bgc_app;


--
-- Name: TABLE bigslice_search_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bigslice_search_sessions TO bgc_app;


--
-- Name: TABLE data_source_statistics; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.data_source_statistics TO bgc_app;


--
-- Name: TABLE feedback; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.feedback TO bgc_app;


--
-- Name: TABLE gcf_assembly_source_stats_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_assembly_source_stats_mv TO bgc_app;


--
-- Name: TABLE gcf_category_combination_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_category_combination_mv TO bgc_app;


--
-- Name: TABLE gcf_gold_ecosystem_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_gold_ecosystem_distribution_mv TO bgc_app;


--
-- Name: TABLE gcf_product_category_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_product_category_distribution_mv TO bgc_app;


--
-- Name: TABLE gcfs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcfs TO bgc_app;


--
-- Name: TABLE gcf_summary_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_summary_mv TO bgc_app;


--
-- Name: TABLE gcf_taxonomy_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_taxonomy_distribution_mv TO bgc_app;


--
-- Name: TABLE gcf_distributions_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_distributions_mv TO bgc_app;


--
-- Name: TABLE gcf_environmental_distribution_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_environmental_distribution_mv TO bgc_app;


--
-- Name: TABLE gcf_export_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gcf_export_jobs TO bgc_app;


--
-- Name: TABLE gcf_legacy; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_legacy TO bgc_app;


--
-- Name: TABLE gcf_length_stats_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_length_stats_mv TO bgc_app;


--
-- Name: TABLE gcf_mibig_anchor; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_mibig_anchor TO bgc_app;


--
-- Name: TABLE product_category_map; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.product_category_map TO bgc_app;


--
-- Name: TABLE gcf_product_type_matrix_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_product_type_matrix_mv TO bgc_app;


--
-- Name: TABLE gcf_route_counts_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_route_counts_mv TO bgc_app;


--
-- Name: TABLE gcf_sample_map_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_sample_map_mv TO bgc_app;


--
-- Name: TABLE gcf_study_count; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_study_count TO bgc_app;


--
-- Name: TABLE gcf_successor; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_successor TO bgc_app;


--
-- Name: TABLE gcf_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gcf_summary TO bgc_app;


--
-- Name: TABLE loader_progress; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.loader_progress TO bgc_app;


--
-- Name: TABLE loader_progress_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.loader_progress_summary TO bgc_app;


--
-- Name: TABLE mgnify_genome_catalogues; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mgnify_genome_catalogues TO bgc_app;


--
-- Name: TABLE mgnify_genomes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mgnify_genomes TO bgc_app;


--
-- Name: TABLE mgnify_publications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mgnify_publications TO bgc_app;


--
-- Name: TABLE mgnify_super_studies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mgnify_super_studies TO bgc_app;


--
-- Name: TABLE run_analyses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.run_analyses TO bgc_app;


--
-- Name: TABLE run_studies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.run_studies TO bgc_app;


--
-- Name: TABLE runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.runs TO bgc_app;


--
-- Name: TABLE sample_analyses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_analyses TO bgc_app;


--
-- Name: TABLE sample_gcf_counts_mv; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_gcf_counts_mv TO bgc_app;


--
-- Name: TABLE sample_map_view; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_map_view TO bgc_app;


--
-- Name: TABLE sample_measurements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_measurements TO bgc_app;


--
-- Name: TABLE sample_parent_key; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_parent_key TO bgc_app;


--
-- Name: TABLE sample_source_type_counts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sample_source_type_counts TO bgc_app;


--
-- Name: TABLE sequence_search_results; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sequence_search_results TO bgc_app;


--
-- Name: TABLE sequence_search_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sequence_search_sessions TO bgc_app;


--
-- Name: TABLE source_type_statistics; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.source_type_statistics TO bgc_app;


--
-- Name: TABLE study_bgc_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.study_bgc_summary TO bgc_app;


--
-- Name: TABLE study_biomes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.study_biomes TO bgc_app;


--
-- Name: TABLE study_ecosystem_dist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.study_ecosystem_dist TO bgc_app;


--
-- Name: TABLE study_gcf; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.study_gcf TO bgc_app;


--
-- Name: TABLE taxonomies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.taxonomies TO bgc_app;


--
-- Name: TABLE user_contribution_samples; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_contribution_samples TO bgc_app;


--
-- Name: TABLE user_contributions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_contributions TO bgc_app;


--
-- Name: TABLE user_uploads; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.user_uploads TO bgc_app;


--
-- PostgreSQL database dump complete
--

\unrestrict vjxT04EF3afXjUNrSLQDxvFDg5Qe76TtQxUa9ziSPzbXomRtaCEKPtrgGbdhpai

