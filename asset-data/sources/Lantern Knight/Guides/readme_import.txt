LANTERN REVISION 02
Download and import guide

Download the private Google Drive folder. Use the selected archive filenames in
Lantern_Revision02_Asset_Index.json. All 65 selected art ZIPs are verified in the
private folder by current filename, byte size and unique identity. No selected
archive or complementary part is missing. Historical revisions and proof-only
uploads are not additional assets. Keep an untouched copy of the downloaded archives.

EXTRACTING COMPLETE PACKS
If Drive supplies an outer download ZIP, unzip that first to obtain the
selected pack ZIPs. Point the optional helper at that extracted folder.
Extract every selected ZIP into one empty collection directory, preserving the
folders inside each ZIP. Complementary parts are ordinary ZIP archives containing
complete files. Extract all parts into the same destination; do not concatenate
them. The original-view hero study also has three complementary volumes covering
source/preview, native frames and high-resolution proofs. A shared ZIP serving
two logical groups needs to be extracted only once.

The optional extract_lantern.py helper uses only Python's standard library.
It validates archive SHA-256 values against the index, checks paths and duplicate
members before writing, merges byte-identical repeated files, and refuses any
conflicting file bytes. It never deletes files or starts external programs.
Run it with Python 3.9 or newer, the downloaded folder, and a new empty destination:
  python3 extract_lantern.py /path/to/download /path/to/Lantern_Extracted
By default it expects Lantern_Revision02_Asset_Index.json beside the helper.
Use --index /path/to/index.json if the index is elsewhere.

ART AND CAMERA
The placement target is orthographic elevation 35.2643897 degrees, azimuth
45 degrees and a 13 metre gameplay vertical span. Generated artwork remains an
approximate illustration. Exact camera/projection controls do not make painted
geometry calibrated or remove perspective already drawn into an image.

Upright painted cutouts: preserve the authored view and card orientation. Do not
rotate a single painted card arbitrarily in 3D as though it were full geometry.
Use authored direction variants where supplied. The actor front, side and rear
studies preserve useful action roles, but are not a 360-degree rig or certified
fixed-heading set. They are not a canonical hero production rig.

Raw top-down floors belong on horizontal XZ geometry. Raw front-view wall artwork
belongs on the specified wall face. Apply the scene camera once; do not pre-project
these images and then project again. Read each pack's axes, scale and pivot notes.

Keep native masters untouched. Padded import copies are derivatives of the same
artwork, not extra designs. Their pivots must shift by the recorded integer canvas
offsets. Do not treat a larger padded canvas as a larger world-space object.

ANIMATION AND TEXTURE IMPORT
Read source frame rate, duration and loop metadata per clip. A 60 Hz review video
may repeat 12, 24 or 30 fps source drawings. It does not certify 60 unique drawings
per second, smooth in-engine playback or game performance. Count clip timeline
records separately from distinct drawings or designs.

Use each pack's straight-alpha and colour-space instructions. Use its original
canvas, trim rectangle and pivot together. Keep atlas padding/extrusion intact.
Disable mipmaps unless pack guidance and an engine test support per-sprite mips.
Verify dark/light edge behaviour at target size, texture filtering, ground contact,
state transitions, sort order and animation timing in the intended engine.

SCOPE
The collection is reviewed art and source material. It has no engine integration,
collision, lighting or frame-rate certification. Ground repeats are illustrated
and may show motif repetition or fine edge mismatches. Scene compositions reuse
supplied assets and do not create additional source designs. The locked C/RUST
hero reference remains byte-identical; its original-view idle is a limited study.

CURRENT REVIEW STATUS
QA_STATUS.json and the quality notes record the latest bounded review. The
Containers01 and Mechanisms02 embedded manifests were captured before their
later audit and retain a pending label. Their later review reports are current;
the selected r02a source-portability releases preserve all original artwork.
Use SOURCE_REBUILD_GUIDE.txt for verified entrypoints and required dependencies.
