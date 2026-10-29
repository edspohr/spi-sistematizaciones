"""JSON schema for planilla.json (structured output). Mirrors _referencia/planilla-ejemplo.json."""
from __future__ import annotations


# The API limits union-typed parameters (e.g. ["string","null"]) to 16 per schema, so no field is
# nullable here: an empty string means "sin dato"; tri-state booleans are string enums; optional
# numbers are strings parsed afterwards (see normalizar_planilla).
def _s(desc: str = "", nullable: bool = True) -> dict:
    d: dict = {"type": "string"}
    if nullable:
        desc = (desc + " " if desc else "") + 'Cadena vacía "" si no hay dato.'
    d["description"] = desc.strip()
    return d


def _n(desc: str = "", nullable: bool = True) -> dict:
    if nullable:
        return {"type": "string", "description": (desc + " " if desc else "") + 'Número escrito como texto (punto decimal); "" si no aplica.'}
    d: dict = {"type": "number"}
    if desc:
        d["description"] = desc
    return d


def _b(desc: str = "", nullable: bool = True) -> dict:
    if nullable:
        return {"type": "string", "enum": ["si", "no", "desconocido"], "description": (desc + " " if desc else "") + "desconocido si los documentos no lo dicen."}
    d: dict = {"type": "boolean"}
    if desc:
        d["description"] = desc
    return d


def _arr(items: dict, desc: str = "") -> dict:
    d: dict = {"type": "array", "items": items}
    if desc:
        d["description"] = desc
    return d


def _obj(props: dict, desc: str = "") -> dict:
    d: dict = {
        "type": "object",
        "properties": props,
        "required": list(props.keys()),
        "additionalProperties": False,
    }
    if desc:
        d["description"] = desc
    return d


DECISION = _s('Si el dato no se puede cerrar con los documentos: explica qué falta y las opciones; "" si está resuelto.')
NOTE = _s('Nota breve de trazabilidad: documento y página de donde sale el dato; "" si no aplica.')


def cat(list_id: str, desc: str = "") -> dict:
    return _obj(
        {
            "slug": _s(f"slug exacto de la lista {list_id} del catálogo; vacío si no se encontró"),
            "name": _s(f"nombre exacto de la lista {list_id}; si no se encontró, el texto original del documento"),
            "_decision": DECISION,
        },
        desc,
    )


