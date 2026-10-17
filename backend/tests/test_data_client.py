"""Query building and V2/V4 response normalisation."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.odata.csdl_parser import parse_metadata
from app.odata.data_client import (
    AuthPayload,
    DataError,
    QueryOptions,
    basic_auth_header,
    build_query,
    column_order,
    normalise_payload,
    validate_next_link,
)

SAMPLES = Path(__file__).resolve().parent.parent / "app" / "odata" / "samples"


def model(name: str, root: str | None):
    m = parse_metadata((SAMPLES / name).read_bytes()).model
    m.service_root = root
    return m


def test_v4_query_url() -> None:
    m = model("northwind-v4.xml", "https://services.odata.org/V4/Northwind/Northwind.svc/")
    url = build_query(
        m,
        "Products",
        QueryOptions(
            top=10,
            skip=20,
            filter="UnitPrice gt 10",
            select=["ProductID", "ProductName"],
            orderby="ProductName desc",
        ),
    )
    assert url == (
        "https://services.odata.org/V4/Northwind/Northwind.svc/Products"
        "?$select=ProductID,ProductName&$filter=UnitPrice%20gt%2010&$orderby=ProductName%20desc&$top=10&$skip=20&$count=true"
    )


def test_v2_query_url_uses_inlinecount_and_json_format() -> None:
    m = model("northwind-v2.xml", "https://services.odata.org/V2/Northwind/Northwind.svc/")
    url = build_query(m, "Products", QueryOptions(top=5, count=True))
    assert url.endswith("/Products?$top=5&$inlinecount=allpages&$format=json")


def test_extra_query_parameters_for_parameterised_services() -> None:
    m = model("jdbcodata-demo.xml", "https://odata.status20.net/odata/")
    url = build_query(m, "Umsatz", QueryOptions(top=5, count=False, extra="p_jahr=2025&x=1"))
    assert url == "https://odata.status20.net/odata/Umsatz?$top=5&p_jahr=2025&x=1"


def test_without_service_root_data_is_refused() -> None:
    m = model("northwind-v4.xml", None)
    with pytest.raises(DataError, match="pasted or uploaded"):
        build_query(m, "Products", QueryOptions())


@pytest.mark.parametrize("path", ["https://evil.example/x", "../admin", "$batch", "$metadata", "a\nb"])
def test_bad_resource_paths(path: str) -> None:
    m = model("northwind-v4.xml", "https://h.example/odata/")
    with pytest.raises(DataError):
        build_query(m, path, QueryOptions())


def test_v4_payload() -> None:
    m = model("northwind-v4.xml", "https://h.example/odata/")
    rows, count, next_link = normalise_payload(
        {
            "@odata.context": "…",
            "@odata.count": 77,
            "value": [{"ProductID": 1, "ProductName": "Chai"}, {"ProductID": 2, "ProductName": "Chang"}],
            "@odata.nextLink": "Products?$skiptoken=2",
        },
        m,
    )
    assert count == 77 and next_link == "Products?$skiptoken=2"
    assert rows[1]["ProductName"] == "Chang"


def test_v2_payload_is_cleaned() -> None:
    m = model("northwind-v2.xml", "https://h.example/odata/")
    rows, count, next_link = normalise_payload(
        {
            "d": {
                "results": [
                    {
                        "__metadata": {"uri": "x", "type": "NorthwindModel.Order"},
                        "OrderID": 10248,
                        "OrderDate": "/Date(836438400000)/",
                        "ShippedDate": "/Date(836438400000+0120)/",
                        "Customer": {"__deferred": {"uri": "Orders(10248)/Customer"}},
                        "Order_Details": {"results": [{"__metadata": {}, "Quantity": 12}]},
                    }
                ],
                "__count": "830",
                "__next": "https://h.example/odata/Orders?$skiptoken=10248",
            }
        },
        m,
    )
    assert count == 830 and next_link and next_link.endswith("skiptoken=10248")
    row = rows[0]
    assert "__metadata" not in row
    assert row["OrderDate"] == "1996-07-04T00:00:00.000Z"
    assert row["ShippedDate"] == "1996-07-04T02:00:00.000+02:00"
    assert row["Customer"] == {"@link": "Orders(10248)/Customer"}
    assert row["Order_Details"] == [{"Quantity": 12}]


def test_v2_single_entity_payload() -> None:
    m = model("northwind-v2.xml", "https://h.example/odata/")
    rows, count, _ = normalise_payload({"d": {"__metadata": {}, "ProductID": 1}}, m)
    assert rows == [{"ProductID": 1}] and count is None


def test_error_payload_is_reported() -> None:
    m = model("northwind-v4.xml", "https://h.example/odata/")
    with pytest.raises(DataError, match="Bad filter"):
        normalise_payload({"error": {"code": "400", "message": "Bad filter"}}, m)
    with pytest.raises(DataError, match="V2 says no"):
        normalise_payload({"error": {"message": {"lang": "en", "value": "V2 says no"}}}, m)


def test_column_order_follows_entity_type_then_extras() -> None:
    m = model("northwind-v4.xml", "https://h.example/odata/")
    product = next(et for s in m.schemas for et in s.entity_types if et.name == "Product")
    rows = [{"ProductName": "Chai", "ProductID": 1, "Extra": True}]
    assert column_order(rows, product, [])[:2] == ["ProductID", "ProductName"]
    assert column_order(rows, product, [])[-1] == "Extra"
    assert column_order(rows, product, ["ProductName", "ProductID"]) == ["ProductName", "ProductID"]


def test_expanded_navigations_stay_visible_with_select() -> None:
    from app.odata.data_client import expand_names

    assert expand_names("Kunde($select=Name,Region),Produkt") == ["Kunde", "Produkt"]
    assert expand_names(None) == []
    m = model("northwind-v4.xml", "https://h.example/odata/")
    product = next(et for s in m.schemas for et in s.entity_types if et.name == "Product")
    rows = [{"ProductID": 1, "Category": {"CategoryID": 1}}]
    assert column_order(rows, product, ["ProductID"], "Category($select=CategoryName)") == ["ProductID", "Category"]
    assert column_order(rows, product, ["ProductID"], "*")[:2] == ["ProductID", "Category"]


def test_next_link_must_stay_on_the_service() -> None:
    m = model("northwind-v4.xml", "https://h.example/odata/")
    assert validate_next_link(m, "Products?$skiptoken=2") == "https://h.example/odata/Products?$skiptoken=2"
    assert validate_next_link(m, "https://h.example/odata/Products?$skiptoken=2").endswith("skiptoken=2")
    with pytest.raises(DataError, match="outside"):
        validate_next_link(m, "https://evil.example/odata/Products")


def test_basic_auth_header() -> None:
    assert basic_auth_header(None) == {}
    assert basic_auth_header(AuthPayload(username="u", password="p")) == {"Authorization": "Basic dTpw"}
