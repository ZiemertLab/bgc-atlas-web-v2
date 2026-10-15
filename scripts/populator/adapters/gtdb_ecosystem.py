"""GTDB genome-sample ecosystem enrichment: fills ``samples.gold_ecosystem_path`` plus
Madin species traits in ``samples.metadata``. No database access (that lives in
``tools/backfill_gtdb_ecosystem.py``).

:func:`ecosystem_for` is a strict priority ladder:

  * L1 GOLD authoritative -- ``ncbi_biosample`` in ``gold_biosample_ecosystem.tsv``.
  * L2 the genome's own metadata -- :func:`own_metadata_path` walks six fields through the
    :func:`iso_classify` rule engine; the winning field is the recorded provenance.
  * L3 Madin species habitat, crosswalked by :func:`madin_gold`.

L2 beats L3 because per-genome evidence outranks a species-level guess, and L2 must read
every per-genome field, not just ``ncbi_isolation_source``.

Every path is snapped by ``nearest()`` to a valid GOLD ancestor. The validity set comes from
``docs/GOLDs5levelEcosystemClassificationPaths.xlsx`` plus the corpus-canonical leaves that
:mod:`core.gold_normalize` spells differently from GOLD's sheet.

Inputs (regenerate with ``tools/prepare_gtdb_ecosystem_inputs.py``):
  * ``data/gtdb/gold_biosample_ecosystem.tsv``
  * ``data/gtdb/madin_species_traits.tsv``
"""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, FrozenSet, Optional, Tuple

from ..core.gold_normalize import normalize_gold_ecosystem_path
from .gem_metadata import _read_named_rows
from .envo_from_gold import gold_to_envo

GTDB_SOURCE_UUID = "eb473234-fae6-5fa1-8a99-8014e567fd3f"

REPO_ROOT = Path(__file__).resolve().parents[3]
GTDB_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "gtdb"
GOLD_BIOSAMPLE_PATH = GTDB_DIR / "gold_biosample_ecosystem.tsv"
MADIN_TRAITS_PATH = GTDB_DIR / "madin_species_traits.tsv"
GOLD_XLSX_PATH = REPO_ROOT / "docs" / "GOLDs5levelEcosystemClassificationPaths.xlsx"

GOLD_COLUMNS: Tuple[str, ...] = ("ncbi_biosample", "gold_ecosystem_path")
MADIN_COLUMNS: Tuple[str, ...] = (
    "species", "isolation_source", "optimum_ph", "optimum_tmp", "metabolism",
    "gram_stain", "range_salinity", "cell_shape",
)

MADIN_TRAIT_KEYS: Dict[str, str] = {
    "optimum_ph": "optimum_ph",
    "optimum_tmp": "optimum_temperature",
    "metabolism": "oxygen_metabolism",
    "gram_stain": "gram_stain",
    "range_salinity": "range_salinity",
    "cell_shape": "cell_shape",
}


# Do not change the regexes or mapping tables without re-validating against the corpus.
ANIMAL = re.compile(
    r'\b(bos taurus|bovine|cattle|cow|calf|mouse|mus musculus|murine|rat\b|rattus|pig\b|'
    r'sus scrofa|porcine|swine|piglet|sheep|ovine|lamb|goat|caprine|horse|equine|primate|'
    r'macaque|monkey|dog\b|canine|cat\b|feline)\b')
BIRD = re.compile(
    r'\b(chicken|gallus|poultry|turkey|duck|goose|broiler|hen\b|avian)\b')
