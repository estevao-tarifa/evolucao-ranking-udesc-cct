import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract import PDFExtractor, _norm, anon_name, pseudonym, generate_public

ROOT = Path(__file__).parent.parent
DATA = {s: [{"matricula": pseudonym(f"2061{1000 + i}"),
             "nome": anon_name(n), "escore": e, "rank": r}
            for i, (n, e, r) in enumerate([
                ("Ana Paula Chiarelli De Souza", 51.5, 1), ("Júlia Llorente", 42.0, 2),
                ("Monônimo", 33.3, 3), ("Bruno Teste Da Silva", 22.2, 4),
                ("Carla Exemplo", 12.9, 5)])]
        for s in ("2025/2", "2026/1")}

assert anon_name("Ana Paula Chiarelli De Souza") == "Ana P**** C**** D**** S****"
assert anon_name("Júlia Llorente") == "Júlia L****"
assert anon_name("Monônimo") == "Monônimo"
assert pseudonym("2061012121") == pseudonym("2061012121")
assert pseudonym("2061012121") != pseudonym("2061012122")
assert _norm("André Felipe Fuck") == "andre felipe fuck"


def test_public_data_does_not_expose_students():
    pub = generate_public(DATA)
    # estrutura esperada — nada além de contagens e estatísticas
    assert set(pub) == {"course", "semesters", "per_semester", "transitions"}
    for s, v in pub["per_semester"].items():
        assert set(v) == {"count", "score", "distribution"}
        assert set(v["score"]) == {"min", "max", "mean", "median"}
    for k, v in pub["transitions"].items():
        assert set(v) == {"n_both", "n_entered", "n_left", "mean_delta", "median_delta",
                          "pct_rose", "pct_fell", "pct_same"}
        assert 0 <= v["pct_rose"] + v["pct_fell"] + v["pct_same"] <= 100
    blob = str(pub)
    for banned in ("nome", "matricula", "escore", "rank", "students", "Ana", "Bruno"):
        assert banned not in blob, f"público expõe campo proibido: {banned}"
    # distribuição soma o total de alunos
    for s, v in pub["per_semester"].items():
        assert sum(b["count"] for b in v["distribution"]) == v["count"]
    print("test_public_data_does_not_expose_students: ok")


def test_transition_counts():
    t = generate_public(DATA)["transitions"]["2025/2->2026/1"]
    assert t["n_both"] == 5 and t["n_entered"] == 0 and t["n_left"] == 0
    print("test_transition_counts: ok")


if __name__ == "__main__":
    test_public_data_does_not_expose_students()
    test_transition_counts()
    print("ok")