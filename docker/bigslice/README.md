# BiG-SLiCE query image

Docker image used by the BGC Atlas "BGC clustering" search to run BiG-SLiCE queries on a
high-memory host (the GCF models are too large for the app host's memory). See
`bgc-atlas/src/lib/bigslice/index.ts` (`runBiGSlice`, `ssh-docker` exec mode) for how it's invoked.

## Contents
- `Dockerfile` — `FROM` the bioconda biocontainer that matches the `bigslice202` env which built the
  reference run (bigslice **2.0.2**, build `pyh8ed023e_0` — its `--version` banner misreports
  "2.0.0"). The HMM models are baked in so query feature extraction matches the run.
- `build.sh` — `docker build` wrapper (`build.sh [image_tag]`, default `bigslice:2.0.2`).

## HMM models (not in git)
The image bakes `bigslice_models.tar.gz` (~284 MB, `bigslice-models-2022-11-30`) via `ADD`. The
tarball is **not** committed; it must be present in the build context. The active build context is on
shared CephFS:

    /data/bgc-atlas/docker/bigslice/

which holds the `bigslice_models.tar.gz` alongside copies of these files. **Keep that copy in sync
with this directory** (it is the path the app uses as `BIGSLICE_BUILD_CONTEXT`).

## Build
On a docker host that can read the CephFS context (e.g. `docker-host`, which mounts the same CephFS):

    ssh docker-host docker build -t bigslice:2.0.2 /data/bgc-atlas/docker/bigslice/
    # or, from that directory:
    ./build.sh

The worker auto-runs this `build.sh` on the remote host if the image is missing (e.g. cleaned), so a
manual build is normally only needed for the first install or an image change. Relevant env vars
(set in `bgc-atlas/.env*`): `BIGSLICE_EXEC_MODE=ssh-docker`, `BIGSLICE_SSH_HOST`,
`BIGSLICE_DOCKER_IMAGE`, `BIGSLICE_BUILD_CONTEXT`, `BIGSLICE_PROGRAM_DB_FOLDER`, `BIGSLICE_CEPH_MOUNT`.
