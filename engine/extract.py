import hashlib
import json
import math
import re
import statistics as st
import unicodedata
from pathlib import Path
from typing import TypedDict

import pymupdf

BASE = Path(__file__).resolve().parent          # engine/
ROOT = BASE.parent
PDF_DIR = BASE / "pdf"
OPT_OUT = BASE / "opt_out.txt"                  # quem pediu para não ser identificado
OUT = ROOT / "data" / "private" / "ranking.json"   # por aluno — NÃO publicar
OUT_PUB = ROOT / "data" / "public" / "data.json"   # agregados — isso sim é público

# LGPD: dados publicados são pseudonimizados. Salt fixo mantém o mesmo ID entre
# semestres (o site precisa ligar o aluno de um semestre a outro). Trocar o salt
# invalida todos os IDs — e é a única forma de "resetar" os pseudônimos.
SALT = "udesc-cct-ranking-v1"
ANON_NAME = "{prefere não identificar}"

REC = re.compile(r'^(\d{10}) (.+)$')
SKIP = re.compile(r'^(Rua Paulo|Sistema SIGA|Ord$|Matricula$|Nome$|Escore|Classif$|Fase$|Data e hora|Efetivada$|Escores|CCI-|REPÚBLICA|ESTADO|Universidade|CENTRO|^\d{2}/\d{2}/\d{4}( \d{2}:\d{2})?$)')
SEM = re.compile(r'prioriza..o de matr.culas - (\S+)')
SCORE = re.compile(r'^\d+,\d+$')
RANK = re.compile(r'^\d+$')


class Record(TypedDict):
    matricula: str
    nome: str
    escore: float
    rank: int


def _norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c)).lower().strip()


def pseudonym(matricula: str) -> str:
    return hashlib.sha256((SALT + matricula).encode()).hexdigest()[:12]


def anon_name(nome: str) -> str:
    """Mantém o primeiro nome; cada sobrenome vira inicial + ****."""
    parts = nome.split()
    if not parts:
        return nome
    return " ".join([parts[0], *(p[0].upper() + "****" for p in parts[1:])])


def load_opt_out() -> tuple[set[str], set[str]]:
    """Lista de quem pediu para não aparecer: matrícula (dígitos) ou nome completo."""
    mats: set[str] = set()
    nomes: set[str] = set()
    if not OPT_OUT.exists():
        return mats, nomes
    for line in OPT_OUT.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        (mats if line.isdigit() else nomes).add(line if line.isdigit() else _norm(line))
    return mats, nomes


class PDFExtractor:
    """Extrai os rankings do SIGA a partir dos PDFs em pdf/."""

    def parse(self, path: Path) -> tuple[str, list[Record]]:
        txt = "\n".join(p.get_text() for p in pymupdf.open(path))
        semester: str = SEM.search(txt).group(1)
        lines = txt.splitlines()
        idxs = [i for i, l in enumerate(lines) if REC.match(l)]
        recs: list[Record] = []
        for n, i in enumerate(idxs):
            end = idxs[n + 1] if n + 1 < len(idxs) else len(lines)
            matricula, nome = REC.match(lines[i]).groups()
            block = [l.strip() for l in lines[i + 1:end] if not SKIP.match(l) and l.strip()]
            if not any(SCORE.match(l) for l in block):  # escore colado na linha do nome
                nome, _, escore = nome.rpartition(" ")
            else:
                escore = next(l for l in block if SCORE.match(l))
            rank = int(next(l for l in block if RANK.match(l)))
            recs.append({"matricula": matricula, "nome": nome.title(),
                         "escore": float(escore.replace(",", ".")), "rank": rank})
        ranks = [r["rank"] for r in recs]
        assert ranks == sorted(ranks) and len(set(ranks)) == len(ranks), f"ranks quebrados em {semester}"
        return semester, recs

    def load_data(self) -> dict[str, list[Record]]:
        opt_mats, opt_nomes = load_opt_out()
        data: dict[str, list[Record]] = {}
        for pdf in sorted(PDF_DIR.glob("*.pdf")):
            s, recs = self.parse(pdf)
            data[s] = [self.anonymize(r, opt_mats, opt_nomes) for r in recs]
        for s, recs in data.items():
            ids = [r["matricula"] for r in recs]
            assert len(ids) == len(set(ids)), f"colisão de pseudônimos em {s}"
        return {s: data[s] for s in sorted(data)}

    @staticmethod
    def anonymize(r: Record, opt_mats: set[str], opt_nomes: set[str]) -> Record:
        out = r["matricula"] in opt_mats or _norm(r["nome"]) in opt_nomes
        return {
            "matricula": pseudonym(r["matricula"]),
            "nome": ANON_NAME if out else anon_name(r["nome"]),
            "escore": r["escore"],
            "rank": r["rank"],
        }


def generate_public(data: dict[str, list[Record]]) -> dict:
    """Agregados apenas — nunca deve conter nome, matrícula, identificador,
    escore individual ou posição individual (LGPD: privacidade by design)."""
    sems = sorted(data)
    per_sem = {}
    for s in sems:
        scores = [r["escore"] for r in data[s]]
        lo, hi = math.floor(min(scores) / 5) * 5, math.ceil(max(scores) / 5) * 5
        dist = [{"min": m, "max": m + 5, "count": 0} for m in range(lo, hi, 5)]
        for e in scores:
            dist[min(int((e - lo) // 5), len(dist) - 1)]["count"] += 1
        per_sem[s] = {
            "count": len(scores),
            "score": {"min": min(scores), "max": max(scores),
                      "mean": round(st.mean(scores), 2), "median": round(st.median(scores), 2)},
            "distribution": dist,
        }
    transitions = {}
    for a, b in zip(sems, sems[1:]):
        ia = {r["matricula"]: r for r in data[a]}
        ib = {r["matricula"]: r for r in data[b]}
        both = [(ia[m], ib[m]) for m in ia.keys() & ib.keys()]
        deltas = [rb["rank"] - ra["rank"] for ra, rb in both]
        n = len(deltas)
        transitions[f"{a}->{b}"] = {
            "n_both": n, "n_entered": len(ib.keys() - ia.keys()), "n_left": len(ia.keys() - ib.keys()),
            "mean_delta": round(st.mean(deltas), 2), "median_delta": st.median(deltas),
            "pct_rose": round(100 * sum(1 for d in deltas if d < 0) / n, 1),
            "pct_fell": round(100 * sum(1 for d in deltas if d > 0) / n, 1),
            "pct_same": round(100 * sum(1 for d in deltas if d == 0) / n, 1),
        }
    return {"course": "CCI-BAC", "semesters": sems, "per_semester": per_sem, "transitions": transitions}


def main() -> None:
    data = PDFExtractor().load_data()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    OUT_PUB.parent.mkdir(parents=True, exist_ok=True)
    OUT_PUB.write_text(json.dumps(generate_public(data), ensure_ascii=False, indent=1), encoding="utf-8")
    for s, recs in data.items():
        print(s, len(recs), "registros")
    print("->", OUT, "(privado)")
    print("->", OUT_PUB, "(público)")


if __name__ == "__main__":
    main()
