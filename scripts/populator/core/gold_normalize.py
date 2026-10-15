"""Canonicalization of GOLD ecosystem paths.

Applied at ingest via ``registry.finalize()`` and to loaded samples by
``tools/normalize_gold_paths.py``. Rules rewrite a ':'-segment prefix (keeping deeper
children), first match wins, and the output is idempotent.

Deviation from GOLD: host categories like "Mammals: Human" embed ": ", which collides
with our ':' delimiter and the MVs' SPLIT_PART, so "Human" / "Insecta" are used instead.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

# Longer prefixes must precede the shorter prefix they share: first match wins.
_RULES: List[Tuple[Tuple[str, ...], Tuple[str, ...]]] = [
    # "Forest" is not a GOLD Ecosystem Type; canonical is Terrestrial:Soil:<ecosystem>.
    (("Environmental", "Terrestrial", "Forest", "Soil"),
     ("Environmental", "Terrestrial", "Soil", "Forest soil")),
    (("Environmental", "Terrestrial", "Forest", "Tropical"),
     ("Environmental", "Terrestrial", "Soil", "Tropical forest")),
    (("Environmental", "Terrestrial", "Forest", "Temperate"),
     ("Environmental", "Terrestrial", "Soil", "Forest soil")),
    (("Environmental", "Terrestrial", "Forest"),
     ("Environmental", "Terrestrial", "Soil", "Forest soil")),

    # A freshwater wetland is GOLD Aquatic, not Terrestrial soil.
    (("Environmental", "Terrestrial", "Wetland", "Freshwater"),
     ("Environmental", "Aquatic", "Freshwater", "Wetlands")),
    (("Environmental", "Terrestrial", "Soil", "Wetlands", "Freshwater"),
     ("Environmental", "Aquatic", "Freshwater", "Wetlands")),
    (("Environmental", "Terrestrial", "Wetland"),
     ("Environmental", "Terrestrial", "Soil", "Wetlands")),

    (("Environmental", "Terrestrial", "Soil", "Tropical rainforest"),
     ("Environmental", "Terrestrial", "Soil", "Tropical forest")),
    (("Environmental", "Terrestrial", "Soil", "Agricultural"),
     ("Environmental", "Terrestrial", "Soil", "Agricultural land")),
    (("Environmental", "Terrestrial", "Soil", "Oil-contaminated"),
     ("Environmental", "Terrestrial", "Soil", "Contaminated")),
    (("Environmental", "Terrestrial", "Agricultural"),
     ("Environmental", "Terrestrial", "Agricultural field")),

    # GOLD's Marine open-water type is "Pelagic zone"; "Oceanic" is a separate type.
    (("Environmental", "Aquatic", "Marine", "Pelagic"),
     ("Environmental", "Aquatic", "Marine", "Pelagic zone")),
    (("Environmental", "Aquatic", "Lentic"),
     ("Environmental", "Aquatic", "Freshwater", "Lentic")),
    (("Environmental", "Aquatic", "Freshwater", "Stream"),
     ("Environmental", "Aquatic", "Freshwater", "Creek")),
    (("Environmental", "Aquatic", "Non-marine Saline and Alkaline", "Salt crystallizer pond"),
     ("Environmental", "Aquatic", "Non-marine Saline and Alkaline", "Salt crystallizer ponds")),

    (("Engineered", "Waste management", "Compost"),
     ("Engineered", "Solid waste", "Composting")),
    # "Biogas plant" is not a GOLD Engineered category; GOLD has Bioreactor:Anaerobic:Biogas.
    (("Engineered", "Biogas plant"),
     ("Engineered", "Bioreactor", "Anaerobic", "Biogas")),

    (("Host-associated", "Plants", "Root"),
     ("Host-associated", "Plants", "Roots")),
    (("Host-associated", "Protozoa"),
     ("Host-associated", "Protists")),

    # GOLD nests Rhizosphere and Rhizoplane as siblings under "Roots".
    (("Host-associated", "Plants", "Rhizosphere", "Rhizoplane"),
     ("Host-associated", "Plants", "Roots", "Rhizoplane")),
    (("Host-associated", "Plants", "Rhizosphere"),
     ("Host-associated", "Plants", "Roots", "Rhizosphere")),
    (("Host-associated", "Plants", "Rhizoplane"),
     ("Host-associated", "Plants", "Roots", "Rhizoplane")),
    (("Host-associated", "Plants", "Phyllosphere", "Phylloplane"),
     ("Host-associated", "Plants", "Phyllosphere", "Phylloplane/Leaf")),
    (("Host-associated", "Plants", "Phylloplane"),
     ("Host-associated", "Plants", "Phyllosphere", "Phylloplane/Leaf")),

    (("Host-associated", "Cnidaria"),
     ("Host-associated", "Invertebrates", "Cnidaria")),

    # Mammals-only "Gastrointestinal tract" -> GOLD "Digestive system"; these are
    # colon/fecal samples, so "Intestine" maps to "Large intestine".
    (("Host-associated", "Mammals", "Gastrointestinal tract", "Intestine", "Fecal"),
     ("Host-associated", "Mammals", "Digestive system", "Large intestine", "Fecal")),
    (("Host-associated", "Mammals", "Gastrointestinal tract", "Intestine"),
     ("Host-associated", "Mammals", "Digestive system", "Large intestine")),
    (("Host-associated", "Mammals", "Gastrointestinal tract"),
     ("Host-associated", "Mammals", "Digestive system")),

    # Human gut (stool) -> Large intestine. Fish has no Large intestine node, so
    # Fish:Intestine is left untouched.
    (("Host-associated", "Human", "Digestive system", "Intestine"),
     ("Host-associated", "Human", "Digestive system", "Large intestine")),
    (("Host-associated", "Human", "Digestive system", "Hindgut"),
     ("Host-associated", "Human", "Digestive system", "Large intestine")),
    # GOLD files every oral site under "Oral cavity"; "Oral" is merged into it.
    (("Host-associated", "Human", "Digestive system", "Oral"),
     ("Host-associated", "Human", "Digestive system", "Oral cavity")),
    (("Host-associated", "Human", "Excretory system", "Urethra", "Urine"),
     ("Host-associated", "Human", "Urinary system", "Urine")),
    (("Host-associated", "Human", "Respiratory system", "Pulmonary system"),
     ("Host-associated", "Human", "Respiratory system")),
    (("Host-associated", "Human", "Respiratory system", "Nasopharyngeal"),
     ("Host-associated", "Human", "Respiratory system", "Pharynx/Throat")),
    # MGnify follows HMP, which samples the anterior nares as a skin site.
    (("Host-associated", "Human", "Skin", "Naris"),
     ("Host-associated", "Human", "Skin")),

    (("Host-associated", "Mammals", "Digestive system", "Fecal"),
     ("Host-associated", "Mammals", "Digestive system", "Large intestine", "Fecal")),
    (("Host-associated", "Birds", "Digestive system", "Digestive tube", "Cecum"),
     ("Host-associated", "Birds", "Digestive system", "Ceca")),
    (("Host-associated", "Birds", "Digestive system", "Digestive tube"),
     ("Host-associated", "Birds", "Digestive system")),
    (("Host-associated", "Birds", "Digestive system", "Fecal"),
     ("Host-associated", "Birds", "Digestive system", "Large intestine", "Fecal")),
    # Fish and amphibians have no Large intestine node in GOLD, only Intestine.
    (("Host-associated", "Fish", "Digestive system", "Large intestine"),
     ("Host-associated", "Fish", "Digestive system", "Intestine")),
    (("Host-associated", "Amphibia", "Digestive system", "Large intestine"),
     ("Host-associated", "Amphibia", "Digestive system", "Intestine")),
    (("Host-associated", "Fish", "Skin"),
     ("Host-associated", "Fish", "Integumentary system")),
    (("Host-associated", "Birds", "Skin"),
     ("Host-associated", "Birds", "Integumentary system")),

    # Categories absent from GOLD, which would otherwise snap to their bare top level.

    # Activated Sludge must be re-homed before the Treatment plant fallback. Both casings
    # are needed because the casing pass runs after the structural rules.
    (("Engineered", "Wastewater", "Treatment plant", "Activated Sludge"),
     ("Engineered", "Wastewater", "Activated Sludge")),
    (("Engineered", "Wastewater", "Treatment plant", "Activated sludge"),
     ("Engineered", "Wastewater", "Activated Sludge")),
    # Fallback: GOLD models the material, not the facility; avoid minting an
    # Engineered:WWTP branch beside Engineered:Wastewater.
    (("Engineered", "Wastewater", "Treatment plant"),
     ("Engineered", "Wastewater")),

    # GOLD's Environmental AMD path is under Groundwater, which is wrong for surface AMD
    # sediments.
    (("Environmental", "Aquatic", "Contaminated", "Acid mine drainage"),
     ("Engineered", "Wastewater", "Industrial wastewater", "Acid mine drainage")),

    # All Daley_2018_subsurface (doi:10.1038/s41564-018-0312-6): fracking fluids whose
    # ENVO biome is terrestrial, so not Aquatic:Deep subsurface.
    (("Engineered", "Oil and gas production"),
     ("Environmental", "Terrestrial", "Deep subsurface", "Fracking water")),

    (("Environmental", "Terrestrial", "Peat"),
     ("Environmental", "Terrestrial", "Soil", "Peat")),

    # GOLD's only estuary under Aquatic is the intertidal one.
    (("Environmental", "Aquatic", "Estuary"),
     ("Environmental", "Aquatic", "Marine", "Intertidal zone", "Estuary")),
]


# Applied after the structural rules: the path is cut back to the prefix's replacement and
# everything deeper is dropped, because GOLD has no node for it. Insect hosts are mapped
# to Insecta in the adapters, where the host is known; MGnify's Arthropoda mixes insects
# and crustaceans, so it is not rewritten here.
_TRUNCATE: List[Tuple[Tuple[str, ...], Tuple[str, ...]]] = [
    (("Host-associated", "Animals"), ("Host-associated",)),
    (("Host-associated", "Animal"), ("Host-associated",)),
    (("Host-associated", "Arthropoda", "Ant dump"),
     ("Environmental", "Terrestrial", "Nest", "Insects nest")),
    (("Host-associated", "Arthropoda", "Symbiotic fungal gardens and galleries"),
     ("Environmental", "Terrestrial", "Nest", "Insects nest", "Fungus garden/Fungus gallery")),
    (("Host-associated", "Insecta", "Digestive system", "Large intestine"),
     ("Host-associated", "Insecta", "Digestive system", "Gut")),
    (("Host-associated", "Mollusca", "Digestive system", "Large intestine"),
     ("Host-associated", "Mollusca", "Digestive system", "Hindgut")),
    (("Host-associated", "Invertebrates", "Cnidaria", "Skin"),
     ("Host-associated", "Invertebrates", "Cnidaria")),
    (("Host-associated", "Mammals", "Digestive system", "Midgut"),
     ("Host-associated", "Mammals", "Digestive system")),
    (("Host-associated", "Plants", "Roots", "Rhizoplane", "Soil"),
     ("Host-associated", "Plants", "Roots", "Rhizoplane")),
    (("Host-associated", "Plants", "Phyllosphere", "Phylloplane/Leaf", "Epiphytes"),
     ("Host-associated", "Plants", "Phyllosphere", "Phylloplane/Leaf")),
    (("Environmental", "Aquatic", "Marine", "Intertidal zone", "Estuary"),
     ("Environmental", "Aquatic", "Marine", "Intertidal zone", "Estuary")),
    (("Environmental", "Aquatic", "Marine", "Brackish"),
     ("Environmental", "Aquatic", "Marine")),
    (("Environmental", "Aquatic", "Marine", "Oil-contaminated sediment"),
     ("Environmental", "Aquatic", "Marine")),
    (("Environmental", "Aquatic", "Freshwater", "Lentic", "Brackish"),
     ("Environmental", "Aquatic", "Freshwater", "Lentic")),
    (("Environmental", "Aquatic", "Freshwater", "Lotic"),
     ("Environmental", "Aquatic", "Freshwater", "Lotic")),
    (("Environmental", "Aquatic", "Freshwater", "Groundwater", "Biofilm"),
     ("Environmental", "Aquatic", "Freshwater", "Groundwater")),
    (("Environmental", "Aquatic", "Non-marine Saline and Alkaline", "Sediment"),
     ("Environmental", "Aquatic", "Non-marine Saline and Alkaline")),
    (("Engineered", "Wastewater", "Water and sludge"),
     ("Engineered", "Wastewater")),
    (("Engineered", "Bioreactor", "Continuous culture", "Marine sediment inoculum"),
     ("Engineered", "Bioreactor", "Continuous culture", "Marine sediment inoculum")),
    (("Engineered", "Bioreactor", "Continuous culture",
      "Marine intertidal flat sediment inoculum"),
     ("Engineered", "Bioreactor", "Continuous culture")),
    (("Engineered", "Bioreactor", "Anaerobic", "Biogas", "Wet fermentation"),
     ("Engineered", "Bioreactor", "Anaerobic", "Biogas")),
    (("Engineered", "Solid waste", "Composting", "Bioreactor"),
     ("Engineered", "Solid waste", "Composting")),
]


# Applied to every segment after the structural rules, keyed on the lowercased segment.
_TOKEN_CANONICAL_CASE = {
    "lab synthesis": "Lab synthesis",
    "tongue dorsum": "Tongue dorsum",
    "hard palate": "Hard palate",
}


def normalize_gold_ecosystem_path(path: Optional[str]) -> Optional[str]:
    """Return the canonical GOLD ecosystem path; idempotent, None/empty pass through."""
    if not path:
        return path
    segs = path.split(":")
    for match, repl in _RULES:
        n = len(match)
        if len(segs) >= n and tuple(segs[:n]) == match:
            segs = list(repl) + segs[n:]
            break
    for match, repl in _TRUNCATE:
        if tuple(segs[:len(match)]) == match:
            segs = list(repl)
            break
    segs = [_TOKEN_CANONICAL_CASE.get(s.lower(), s) for s in segs]
    # GOLD spells it "Activated Sludge" directly under Engineered:Wastewater and
    # "Activated sludge" everywhere else (WWTP, Sewage treatment plant, bioreactors).
    segs = [s if s.lower() != "activated sludge"
            else ("Activated Sludge" if i == 2 and segs[:2] == ["Engineered", "Wastewater"]
                  else "Activated sludge")
            for i, s in enumerate(segs)]
    return ":".join(segs)
