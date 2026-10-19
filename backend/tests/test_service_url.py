from __future__ import annotations

import pytest

from app.odata.service_url import (
    join_service_path,
    same_service,
    service_root_from_metadata_url,
    split_service_url,
)


@pytest.mark.parametrize(
    ("given", "metadata", "root"),
    [
        (
            "https://services.odata.org/V4/Northwind/Northwind.svc",
            "https://services.odata.org/V4/Northwind/Northwind.svc/$metadata",
            "https://services.odata.org/V4/Northwind/Northwind.svc/",
        ),
        (
            "services.odata.org/V4/Northwind/Northwind.svc/",
            "https://services.odata.org/V4/Northwind/Northwind.svc/$metadata",
            "https://services.odata.org/V4/Northwind/Northwind.svc/",
        ),
        (
            "https://h.example/odata/$metadata",
            "https://h.example/odata/$metadata",
            "https://h.example/odata/",
        ),
        (
            "https://h.example/odata/%24metadata?sap-client=100&$format=json",
            "https://h.example/odata/$metadata?sap-client=100",
            "https://h.example/odata/?sap-client=100",
        ),
    ],
)
def test_split(given: str, metadata: str, root: str) -> None:
    urls = split_service_url(given)
    assert urls.metadata_url == metadata
    assert urls.service_root == root


def test_split_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        split_service_url("not a url")
    with pytest.raises(ValueError):
        split_service_url("ftp://x.example/odata")


def test_root_after_redirect_keeps_session_segment() -> None:
    assert (
        service_root_from_metadata_url("https://services.odata.org/TripPinRESTierService/(S(abc))/$metadata")
        == "https://services.odata.org/TripPinRESTierService/(S(abc))/"
    )


def test_join_encodes_spaces_as_percent20_and_keeps_root_query() -> None:
    url = join_service_path(
        "https://h.example/odata/?sap-client=100", "Products", [("$top", "5"), ("$filter", "Name eq 'A B'")]
    )
    assert url == "https://h.example/odata/Products?sap-client=100&$top=5&$filter=Name%20eq%20'A%20B'"


def test_join_keeps_key_predicates() -> None:
    url = join_service_path("https://h.example/odata/", "Products(1)/Category")
    assert url == "https://h.example/odata/Products(1)/Category"


def test_same_service() -> None:
    root = "https://h.example/odata/"
    assert same_service(root, "https://h.example/odata/Products?$skiptoken=5")
    assert not same_service(root, "https://evil.example/odata/Products")
    assert not same_service(root, "https://h.example/other/Products")


def test_candidates_walk_up_from_a_resource_path() -> None:
    from app.odata.service_url import candidate_service_urls

    roots = [
        c.service_root
        for c in candidate_service_urls("https://h.example/odata/Kunden(1)/Umsaetze?sap-client=100")
    ]
    assert roots[:3] == [
        "https://h.example/odata/Kunden(1)/Umsaetze/?sap-client=100",
        "https://h.example/odata/Kunden(1)/?sap-client=100",
        "https://h.example/odata/?sap-client=100",
    ]
    assert (
        candidate_service_urls("https://h.example/odata/$metadata")[0].service_root
        == "https://h.example/odata/"
    )
    assert len(candidate_service_urls("https://h.example/odata/$metadata")) == 1