def build_schema() -> dict:
    archivo = _obj(
        {
            "archivo": _s("nombre literal del archivo en la carpeta", nullable=False),
            "clasificacion": {
                "type": "string",
                "enum": [
                    "COCC", "especificaciones", "envase", "vida_util", "NAT", "declaracion_res_814",
                    "codificacion_lotes", "etiqueta", "sticker", "poder", "LOA", "GMP", "soporte_claims",
                    "estabilidad", "microbiologico", "descripcion_producto", "otro", "ilegible",
                ],
            },
            "legible": _b(nullable=False),
            "resumen": _s("una línea: qué contiene y fecha del documento", nullable=False),
        }
    )

    company = _obj(
        {
            "name": _s(nullable=False),
            "address": _s(),
            "countryCode": _s("ISO-2"),
            "countryName": _s(),
            "isForeign": _b(nullable=False),
            "_note": NOTE,
        }
    )

    presentation = _obj(
        {
            "order": {"type": "integer"},
            "netContent": _n("contenido neto, número", nullable=False),
            "measureUnit": cat("presUni"),
            "primaryContainer": cat("primCon"),
            "primaryMaterial": cat("primMat"),
            "secondaryContainer": cat("secoCon", "si no hay envase secundario: slug y name vacíos"),
            "secondaryMaterial": cat("secoMat"),
            "observations": _s("otras partes del empaque: bomba, tapa, etiquetas, película"),
            "_decision": DECISION,
        }
    )

    ingredient = _obj(
        {
            "order": {"type": "integer", "description": "orden en el COCC"},
            "inci": _s("nombre INCI exacto del COCC", nullable=False),
            "cas": _s("número CAS; vacío si el COCC no lo trae"),
            "itemType": {"type": "string", "enum": ["basic", "secondary"]},
            "functionSource": _s("función tal como la escribe el COCC"),
            "functions": _arr(cat("cosmFun")),
            "referenceList": cat("refList"),
            "quantity": _n("cantidad con todos los decimales del COCC", nullable=False),
            "unit": cat("compUni"),
            "isNanomaterial": _b(nullable=False),
            "_note": NOTE,
            "_decision": DECISION,
        }
    )

    physicochemical = _obj(
        {
            "order": {"type": "integer"},
            "parameterTypeSlug": _s("slug de nivel 0 de parType"),
            "parameterTypeName": _s(nullable=False),
            "isRange": _b(nullable=False),
            "min": _n(),
            "max": _n(),
            "value": _n("valor único cuando no es rango"),
            "unitSlug": _s("slug de la unidad, hijo de UNIDADES DE MEDIDA del parámetro"),
            "unitName": _s(),
            "_note": NOTE,
            "_decision": DECISION,
        }
    )

    decision = _obj(
        {
            "id": _s("D1, D2, ...", nullable=False),
            "tema": _s(nullable=False),
            "donde": _s("paso y campo del formulario afectado, p. ej. «Paso 1 · Responsable técnico»", nullable=False),
            "hallazgo": _s("qué falta o qué documentos se contradicen, con cifras y nombres de archivo", nullable=False),
            "propuesta": _s("qué propones elegir y por qué; o las opciones si no hay propuesta", nullable=False),
        }
    )

    schema = _obj(
        {
            "_meta": _obj(
                {
                    "producto": _s(nullable=False),
                    "tipoTramite": _s("NSO nueva o sistematización de NSO vigente, si se deduce", nullable=False),
                    "titular": _s("titular de la NSO según los documentos"),
                    "fabricanteResumen": _s("razón social y planta, en una línea"),
                    "fuente": _s("lista breve de documentos y fechas usados", nullable=False),
                    "hallazgos": _arr(_s(nullable=False), "discrepancias entre documentos, vigencias, tamaños de archivo, etc."),
                }
            ),
            "archivos": _arr(archivo, "un elemento por archivo de la carpeta, todos"),
            "general": _obj(
                {
                    "responsibles": _obj(
                        {
                            "technical": _obj({"name": _s(), "_decision": DECISION}),
                            "legal": _obj({"name": _s(), "_note": NOTE, "_decision": DECISION}),
                        }
                    ),
                    "origin": _obj({"value": _s("Importado o Nacional"), "importer": _s(), "_note": NOTE, "_decision": DECISION}),
                    "manufacturer": _obj(
                        {
                            "type": _s("propio o tercero"),
                            "thirds": _arr(_obj({"company": company})),
                            "_decision": DECISION,
                        }
                    ),
                    "product": _obj(
                        {
                            "name": _s(nullable=False),
                            "genericName": _s("denominación genérica en español"),
                            "declaresCosmeticGroups": _b(nullable=False),
                            "brands": _arr(_s(nullable=False)),
                            "cosmeticForm": cat("cosmFor"),
                            "productCategory": cat("prodCat"),
                            "_note": NOTE,
                            "_decision": DECISION,
                        }
                    ),
                    "presentations": _arr(presentation),
                }
            ),
            "composition": _obj(
                {
                    "ingredients": _arr(ingredient, "una entrada por línea del COCC, en el orden del COCC"),
                    "_checks": _obj(
                        {
                            "sumaBasicos": _n(nullable=False),
                            "sumaSecundarios": _n(nullable=False),
                            "n": {"type": "integer"},
                            "_note": NOTE,
                        }
                    ),
                }
            ),
            "useInformation": _obj(
                {
                    "instructions": _s("modo de uso literal de la etiqueta o sticker"),
                    "warnings": _s("advertencias literales"),
                    "_note": NOTE,
                    "_decision": DECISION,
                }
            ),
            "technicalCharacteristics": _obj(
                {
                    "organoleptic": _obj(
                        {"color": _s(), "odor": _s(), "taste": _s("«No aplica» cuando no aplica"), "_note": NOTE, "_decision": DECISION}
                    ),
                    "otherOrganoleptic": _arr(_obj({"characteristic": _s(nullable=False), "value": _s(nullable=False)})),
                    "physicochemical": _arr(physicochemical),
                    "microbiological": _obj(
                        {
                            "isExcepted": _b(),
                            "justification": _s(),
                            "applicationArea": cat("appArea", "área de aplicación (nivel 0 de appArea)"),
                            "ageGroupSlug": _s("slug de FASE ETAREA (nivel 2 de appArea) bajo el área elegida"),
                            "ageGroupName": _s(),
                            "limits": _s("límites microbiológicos declarados en las especificaciones, texto literal"),
                            "_note": NOTE,
                            "_decision": DECISION,
                        }
                    ),
                    "shelfLife": _obj({"months": {"type": "integer", "description": "meses de vida útil; 0 si no se conoce"}, "_note": NOTE, "_decision": DECISION}),
                }
            ),
            "mandatoryDocuments": _obj(
                {
                    "animalTestingDeclaration": _arr(_s(nullable=False), "nombres literales de archivo"),
                    "cosmeticBenefitsSupport": _arr(_s(nullable=False)),
                    "label": _obj(
                        {
                            "isFinalLabel": _b(),
                            "artworkFiles": _arr(_s(nullable=False)),
                            "_decision": DECISION,
                        }
                    ),
                    "lotsCoding": _arr(_obj({"manufacturer": _s(nullable=False), "files": _arr(_s(nullable=False))})),
                    "phosphorusContent": _obj(
                        {
                            "analyticalCertificate": _arr(_s(nullable=False)),
                            "conformityDeclaration": _arr(_s(nullable=False)),
                        }
                    ),
                    "_note": NOTE,
                }
            ),
            "additionalDocuments": _arr(
                _obj({"archivo": _s(nullable=False), "descripcion": _s("nombre de la casilla propuesta en español", nullable=False)})
            ),
            "decisiones": _arr(decision, "lista consolidada de TODAS las decisiones pendientes (cada _decision del JSON debe tener su entrada aquí)"),
        }
    )
    return schema


