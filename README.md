# Evolução no Ranking — UDESC/CCT

> **Site NÃO oficial.** Projeto independente criado por **Estevão Tarifa**, sem vínculo
> institucional com a UDESC. Usa apenas dados públicos de escores para priorização de matrículas
> (SIGA/UDESC). A marca e a identidade visual pertencem à UDESC.

Visualização estática da evolução dos alunos no ranking de escores do CCT, pronta para
**GitHub Pages**. Os dados são gerados a partir dos PDFs do SIGA por um motor Python em `engine/`.

## Estrutura

```
index.html          Página (GitHub Pages serve este arquivo)
assets/style.css    Estilos (identidade visual UDESC)
assets/app.js       Toda a lógica (sem backend)
data/public/data.json  Estatísticas agregadas (público, commitar a cada atualização)
data/private/          dados por aluno (NÃO commitar — ver LGPD)
engine/extract.py   Motor: lê os PDFs e escreve data/data.json
engine/pdf/         PDFs de origem do SIGA (NÃO commitar — ver LGPD)
engine/opt_out.txt  Quem pediu para não aparecer (NÃO commitar)
engine/requirements.txt
```

## Privacidade / LGPD

O site público mostra **somente dados agregados** (nº de alunos, média, mediana, corte,
distribuição por faixa, movimento médio entre semestres): nenhum nome, matrícula,
posição ou escore individual é publicado. Isso é regra verificável:
`engine/test_extract.py::test_public_data_does_not_expose_students`.

O que é gerado por pessoa fica **pseudonimizado** — mas pseudônimo não é anonimato
(art. 5º, XII), então continua sendo dado pessoal e fica **só localmente**:

- **Nome:** só o primeiro nome; cada sobrenome vira inicial + `****`
  (ex.: `Ana Paula Chiarelli De Souza` → `Ana P**** C**** D**** S****`).
- **Matrícula:** substituída por um pseudônimo estável (hash), para o site ainda
  conseguir ligar o mesmo aluno entre semestres sem expor o número.
- **Opt-out:** quem não quiser aparecer tem o nome gravado como
  `{prefere não identificar}`.

Para alguém sair do site:

1. Copie `engine/opt_out.example.txt` para `engine/opt_out.txt`.
2. Coloque a matrícula real (10 dígitos) ou o nome completo, uma pessoa por linha.
3. Rode `python engine/extract.py` e commite o `data/public/data.json` atualizado.

`engine/opt_out.txt` contém dados pessoais — por isso está no `.gitignore`.

> **Atenção:** os PDFs do SIGA (`engine/pdf/`) contêm nomes e matrículas reais e
> também estão no `.gitignore`. Se você já os commitou alguma vez, eles continuam
> no histórico do git. Para removê-los de vez do histórico use
> `git filter-repo` (ou BFG) — sem isso, o dado antigo segue acessível.


## Atualizar os dados (fluxo de trabalho)

1. Baixe os PDFs do SIGA e coloque em `engine/pdf/` (um por semestre).
2. Instale a dependência: `pip install -r engine/requirements.txt`
3. Rode o motor: `python engine/extract.py`
4. Commite o resultado: `git add data/public/data.json && git commit -m "dados: <semestre>"`

O nome do semestre é lido do próprio PDF, então não precisa renomear os arquivos.

## Rodar localmente

Site público (agregado):

```bash
python -m http.server 8000
# abra http://localhost:8000
```

Visualizador completo (individual, pseudonimizado — uso pessoal):

```bash
python engine/extract.py        # gera data/private/ranking.json
python -m http.server 8000
# abra http://localhost:8000/local.html
```

> `local.html` está no `.gitignore`: o visualizador individual existe só localmente.

## Publicar no GitHub Pages

```bash
git init
git add .
git commit -m "projeto inicial"
git branch -M main
git remote add origin https://github.com/<usuario>/<repo>.git
git push -u origin main
```

Depois, no GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main` / `(root)` → Save**. O site fica em `https://<usuario>.github.io/<repo>/`.

## Recursos

- Seleção do semestre atual (movimentação calculada contra o semestre anterior).
- Visão geral: entradas, saídas, média/desvio de movimento, correlação e movimento vs. vizinhos.
- Movimentação entre semestres (seção recolhível).
- Comparar alunos (escore): adicione vários alunos e compare; opção **alinhar pela entrada**
  (1º, 2º … semestre de cada um) para uma comparação justa entre quem entrou em semestres diferentes.
- Por aluno: gráficos de posição (Você/Melhor/Média/Pior, demais esmaecidos), escore,
  e tabela de vizinhos com **10 acima / 10 abaixo** (ajustável) e coluna **Entrou**.
  O filtro "só do meu semestre de entrada" faz a janela de X acima/abaixo contar **dentro da
  coorte do seu semestre**; sem ele, a janela é no ranking geral.

## Licença / uso

Código disponibilizado para fins de estudo. Dados e marca institucional pertencem à UDESC.