H = 'Host-associated:Human'
# Order is the algorithm: the first matching rule wins, so tiers run most-specific first.
# Expected cases are pinned in tests/fixtures/iso_classify_cases.tsv.
RULES = [
    # T0: compounds a generic token would otherwise split.
    # Spaced spellings of these would otherwise reach the river rule's \bstream\b.
    (r'\bblood ?stream', H + ':Circulatory system'),
    (r'\bmid-? ?stream urine', H + ':Excretory system'),
    (r'\broot canal', H + ':Digestive system:Oral'),
    # A named host beats the habitat it sat in.
    (r'\bsponge', 'Host-associated:Porifera'),
    (r'macroalgae|seaweed|\bkelp\b|marine algae', 'Host-associated:Plants'),

    # T0b: facility / waste compounds a generic habitat token would otherwise take.
    # Only the pond compound belongs this high; bare 'tailings' is at T6b, since here it
    # would steal bioreactor and root-nodule samples.
    (r'\btail(ing|ling)s? ?pond|\bpond.{0,12}tail(ing|ling)', 'Engineered:Built environment:Tailings pond'),
    # Wastewater is left to T2 so a named aquatic habitat outranks a downstream wastewater
    # mention; the lookbehinds keep this rule off spaced/hyphenated "waste water".
    (r'\bdrinking water treatment', 'Engineered:Built environment:Drinking water treatment plant'),
    (r'(?<!waste )(?<!waste-)\bwater (treatment|purification) (plant|works)',
     'Engineered:Built environment:Water treatment plant'),
    (r'\bforest floor', 'Environmental:Terrestrial:Soil:Forest soil'),
    # Each below pre-empts a generic token that would claim it (e.g. 'dairy' -> Fermented
    # beverages, where the ANIMAL retarget never applies).
    (r'\b(dairy|lactating|milking) (cow|cattle|calf|calves|heifer|goats?|ewes?|buffalo)s?\b',
     'Host-associated:Mammals'),
    (r'\bseptic (tank|system|effluent)', 'Engineered:Wastewater:Sewage'),
    (r'\bfellfield', 'Environmental:Terrestrial:Soil:Tundra'),
    (r'\bnon-?hospitali[sz]ed', 'Host-associated:Human'),
    (r'\bagro-?industrial', 'Engineered:Solid waste:Industrial waste'),

    # T1: named aquatic habitats, above the engineered tier ("river near wwtp effluent").
    (r'\bmarine sediment', 'Environmental:Aquatic:Marine:Sediment'),
    (r'\bseawater|sea water|marine water|ocean|marine\b', 'Environmental:Aquatic:Marine'),
    (r'\bhydrothermal', 'Environmental:Aquatic:Marine:Hydrothermal vents'),
    (r'\bhot spring|hotspring|thermal spring|geothermal', 'Environmental:Aquatic:Thermal springs:Hot (42-90C)'),
    (r'\bestuar', 'Environmental:Aquatic:Marine:Intertidal zone:Estuary'),
    (r'\bsaline lake|salt lake|hypersaline|soda lake|\bbrine', 'Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake'),
    (r'\blake sediment|pond sediment|river sediment|freshwater sediment', 'Environmental:Aquatic:Freshwater:Sediment'),
    (r'\blake water|\blake\b', 'Environmental:Aquatic:Freshwater:Lake'),
    # 'stream' must be anchored, or it matches inside "bloodstream".
    (r'\briver|\bstream\b|creek', 'Environmental:Aquatic:Freshwater:River'),
    (r'\bgroundwater|aquifer', 'Environmental:Aquatic:Freshwater:Groundwater'),
    (r'\bfreshwater|fresh water|\bpond|drinking water|tap water', 'Environmental:Aquatic:Freshwater'),
    (r'\bglacier|glacial|ice core|permafrost', 'Environmental:Terrestrial:Soil:Permafrost'),
    # AMD: below the named habitats ("AMD-contaminated river water" is river water), above
    # bare sediment.
    (r'acid mine drainage sediment|\bamd sediment',
     'Engineered:Wastewater:Industrial wastewater:Acid mine drainage:Sediment'),
    (r'acid mine drainage|\bamd\b',
     'Engineered:Wastewater:Industrial wastewater:Acid mine drainage'),
    (r'\bsediment', 'Environmental:Aquatic:Sediment'),

    # T2: engineered containment. What the sample was pulled out of beats what was fed in.
    (r'\bactivated sludge|waste ?water|sewage|effluent|sludge', 'Engineered:Wastewater'),
    (r'\bbioreactor|fermentor|fermenter|digester|anaerobic digest', 'Engineered:Bioreactor'),
    (r'\bcompost', 'Engineered:Solid waste:Composting'),

    # T3: body sites, above the built environment (a hospital is where the patient was).
    (r"\bbreast milk|human milk|mother'?s milk", H + ':Digestive system'),
    (r'\bblood|bacter?emia|septic|bloodstream', H + ':Circulatory system'),
    (r'\bcerebrospinal|\bcsf\b|\bbrain|mening|nervous', H + ':Nervous system'),
    # Anchored, or they match "colony" and "gutter".
    (r'\bfeces|faeces|faecal|fecal|stool|\bguts?\b|intestin|\bcolon\b|colonic|rectal|rectum|caecum|cecum|ileum|gastrointestin|\bgi\b|bowel', H + ':Digestive system:Large intestine'),
    (r'\bsaliva|\boral|\bmouth|dental|tongue|gingiv|tooth|teeth|buccal', H + ':Digestive system:Oral'),
    (r'\bstomach|gastric|duoden', H + ':Digestive system'),
    (r'\bsputum|\blung|pulmonary|respiratory|bronch|tracheal|nasopharyn|nasophaynx|oropharyn|throat|tonsil|pharyn|\bnasal|\bnares|sinus|airway|\bbal\b|lavage', H + ':Respiratory system'),
    (r'\burine|urethra|urinary|bladder|\bkidney|renal', H + ':Excretory system'),
    (r'\bvagina|cervix|cervic|uterus|placenta|genital|reproductive|semen|penile|prostate', H + ':Reproductive system'),
    (r'\bskin|\bwound|abscess|\bpus\b|soft tissue|\bulcer|dermal|\baxilla|\bgroin', H + ':Skin'),
    # Mastitis in this corpus is overwhelmingly bovine/porcine.
    (r'\bmastitis', 'Host-associated:Mammals'),
    (r'\bear\b|otitis|\beye|conjunctiv|(?<!fl)ocular|cornea', H),
    (r'\bbile|\bliver\b|hepatic|gallbladder|pancrea|\bspleen', H + ':Digestive system'),
    # Food: below the body sites ("pork faeces"), above the generic human cue ("infant food").
    (r'\bpork|\bbeef|\bmeat|sausage|\bdeli\b|poultry|seafood|\bretail', 'Engineered:Food production'),
    (r'\bfood|kitchen', 'Engineered:Food production'),
    # Generic human cue, last in this tier.
    (r'\bhuman|homo sapiens|\bhomo\b|patient|clinical|infant|neonat|\bchild|nosocomial|sterile site|bodily fluid|blood culture', H),

    # T4: built environment, above bare water and dust. (?<!reef-) excludes "reef-building coral".
    (r'\bhospital|built environ|indoor|hvac|(?<!reef-)building|catheter|\bdevice|implant|space station|spacecraft|cleanroom|clean room', 'Engineered:Built environment'),

    # T5: last-resort bare water.
    (r'\bwater\b', 'Environmental:Aquatic:Freshwater'),

    # T6: plant hosts and food.
    (r'\brhizosphere|rhizoplane', 'Host-associated:Plants:Rhizosphere'),
    (r'\broot nodule|\bnodule', 'Host-associated:Plants:Roots'),
    (r'\broot\b|rhizome', 'Host-associated:Plants:Roots'),
    # Above the crop tokens ("rice wine koji"); no 'dairy', which would take "dairy farm soil".
    (r'\bkoji\b|kefir|sourdough|natto|miso|kimchi|\bwine\b|\bbeer\b|fermented', 'Engineered:Food production:Fermented beverages'),
    # Bounded: bare 'rice' matches 'price', 'leaves' 'leafy', 'grain' "soil grain".
    (r'\bleaf\b|\bleaves\b|phyllosphere|phylloplane|\bstem\b|shoot|flower|fruit|\bseed|'
     r'\brice\b|wheat|maize', 'Host-associated:Plants'),
    (r'\bcoral', 'Host-associated:Cnidaria'),
    # Bounded: 'planted forest' and 'plantation' are soils.
    (r'\bplants?\b|macroalgae|\balgae|seagrass|\bmoss|lichen', 'Host-associated:Plants'),

    # T6b: tailings, above the terrestrial tier (\bmine, \bmud) but below containment and hosts.
    (r'\btail(ing|ling)s?\b', 'Environmental:Terrestrial:Soil:Tailings'),

    # T7: terrestrial habitats.
    (r'\bforest soil', 'Environmental:Terrestrial:Soil:Forest soil'),
    (r'\bagricultur|cropland|farm soil|paddy|arable|field soil', 'Environmental:Terrestrial:Soil:Agricultural land'),
    (r'\bgrassland|meadow|pasture|prairie', 'Environmental:Terrestrial:Soil:Grasslands'),
    (r'\bdesert|\barid', 'Environmental:Terrestrial:Soil:Desert'),
    (r'\bpeat|\bbog|wetland|\bmarsh|mangrove', 'Environmental:Terrestrial:Soil:Wetlands'),
    (r'\btundra', 'Environmental:Terrestrial:Soil:Tundra'),
    (r'\bcave|\brock|subsurface|\bmine\b|borehole', 'Environmental:Terrestrial:Deep subsurface'),
    (r'\bsoil|\bsand\b|\bmud\b|\bdust', 'Environmental:Terrestrial:Soil'),

    # T8: remaining food and weak built-environment cues.
    (r'\bcheese|dairy|\bmilk|yogurt|yoghurt|vinegar', 'Engineered:Food production:Fermented beverages'),
    (r'\bdoor|\bfloor', 'Engineered:Built environment'),
    (r'\bbiofilm', 'Engineered:Built environment'),

    # T9: appended, so they only fire on text nothing above matched (and pre-empt the
    # ANIMAL/BIRD fallback: "Fly on pig farm" is a fly). Hosts precede bare habitat words,
    # except habitat compounds like "mussel bed".
    (r'\bmussel bed', 'Environmental:Aquatic:Marine:Intertidal zone'),

    (r'\b(ircinia|aplysina|halichondria|haliclona|theonella|xestospongia)\b',
     'Host-associated:Porifera'),
    # Molluscs before fish: "gills from mollusc".
    (r'\b(magallana|crassostrea|mytilus|ostrea|alviniconcha|bathymodiolus)\b|\boysters?\b|\bmussels?\b|\bclams?\b|'
     r'\babalone\b|\bmolluscs?\b|\bmollusks?\b|\bbivalves?\b|\bscallops?\b',
     'Host-associated:Mollusca'),
    (r'\b(oncorhynchus|salmo|danio|oreochromis|scophthalmus|gadus|lethrinus)\b|'
     r'\bfishes?\b|\bgills?\b', 'Host-associated:Fish'),
    (r'\b(drosophila|anopheles|aedes|culex|apis mellifera|bombyx)\b|\bflies\b|'
     r'\bfly\b(?!\s*ash)|\bmosquito|\binsects?\b|\bbeetle|\blarvae\b|\bhoney ?bee',
     'Host-associated:Insecta'),
    (r'\b(caenorhabditis|nematode)\b', 'Host-associated:Invertebrates'),
    (r'\bhaemolymph|\bhemolymph', 'Host-associated:Invertebrates'),

    (r'\bcold seeps?\b', 'Environmental:Aquatic:Marine:Cold seeps'),
    (r'\btar patt|\boil seep', 'Environmental:Aquatic:Marine:Oil seeps'),
    (r'\bintertidal|\blittoral', 'Environmental:Aquatic:Marine:Intertidal zone'),
    (r'\bcryoconite|\bice sheet|\bglacier ice', 'Environmental:Aquatic:Freshwater:Ice'),

    # Macroalgal genera -> Plants, consistent with the T0 kelp/seaweed rule.
    (r'\b(macrocystis|saccharina|ecklonia|laminaria|ulva|sargassum)\b',
     'Host-associated:Plants'),
    (r'\b(symbiodinium|symbiodiniaceae|cladocopium)\b', 'Host-associated:Algae'),
    (r'\b(arabidopsis|oryza|zea mays|triticum|hordeum|glycine max|solanum|brassica|'
     r'phaseolus|prunus|malus|vitis|citrus|arachis|astragalus|acmispon|medicago|'
     r'lactuca|nasturtium|pistacia|geranium|populus|quercus|saccharum|gossypium|'
     r'nicotiana|capsicum|cucumis|allium|beta vulgaris|sorghum|hevea|coffea|theobroma)\b',
     'Host-associated:Plants'),
    # Only common names that cannot also name an animal or animal part (no corn, cotton,
    # crop, soybean, straw); a plant rule bypasses the ANIMAL/BIRD retarget.
    (r'\btomato|\bpotato|\bpepper plant|\bgrapevine|\bsugarcane\b|\bgroundnut\b|'
     r'\blettuce\b|\bcabbage\b|\brice (plant|paddy|straw)\b|\bvegetables?\b',
     'Host-associated:Plants'),
    # T6's \broot\b does not match "roots".
    (r'\brhizoplane\b|\brhizosphere\b|\bxylem\b|\bphloem\b|\bplant roots?\b|\broots\b',
     'Host-associated:Plants:Roots'),
    (r'\bcankerous wood\b|\bpollen\b|\broot nodules?\b|\bphyllosphere\b',
     'Host-associated:Plants'),

    (r'\blandfill|\bleachate', 'Engineered:Solid waste:Landfill'),
    (r'\benrichment cultur|\bculturing unit\b', 'Engineered:Lab enrichment'),
    (r'\breactors?\b', 'Engineered:Bioreactor'),
    # A bare "drain" is as often surgical, so the fixture must be named.
    (r'\bsinks?\b|\bfaucets?\b|\bshowerhead|\bbuilt.?environment|\bindoor\b|'
     r'\b(sink|floor|shower|kitchen) drain\b|\bdrain ?pipe\b',
     'Engineered:Built environment'),
    (r'\bpickle|\bmeju\b|\bstarter cultur|\bprobiotic|\bpasteuri|\bhoney\b|'
     r'\bfeed additive|\bfermented\b|\bsilage factory|\bsugarcane factory',
     'Engineered:Food production'),
    # No bare 'engineered' rule: it describes a strain as often as a habitat.

    # The bounded 'axilla' rule does not match 'maxillary'.
    (r'\blymph nodes?\b|\blymphatic', 'Host-associated:Human:Lymphatic system'),
    (r'\bmaxill|\bmandibl', 'Host-associated:Human'),

    # T9b: strings the tightened patterns above used to classify correctly.
    (r'\boats?\b|\bbarley\b|\bmillet\b|\brye\b|\bsorghum\b|\bquinoa\b|\bcereal|\bgrains?\b',
     'Host-associated:Plants'),
    (r'\bplantations?\b|\bplanting\b', 'Environmental:Terrestrial:Soil:Agricultural land'),
    (r'\bplantains?\b|\bplantlets?\b|\bplantago|\bleafy green|\bliquorice|\blicorice',
     'Host-associated:Plants'),
    # 'plantar' is the sole of the foot.
    (r'\bplantar', H + ':Skin'),
    # hamster genera
    (r'\bcricet', 'Host-associated:Mammals'),
    # Safe this low: 'kelp forest' and 'forest floor' are claimed above.
    (r'\bforest\b', 'Environmental:Terrestrial:Soil:Forest soil'),

    # Broad fallbacks, last.
    (r'\bterrestrial\b|\bbiocrust\b', 'Environmental:Terrestrial'),
    (r'\baquatic\b', 'Environmental:Aquatic'),
]
COMP = [(re.compile(p), g) for p, g in RULES]
JUNK = {
    'na', 'n/a', 'not known', 'unknown', 'not provided', 'not applicable', 'missing',
    'none', 'not collected', 'not determined', 'environmental', 'environment', 'other',
    'not available', 'culture', 'tissue', 'clinical sample', 'isolate', 'core',
    'biological product', 'laboratory', 'type strain', 'reference', 'synthetic',
}

