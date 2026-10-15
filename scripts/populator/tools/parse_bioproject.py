"""Parse NCBI BioProject efetch XML into {accession: title}.

Title prefers ``Title``, then ``Name``, then ``Description``; NCBI null tokens are dropped.
"""
import xml.etree.ElementTree as ET
from typing import Dict

from scripts.populator.tools.parse_biosample import clean_attr


def parse_bioproject_set(xml) -> Dict[str, str]:
    root = ET.fromstring(xml.encode() if isinstance(xml, str) else xml)
    out: Dict[str, str] = {}
    for ds in root.iter("DocumentSummary"):
        arch = ds.find("./Project/ProjectID/ArchiveID")
        acc = (arch.get("accession") if arch is not None else "") or ""
        acc = acc.strip()
        if not acc:
            continue
        descr = ds.find("./Project/ProjectDescr")
        title = None
        if descr is not None:
            for tag in ("Title", "Name", "Description"):
                el = descr.find(tag)
                title = clean_attr(el.text if el is not None else None)
                if title:
                    break
        if title:
            out[acc] = title
    return out
