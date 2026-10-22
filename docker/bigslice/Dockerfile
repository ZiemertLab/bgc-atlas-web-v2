# BiG-SLiCE 2.0.0 query image for BGC Atlas, with the HMM models baked in.
#
# Base = the bioconda biocontainer matching the EXACT build of the `bigslice202` env that built the
# reference clustering run: bigslice 2.0.2 build pyh8ed023e_0 (the --version banner says "2.0.0" but
# the conda package is 2.0.2). Using this exact build keeps GBK parsing + feature extraction identical
# to the run, so query membership distances are valid.
# Models = bigslice_models.tar.gz (bigslice-models-2022-11-30), the exact models the reference run used.
# Pass --program_db_folder /opt/bigslice-models at runtime (biocontainers don't ship models).
FROM quay.io/biocontainers/bigslice:2.0.2--pyh8ed023e_0

# ADD auto-extracts the gzipped tarball; contents are biosynthetic_pfams/ and sub_pfams/.
ADD bigslice_models.tar.gz /opt/bigslice-models/