# Madin isolation_source category -> GOLD; first matching prefix wins, so most-specific first.
MADIN_RULES = [
    ('milk', 'Engineered:Food production:Dairy products'),
    ('volcanic_active', 'Environmental:Terrestrial:Volcanic'),
    ('hypersaline', 'Environmental:Aquatic:Non-marine Saline and Alkaline'),
    ('litter', 'Environmental:Terrestrial:Soil'),
    # "endotherm" does not confirm the host taxon, so not Mammals; the body site is kept in
    # metadata.madin.isolation_category instead.
    ('host_animal_endotherm', 'Host-associated'),
    ('host_animal_ectotherm', 'Host-associated'), ('host_animal', 'Host-associated'),
    ('host_plant_root', 'Host-associated:Plants:Roots'), ('host_plant', 'Host-associated:Plants'),
    ('host_algae', 'Host-associated:Plants'), ('host', 'Host-associated'),
    ('sediment_marine_hydrothermal', 'Environmental:Aquatic:Marine:Hydrothermal vents'),
    ('sediment_marine', 'Environmental:Aquatic:Marine:Sediment'),
    ('sediment_fresh', 'Environmental:Aquatic:Freshwater:Sediment'),
    ('sediment_hypersaline', 'Environmental:Aquatic:Non-marine Saline and Alkaline'),
    ('sediment', 'Environmental:Aquatic:Sediment'),
    ('water_marine', 'Environmental:Aquatic:Marine'),
    ('water_hotspring', 'Environmental:Aquatic:Thermal springs:Hot (42-90C)'),
    ('water_hypersaline', 'Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake'),
    ('water_groundwater', 'Environmental:Aquatic:Freshwater:Groundwater'),
    ('water_fresh', 'Environmental:Aquatic:Freshwater'), ('water', 'Environmental:Aquatic:Freshwater'),
    ('soil_agricultural', 'Environmental:Terrestrial:Soil:Agricultural land'),
    ('soil_forest', 'Environmental:Terrestrial:Soil:Forest soil'),
    ('soil_grassland', 'Environmental:Terrestrial:Soil:Grasslands'),
    ('soil_arid', 'Environmental:Terrestrial:Soil:Desert'),
    ('soil_contaminated', 'Environmental:Terrestrial:Soil:Contaminated'),
    ('soil_hydrocarbon', 'Environmental:Terrestrial:Soil:Contaminated'),
    ('soil', 'Environmental:Terrestrial:Soil'),
    ('rock_deep', 'Environmental:Terrestrial:Deep subsurface'),
    ('rock', 'Environmental:Terrestrial:Deep subsurface'),
    ('petroleum', 'Environmental:Terrestrial:Deep subsurface'),
    ('food_fermented', 'Engineered:Food production:Fermented beverages'),
    ('food', 'Engineered:Food production'),
    ('wastewater', 'Engineered:Wastewater'), ('sludge', 'Engineered:Wastewater'),
    ('bioreactor', 'Engineered:Bioreactor'), ('digester', 'Engineered:Bioreactor'),
    ('compost', 'Engineered:Solid waste:Composting'),
    ('built_environment', 'Engineered:Built environment'), ('biofilm', 'Engineered:Built environment'),
]


_NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
_REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def _collapse_gold(path: str) -> str:
    """GOLD's "X: Y" nodes would corrupt the gold MVs' SPLIT_PART(path, ':', N). Rename the
    two known ones ("Mammals: Human" -> "Human", "Arthropoda: Insects" -> "Insecta") and
    truncate at any other. Shared by the validity set and the value mapper so they agree.
    """
    path = path.replace('Mammals: Human', 'Human').replace('Arthropoda: Insects', 'Insecta')
    clean = []
    for seg in path.split(':'):
        if seg.startswith(' ') or ': ' in seg:
            break
        clean.append(seg)
    return ':'.join(clean)


def _iter_xlsx_paths(xlsx_path: Path):
    """Every collapsed path prefix in the GOLD sheet; stdlib XML, no openpyxl."""
    z = zipfile.ZipFile(xlsx_path)
    rels = {r.get('Id'): r.get('Target')
            for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rid = next(s.get(f'{_REL}id') for s in wb.iter(f'{_NS}sheet'))
    target = rels[rid]
    target = target if target.startswith('xl/') else 'xl/' + target.lstrip('/')
    root = ET.fromstring(z.read(target))

    def col_letter(ref: str) -> str:
        return re.match(r'[A-Z]+', ref).group()

    def cell_value(c):
        v = c.find(f'{_NS}v')
        if c.get('t') == 'inlineStr':
            return ''.join(x.text or '' for x in c.iter(f'{_NS}t'))
        return v.text if v is not None else None

    first = True
    for row in root.iter(f'{_NS}row'):
        if first:
            first = False
            continue
        cells = {}
        for c in row.findall(f'{_NS}c'):
            cells[col_letter(c.get('r'))] = cell_value(c)
        levels = [(cells.get(x) or '').strip() for x in ('B', 'C', 'D', 'E', 'F')]
        while levels and (levels[-1] == '' or levels[-1].lower() == 'unclassified'):
            levels.pop()
        collapsed = _collapse_gold(':'.join(levels))
        if not collapsed:
            continue
        segs = collapsed.split(':')
        for i in range(1, len(segs) + 1):
            if all(segs[:i]):
                yield ':'.join(segs[:i])


# L1 GOLD values collapse to these; they must survive nearest().
_DB_EXTRA_PATHS = ("Host-associated:Arthropoda", "Host-associated:Insecta")


def _curated_paths() -> set:
    """Every path the rule engine can emit, including ANIMAL/BIRD retargets, so nearest()
    never truncates a curated classification."""
    curated = {g for _, g in RULES} | {g for _, g in MADIN_RULES} | set(_DB_EXTRA_PATHS)
    for g in list(curated):
        if g.startswith(H):
            curated.add('Host-associated:Mammals' + g[len(H):])
            curated.add('Host-associated:Birds')
    return curated


def _build_gold_prefixes(xlsx_path: Path = GOLD_XLSX_PATH) -> FrozenSet[str]:
    prefixes = set(_iter_xlsx_paths(xlsx_path))
    for path in _curated_paths():
        segs = path.split(':')
        for i in range(1, len(segs) + 1):
            prefixes.add(':'.join(segs[:i]))
    return frozenset(prefixes)


_GOLD_PREFIXES: Optional[FrozenSet[str]] = None


def gold_prefixes() -> FrozenSet[str]:
    global _GOLD_PREFIXES
    if _GOLD_PREFIXES is None:
        _GOLD_PREFIXES = _build_gold_prefixes()
    return _GOLD_PREFIXES


def nearest(path: Optional[str]) -> Optional[str]:
    """Longest ':'-prefix in the validity set, or None."""
    if not path:
        return None
    prefixes = gold_prefixes()
    segs = path.split(':')
    for i in range(len(segs), 0, -1):
        candidate = ':'.join(segs[:i])
        if candidate in prefixes:
            return candidate
    return None


def norm_gold_naming(path: str) -> str:
    collapsed = _collapse_gold(path)
    result = nearest(collapsed) or collapsed
    if ': ' in result:
        result = _collapse_gold(result)
    return result


def _norm_iso(s: str) -> str:
    s = s.lower().strip()
    # Strip any ontology accession ('FOODON:...' contains "food"); GOLD sometimes emits
    # "[ENVO: 00002030]" with a space.
    s = re.sub(r'\[[a-z]+ ?[:_][0-9]+\]', '', s)
    s = re.sub(r'\b[a-z]{2,8}[_:][0-9]{4,}\b', '', s)
    return re.sub(r'\s+', ' ', s).strip(' .;,:-')


def iso_classify(s: Optional[str]) -> Optional[str]:
    """First matching rule wins; a Human hit is retargeted to Birds/Mammals on an
    avian/mammalian cue."""
    if s is None:
        return None
    n = _norm_iso(s)
    if not n or n in JUNK:
        return None
    animal = ANIMAL.search(n)
    bird = BIRD.search(n)
    for rx, g in COMP:
        if rx.search(n):
            if g.startswith('Host-associated:Human'):
                if bird:
                    g = 'Host-associated:Birds'
                elif animal:
                    g = 'Host-associated:Mammals' + g[len('Host-associated:Human'):]
            return nearest(g)
    if bird:
        return nearest('Host-associated:Birds')
    if animal:
        return nearest('Host-associated:Mammals')
    return None


def madin_gold(category: Optional[str]) -> Optional[str]:
    if not category:
        return None
    c = category.strip().lower()
    for prefix, g in MADIN_RULES:
        if c.startswith(prefix):
            return nearest(g)
    return None


def load_gold_biosample_ecosystem(path: Path = GOLD_BIOSAMPLE_PATH) -> Dict[str, str]:
    """Values are raw GOLD paths ("Mammals: Human" form), normalized at map time."""
    out: Dict[str, str] = {}
    for record in _read_named_rows(path, GOLD_COLUMNS):
        biosample = record["ncbi_biosample"]
        if biosample in out:
            raise ValueError(f"gtdb gold map: duplicate ncbi_biosample {biosample!r}")
        out[biosample] = record["gold_ecosystem_path"]
    return out


def load_madin_species_traits(path: Path = MADIN_TRAITS_PATH) -> Dict[str, dict]:
    """Species keys are already lowercased in the source."""
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, MADIN_COLUMNS):
        record = {c: record[c] for c in MADIN_COLUMNS}
        species = record["species"]
        if species in out:
            raise ValueError(f"gtdb madin traits: duplicate species {species!r}")
        out[species] = record
    return out


