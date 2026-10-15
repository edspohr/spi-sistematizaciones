"""Parse and validate against invimagil-catalogos.txt (InvimÁgil hierarchy lists).

File format:
    ===  <listId> <Nombre de la lista> <count>
    slug | NAME
      childslug | CHILD NAME        (indentation = depth)
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

HEADER_RE = re.compile(r"^===\s+(\S+)\s+(.*?)\s+(\d+)\s*$")


@dataclass
class Entry:
    slug: str
    name: str
    depth: int
    parent: str | None


@dataclass
class Catalog:
    lists: dict[str, dict[str, Entry]] = field(default_factory=dict)
    titles: dict[str, str] = field(default_factory=dict)

    def entries(self, list_id: str) -> dict[str, Entry]:
        return self.lists.get(list_id, {})

    def lookup(self, list_id: str, slug: str | None) -> Entry | None:
        if not slug:
            return None
        return self.entries(list_id).get(slug.strip())

    def find_by_name(self, list_id: str, name: str | None) -> Entry | None:
        if not name:
            return None
        key = normalize(name)
        for e in self.entries(list_id).values():
            if normalize(e.name) == key:
                return e
        return None

    def units_for_parameter(self, param_slug: str) -> list[Entry]:
        """parType children: 'UNIDADES DE MEDIDA' node whose children are the units."""
        out = []
        for e in self.entries("parType").values():
            if e.depth == 1 and e.parent == param_slug:
                out.extend(
                    u for u in self.entries("parType").values() if u.depth == 2 and u.parent == e.slug
                )
        return out


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().casefold()


def load_catalog(path: Path) -> Catalog:
    cat = Catalog()
    current: str | None = None
    stack: list[tuple[int, str]] = []  # (depth, slug)
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        m = HEADER_RE.match(raw)
        if m:
            current = m.group(1)
            cat.titles[current] = m.group(2)
            cat.lists.setdefault(current, {})
            stack = []
            continue
        if current is None or "|" not in raw:
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        depth = indent // 2
        slug, name = (p.strip() for p in raw.split("|", 1))
        while stack and stack[-1][0] >= depth:
            stack.pop()
        parent = stack[-1][1] if stack else None
        cat.lists[current][slug] = Entry(slug=slug, name=name, depth=depth, parent=parent)
        stack.append((depth, slug))
    return cat


# --- Validation of a planilla ---------------------------------------------------------

CATALOG_FIELDS: list[tuple[str, str]] = [
    # (json path with [] for arrays, list id)
    ("general.product.cosmeticForm", "cosmFor"),
    ("general.product.productCategory", "prodCat"),
    ("general.presentations[].measureUnit", "presUni"),
    ("general.presentations[].primaryContainer", "primCon"),
    ("general.presentations[].primaryMaterial", "primMat"),
    ("general.presentations[].secondaryContainer", "secoCon"),
    ("general.presentations[].secondaryMaterial", "secoMat"),
    ("composition.ingredients[].functions[]", "cosmFun"),
    ("composition.ingredients[].referenceList", "refList"),
    ("composition.ingredients[].unit", "compUni"),
    ("technicalCharacteristics.microbiological.applicationArea", "appArea"),
]


def _walk(obj, path: list[str]):
    """Yield every object addressed by a dotted path with [] markers."""
    if not path:
        yield obj
        return
    head, rest = path[0], path[1:]
    if head.endswith("[]"):
        key = head[:-2]
        for item in (obj or {}).get(key) or []:
            yield from _walk(item, rest)
    else:
        nxt = (obj or {}).get(head)
        if nxt is not None:
            yield from _walk(nxt, rest)


def validate_planilla(planilla: dict, cat: Catalog) -> list[str]:
    """Fix slug/name pairs against the catalog in place. Returns a list of Spanish warnings."""
    warnings: list[str] = []
    for path, list_id in CATALOG_FIELDS:
        for node in _walk(planilla, path.split(".")):
            if not isinstance(node, dict):
                continue
            slug, name = node.get("slug"), node.get("name")
            if not slug and not name:
                continue
            entry = cat.lookup(list_id, slug)
            if entry is None:
                entry = cat.find_by_name(list_id, name)
                if entry is not None:
                    warnings.append(f"{path}: slug «{slug}» corregido a «{entry.slug}» por nombre «{name}»")
                else:
                    warnings.append(f"{path}: «{slug} | {name}» no existe en la lista {list_id}; queda como decisión")
                    node["slug"] = None
                    node["_decision"] = (node.get("_decision") or "") + f" [Valor no encontrado en el catálogo {list_id}: «{name}». Elegir en pantalla.]"
                    continue
            node["slug"], node["name"] = entry.slug, entry.name

    # physicochemical: parType + unit must be children of the parameter
    for p in (planilla.get("technicalCharacteristics") or {}).get("physicochemical") or []:
        pslug = p.get("parameterTypeSlug")
        entry = cat.lookup("parType", pslug)
        if entry is None or entry.depth != 0:
            byname = cat.find_by_name("parType", p.get("parameterTypeName"))
            if byname and byname.depth == 0:
                p["parameterTypeSlug"], p["parameterTypeName"] = byname.slug, byname.name
                entry = byname
            else:
                warnings.append(f"fisicoquímico «{p.get('parameterTypeName')}»: tipo de parámetro no está en el catálogo")
                p["parameterTypeSlug"] = None
                p["_decision"] = (p.get("_decision") or "") + " [Tipo de parámetro no encontrado en el catálogo; elegir en pantalla.]"
                continue
        p["parameterTypeName"] = entry.name
        units = cat.units_for_parameter(entry.slug)
        uslug = p.get("unitSlug")
        unit = next((u for u in units if u.slug == uslug), None)
        if unit is None:
            unit = next((u for u in units if normalize(u.name) == normalize(p.get("unitName") or "")), None)
            if unit is not None:
                warnings.append(f"fisicoquímico «{entry.name}»: unidad «{uslug}» corregida a «{unit.slug}» por nombre «{unit.name}»")
        if unit is None:
            opts = ", ".join(f"{u.slug} | {u.name}" for u in units) or "sin unidades en el catálogo"
            warnings.append(f"fisicoquímico «{entry.name}»: unidad «{p.get('unitName')}» no válida. Opciones: {opts}")
            p["unitSlug"] = None
            p["_decision"] = (p.get("_decision") or "") + f" [Unidad no válida para este parámetro. Opciones: {opts}]"
        else:
            p["unitSlug"], p["unitName"] = unit.slug, unit.name
    return warnings
