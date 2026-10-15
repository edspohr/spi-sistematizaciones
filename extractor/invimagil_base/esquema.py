"""JSON schema for planilla.json (structured output). Mirrors _referencia/planilla-ejemplo.json."""
from __future__ import annotations


def _s(desc: str = "", nullable: bool = True) -> dict:
    t = ["string", "null"] if nullable else "string"
    d: dict = {"type": t}
    if desc:
        d["description"] = desc
    return d


def _n(desc: str = "", nullable: bool = True) -> dict:
    d: dict = {"type": ["number", "null"] if nullable else "number"}
    if desc:
        d["description"] = desc
    return d


def _b(desc: str = "", nullable: bool = True) -> dict:
    d: dict = {"type": ["boolean", "null"] if nullable else "boolean"}
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


DECISION = _s("Si el dato no se puede cerrar con los documentos: explica qué falta y las opciones. null si está resuelto.")
NOTE = _s("Nota breve de trazabilidad: documento y página de donde sale el dato. null si no aplica.")


def cat(list_id: str, desc: str = "") -> dict:
    return _obj(
        {
            "slug": _s(f"slug exacto de la lista {list_id} del catálogo; null si no se encontró"),
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
            "secondaryContainer": cat("secoCon", "si no hay envase secundario: slug y name null"),
            "secondaryMaterial": cat("secoMat"),
            "observations": _s("otras partes del empaque: bomba, tapa, etiquetas, película"),
            "_decision": DECISION,
        }
    )

    ingredient = _obj(
        {
            "order": {"type": "integer", "description": "orden en el COCC"},
            "inci": _s("nombre INCI exacto del COCC", nullable=False),
            "cas": _s("número CAS; null si el COCC no lo trae"),
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
                    "shelfLife": _obj({"months": {"type": ["integer", "null"]}, "_note": NOTE, "_decision": DECISION}),
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
