from extract import _norm, anon_name, pseudonym

assert anon_name("Ana Paula Chiarelli De Souza") == "Ana P**** C**** D**** S****"
assert anon_name("Júlia Llorente") == "Júlia L****"
assert anon_name("Monônimo") == "Monônimo"
assert pseudonym("2061012121") == pseudonym("2061012121")
assert pseudonym("2061012121") != pseudonym("2061012122")
assert _norm("André Felipe Fuck") == "andre felipe fuck"

print("ok")
