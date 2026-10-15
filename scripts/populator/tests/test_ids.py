import uuid
from scripts.populator import ids

def test_uuid_is_deterministic():
    a = ids.entity_id("samples", "metalog|5O_Y1.1")
    b = ids.entity_id("samples", "metalog|5O_Y1.1")
    assert a == b
    assert isinstance(a, uuid.UUID)

def test_different_entities_differ_for_same_key():
    assert ids.entity_id("samples", "X") != ids.entity_id("assemblies", "X")

def test_source_scoped_key():
    assert ids.scoped("mgnify", "SAMN1") == "mgnify|SAMN1"

def test_taxonomies_entity_registered():
    tid = ids.entity_id("taxonomies", "d__Bacteria;p__Bacillota")
    assert isinstance(tid, uuid.UUID)