if __name__ == "__main__":
    import json

    print(json.dumps(build_schema(), ensure_ascii=False, indent=1)[:3000])


def normalizar_planilla(obj):
    """Undo the no-union encoding: "" -> None, tri-state enums -> bool/None, numeric strings -> float."""
    TRI = {"si": True, "no": False, "desconocido": None}
    NUM_KEYS = {"min", "max", "value"}
    TRI_KEYS = {"isExcepted", "isFinalLabel"}

    def walk(o, key=None):
        if isinstance(o, dict):
            return {k: walk(v, k) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(v, key) for v in o]
        if isinstance(o, str):
            t = o.strip()
            if key in TRI_KEYS and t.lower() in TRI:
                return TRI[t.lower()]
            if key in NUM_KEYS:
                if t == "":
                    return None
                try:
                    return float(t.replace(",", "."))
                except ValueError:
                    return t
            return None if t == "" else o
        return o

    out = walk(obj)
    sl = (out.get("technicalCharacteristics") or {}).get("shelfLife") or {}
    if sl.get("months") == 0:
        sl["months"] = None
    return out


def contar_uniones(schema) -> int:
    """How many parameters use type arrays or anyOf (API limit: 16)."""
    n = 0
    if isinstance(schema, dict):
        if isinstance(schema.get("type"), list) or "anyOf" in schema or "oneOf" in schema:
            n += 1
        for v in schema.values():
            n += contar_uniones(v)
    elif isinstance(schema, list):
        for v in schema:
            n += contar_uniones(v)
    return n


def _vacio(schema: dict):
    """Empty value for a schema node (used to fill keys the model omitted in text mode)."""
    t = schema.get("type")
    if t == "object":
        return {k: _vacio(v) for k, v in schema.get("properties", {}).items()}
    if t == "array":
        return []
    if t == "string":
        enum = schema.get("enum")
        if enum:
            return "desconocido" if "desconocido" in enum else enum[0]
        return ""
    if t == "integer":
        return 0
    if t == "number":
        return 0.0
    if t == "boolean":
        return False
    return None


def completar_planilla(data, schema: dict):
    """Fill in missing keys (per the schema) and drop unknown ones, recursively. Values are not coerced."""
    t = schema.get("type")
    if t == "object":
        if not isinstance(data, dict):
            return _vacio(schema)
        props = schema.get("properties", {})
        return {k: completar_planilla(data[k], v) if k in data else _vacio(v) for k, v in props.items()}
    if t == "array":
        if not isinstance(data, list):
            return []
        return [completar_planilla(x, schema["items"]) for x in data]
    return data