_GOLD_MAP: Optional[Dict[str, str]] = None
_MADIN: Optional[Dict[str, dict]] = None


def _gold_map() -> Dict[str, str]:
    global _GOLD_MAP
    if _GOLD_MAP is None:
        _GOLD_MAP = load_gold_biosample_ecosystem()
    return _GOLD_MAP


def _madin() -> Dict[str, dict]:
    global _MADIN
    if _MADIN is None:
        _MADIN = load_madin_species_traits()
    return _MADIN


# Priority order. biosample_isolation_source and host_scientific_name carry most of the signal.
OWN_METADATA_CASCADE = (
    "ncbi_isolation_source",
    "biosample_isolation_source",
    "host_scientific_name",
    "environment_material",
    "environment_feature",
    "environment_biome",
)
_ENVO_TRIAD = ("environment_material", "environment_feature", "environment_biome")


def derived_triad_fields(fields, current_path: Optional[str]) -> FrozenSet[str]:
    """ENVO-triad fields that tools/backfill_envo_from_gold.py derived from ``current_path``.

    Reading them back as evidence would launder the path being replaced. Detection only works
    while the old path exists, so it must run in the same pass as the write. Checked per
    field: that backfill only fills NULL columns, so real and derived values can coexist."""
    envo = gold_to_envo(current_path) if current_path else None
    if not envo:
        return frozenset()
    return frozenset(k for k in _ENVO_TRIAD if (fields.get(k) or None) == envo.get(k))


