from scripts.populator.tools.os_bulk_load_parallel import bulk_action, bulk_error_records


def test_bulk_action_uses_the_requested_document_id_field():
    assert bulk_action({"gcf_id": "gcf-1"}, "gcf_id") == {
        "index": {"_id": "gcf-1"},
    }


def test_bulk_action_rejects_documents_without_an_id():
    try:
        bulk_action({"name": "missing"}, "sample_id")
    except ValueError as error:
        assert "sample_id" in str(error)
    else:
        raise AssertionError("expected a missing id error")


def test_bulk_error_records_keep_the_document_id_and_engine_error():
    response = {
        "items": [
            {"index": {"status": 201}},
            {"index": {"status": 400, "error": {"type": "mapper_parsing_exception"}}},
        ],
    }
    assert bulk_error_records(response, ["ok", "bad"]) == [
        {"id": "bad", "error": {"type": "mapper_parsing_exception"}},
    ]