def own_metadata_path(fields, current_path: Optional[str] = None):
    """``(path, field_name)`` for the first resolvable field, or None.

    ``current_path`` only detects derived ENVO fields; it is not a floor, since the stored
    path may be the guess being deleted."""
    manufactured = derived_triad_fields(fields, current_path)
    for field in OWN_METADATA_CASCADE:
        if field in manufactured:
            continue
        text = fields.get(field)
        path = iso_classify(text) if text else None
        if path is None:
            continue
        return path, field
    return None


def _is_coarser(candidate: str, other: str) -> bool:
    return candidate != other and other.startswith(candidate + ":")


def ecosystem_for(
    biosample: Optional[str],
    fields,
    species: Optional[str],
    current_path: Optional[str] = None,
) -> Optional[dict]:
    """GOLD map, then own metadata, then Madin. A Madin result also carries the raw
    ``isolation_category`` so the backfill can keep the body site the generic path drops.
    """
    path = None
    source = None
    isolation_category = None

    if biosample and biosample in _gold_map():
        path = norm_gold_naming(_gold_map()[biosample])
        source = "GOLD"
    if path is None:
        own = own_metadata_path(fields, current_path) if fields else None

        madin_path = None
        madin_category = None
        if species:
            row = _madin().get(species)
            category = (row or {}).get("isolation_source", "").strip()
            if row is not None and category:
                madin_path = madin_gold(category)
                madin_category = category

        # L2 must not be coarser than the Madin fallback (never compared to the stored path).
        if own is not None and madin_path is not None and _is_coarser(own[0], madin_path):
            own = None

        if own is not None:
            path, source = own
        elif madin_path is not None:
            path = madin_path
            source = "madin"
            isolation_category = madin_category

    if path is None:
        return None
    result = {
        "gold_ecosystem_path": normalize_gold_ecosystem_path(path),
        "ecosystem_source": source,
    }
    if isolation_category is not None:
        result["isolation_category"] = isolation_category
    return result


def madin_traits_for(species: Optional[str]) -> dict:
    if not species:
        return {}
    row = _madin().get(species)
    if row is None:
        return {}
    out: dict = {}
    for column, key in MADIN_TRAIT_KEYS.items():
        value = (row.get(column) or "").strip()
        if value:
            out[key] = value
    return out
