/**
 * Importação Furtado Advogados — testes do leitor/interpretador, do
 * planejador e (com TEST_DATABASE_URL) da gravação no banco.
 *
 *   bun test tests/importacao-furtado.test.ts
 *   TEST_DATABASE_URL=postgresql://... bun test          (integração com SQL real)
 *   FURTADO_XLSX=/caminho/PLANILHA.xlsx bun test        (aceite com a planilha real)
 *
 * A planilha real NÃO é versionada (contém dados pessoais); os casos abaixo
 * reproduzem os formatos dela com dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

import { analisarBinarioFurtado } from "@/lib/furtado/analise";
import { linhasBlocos, linhasCelulas, linhasPendencias, linhasPessoas } from "@/lib/furtado/lote";
import type { AnaliseFurtado, Bloco } from "@/lib/furtado/modelo";
import {
  planejarImportacaoFurtado,
  type BaseFurtado,
  type DecisoesFurtado,
} from "@/lib/furtado/planejador";
import { datasNoTexto, extrairNome, lerNumeroBR, prazoEmDias } from "@/lib/furtado/texto";

// ---------------------------------------------------------------------------
// Planilha fictícia no formato da planilha real
// ---------------------------------------------------------------------------

type Celula = string | number | null | { f: string; v?: number | string; z?: string; t?: string };

function aba(linhas: Celula[][], extras: Partial<XLSX.WorkSheet> = {}): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = 0;
  let maxC = 0;
  linhas.forEach((linha, r) =>
    linha.forEach((v, c) => {
      if (v === null || v === undefined) return;
      const ref = XLSX.utils.encode_cell({ r, c });
      if (typeof v === "object") {
        ws[ref] = {
          t: (v.t as XLSX.ExcelDataType) ?? (typeof v.v === "string" ? "s" : "n"),
          v: v.v ?? 0,
          f: v.f,
          ...(v.z ? { z: v.z } : {}),
        };
      } else {
        ws[ref] = { t: typeof v === "number" ? "n" : "s", v };
      }
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }),
  );
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return Object.assign(ws, extras);
}

/** Serial do Excel para datas (dia exato). */
function serial(ano: number, mes: number, dia: number): number {
  return Math.round((Date.UTC(ano, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86400000);
}

function planilhaFicticia(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    aba([
      // Bloco com nome sem "CLIENTE:" e situação em coluna lateral
      [
        "MARIA TESTE SILVA - TJRS",
        "PRECATÓRIO 2027",
        "AINDA NÃO FOI EXPEDIDO",
        "CONTRATUAIS:",
        null,
        { f: "SUM(B4,B10,B25)", v: 1700 },
      ],
      ["VALOR TOTAL:", 1000],
      ["AUTOR:", 700],
      ["CONTRATUAIS (30%):", 300],
      ["SUCUMBENCIAIS (10%):", 100],
      [],
      // Bloco iniciado por ATRASADOS antes da identificação do cliente
      ["ATRASADOS: PRECATÓRIO 2028", 2000],
      ["CLIENTE: JOAO TESTE SOUZA", 1500],
      [],
      ["CONTRATUAIS (25%):", 500],
      ...Array.from({ length: 10 }, (): Celula[] => []),
      ["ATRASADOS:", 3000, "PAGO 06/2026"],
      ["CLIENTE: CARLA TESTE ROCHA", 2100],
      [],
      [],
      ["CONTRATUAIS (30%):", 900],
      ["SUCUMBENCIAIS (10%):", 300, "PAGO 07/2026"],
    ]),
    "PREVISÃO EXECUÇÃO",
  );
  XLSX.utils.book_append_sheet(
    wb,
    aba([
      ["MARIA TESTE SILVA", null, "atualizado"],
      ["ATRASADOS:", 1000, 1100],
      ["CLIENTE:", 700, 770],
      ["CONTRATUAIS (30%):", 300, 330],
      ["SUCUMBENCIAIS (10%):", "NÃO TEM"],
      ["IMPLANTAÇÃO:", 2103.72],
      ["*parcelou em 3X 701,24, cobrar com os atrasados"],
      [],
      ["ATRASADOS:", 5000, { f: "SUM(C10:C11)", v: 0 }],
      ["CLIENTE:", 3500],
      ["CONTRATUAIS (30%):", 1500],
      ["SUCUMBENCIAIS (10%):", 500, "pago"],
      ["IMPLANTAÇÃO:", 1039.57],
      ["Cliente pediu para parcelar em 4x 259,89"],
      ["PEDRO SEM ROTULO TESTE"],
      ["AUTOR: 64.1035,59"],
    ]),
    "CUMP RPV-PRECATORIO",
  );
  XLSX.utils.book_append_sheet(
    wb,
    aba(
      [
        ["CLIENTE: ANA TESTE LIMA", "x"],
        ["BENEFÍCIO: 94 - AUXÍLIO-ACIDENTE", "oculto", null, null, null, "CLIENTE: ANA TESTE LIMA"],
        ["DIB: 10/03/2022", null, null, null, null, "BENEFÍCIO: AUX. ACIDENTE"],
        ["DIP: 01/04/2024", null, null, null, null, "DIB: 10/03/2022"],
        ["PREVISÃO DE PAGAMENTO: 06/2026", null, null, null, null, "RMI: 883,39"],
        ["RMI: 883,39", null, null, null, null, "RMA: 970,50"],
        ["RMA: 970,48"],
        ["VALOR HONORÁRIOS: R$ 1.765,00", "pago em 10/12/2024"],
        ["DADOS BANCÁRIOS: BANRISUL - AGENCIA: 0601 / CONTA: 3906373505 / CONTA CORRENTE"],
      ],
      { "!cols": [{}, { hidden: true }] },
    ),
    "IMPLANTAÇÃO",
  );
  XLSX.utils.book_append_sheet(
    wb,
    aba([
      [
        "PROCESSO Nº",
        "NOME",
        "ACORDO INSS - PORCENTAGEM",
        "DIB",
        "DIP",
        "DCB",
        "SUCUMBENCIAIS",
        "BENEFÍCIO",
        "PRORROGAÇÃO",
        "DE ACORDO C/ LAUDO",
      ],
      [
        "5050880-93.2023.4.04.7100",
        "ANA TESTE LIMA",
        "SIM - 95%",
        { f: "", v: serial(2023, 12, 27), z: "mm-dd-yy", t: "n" },
        "NÃO TEM",
        "120 dias",
        { f: "", v: 0.1, z: "0%", t: "n" },
        "LOAS",
        "NÃO É CASO",
        "SIM",
        null,
        "S/REABILITAÇÃO - observação sem cabeçalho",
      ],
    ]),
    "ACORDOS",
  );
  XLSX.utils.book_append_sheet(
    wb,
    aba([["CLIENTE: JOAO TESTE SOUZA - JFRS"], ["VALOR TOTAL: R$ 2.000,00"], ["AUTOR: 1.500,00"]]),
    "PRECATÓRIO 2024 ",
  );
  XLSX.utils.book_append_sheet(
    wb,
    aba([
      ["MAURO TESTE FONSECA (SUCESSOR)", "enviou comprovante do pix", null, null, "prestação ok"],
      [
        "NARA TESTE DOS SANTOS",
        "valor total de R$ 3.960,00 - Pagamento 1.600,00 no Pix, restante parcelado 8 parcelas de 295,00",
      ],
      ["EMILY"],
    ]),
    "COBRAR CLIENTES - OK",
  );
  XLSX.utils.book_append_sheet(wb, aba([["Anotação qualquer", 123]]), "ABA NOVA");
  // Fórmulas sem valor calculado no gerador: grava resultados armazenados.
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

function analisar(dados: Uint8Array = planilhaFicticia()) {
  return analisarBinarioFurtado(dados);
}

function blocoPorNome(a: AnaliseFurtado, aba: string, nome: string): Bloco[] {
  return a.blocos.filter(
    (b) => b.aba.trim() === aba.trim() && b.nome?.nome.toUpperCase().includes(nome.toUpperCase()),
  );
}

const BASE_VAZIA: BaseFurtado = {
  clientes: [],
  variacoes: [],
  vinculosFurtado: [],
  processos: [],
  nbs: [],
};

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

describe("interpretação de texto", () => {
  test("datas parciais não ganham dia inventado e prazos não viram data", () => {
    const [d] = datasNoTexto("PAGO 06/2026");
    expect(d!.precisao).toBe("mes");
    expect(d!.iso).toBeNull();
    expect(prazoEmDias("120 dias ")).toBe(120);
  });
  test("valores em texto e malformados", () => {
    expect(lerNumeroBR("1.412,00").valor).toBe(1412);
    expect(lerNumeroBR("64.1035,59").malformado).toBe(true);
    expect(lerNumeroBR("4.774.32").malformado).toBe(true);
  });
  test("nomes: prefixos, tribunais e papéis ficam fora do nome", () => {
    expect(extrairNome("CLIENTE: ANTONIO TESTE GOULART - TJSC")!.nome).toBe(
      "ANTONIO TESTE GOULART",
    );
    expect(extrairNome("KAIO TESTE CASAGRANDE       JFPR - JEF")!.tribunais).toContain("JFPR");
    const s = extrairNome("MAURO TESTE FONSECA (SUCESSOR)")!;
    expect(s.nome).toBe("MAURO TESTE FONSECA");
    expect(s.papel).toBe("SUCESSOR");
    expect(extrairNome("ATRASADOS: PRECATÓRIO 2027")).toBeNull();
    expect(extrairNome("Indicamos ambas as contas")).toBeNull();
    expect(extrairNome("EMILY")).toBeNull();
    expect(extrairNome("EMILY", { permitirIncompleto: true })!.incompleto).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Leitura e interpretação da planilha
// ---------------------------------------------------------------------------

describe("leitura da planilha no formato real", () => {
  const { planilha, analise } = analisar();

  test("todas as abas são lidas e todas as células preenchidas têm destino rastreável", () => {
    expect(analise.abas.map((a) => a.aba)).toContain("PRECATÓRIO 2024 ");
    const total = planilha.abas.reduce((s, a) => s + a.celulas.length, 0);
    expect(analise.celulasTotal).toBe(total);
    for (const a of planilha.abas)
      for (const c of a.celulas) expect(analise.destinos.has(`${a.nome}!${c.ref}`)).toBe(true);
  });

  test("nome de aba com espaço final é reconhecido e preservado", () => {
    const precatorio = analise.abas.find((a) => a.aba === "PRECATÓRIO 2024 ")!;
    expect(precatorio.mapeamento.perfil).toBe("precatorio");
    expect(precatorio.mapeamento.conhecida).toBe(true);
  });

  test("nome sem CLIENTE: inicia bloco, com tribunal e situação da requisição", () => {
    const [b] = blocoPorNome(analise, "PREVISÃO EXECUÇÃO", "MARIA TESTE");
    expect(b!.nome!.nome).toBe("MARIA TESTE SILVA");
    expect(b!.dados.tribunais).toContain("TJRS");
    expect(b!.dados.requisicoes[0]!.tipo).toBe("precatorio");
    expect(b!.dados.requisicoes[0]!.anoPrevisto).toBe(2027);
    expect(b!.dados.requisicoes[0]!.situacao).toBe("nao_expedido");
    const cat = Object.fromEntries(b!.dados.lancamentos.map((l) => [l.categoria, l.valor]));
    expect(cat).toMatchObject({
      valor_total: 1000,
      valor_cliente: 700,
      honorarios_contratuais: 300,
      honorarios_sucumbenciais: 100,
    });
  });

  test("bloco iniciado por ATRASADOS não é associado ao nome anterior", () => {
    const [b] = blocoPorNome(analise, "PREVISÃO EXECUÇÃO", "JOAO TESTE");
    expect(b!.dados.lancamentos.find((l) => l.categoria === "atrasados")!.valor).toBe(2000);
    expect(b!.dados.lancamentos.find((l) => l.categoria === "honorarios_contratuais")!.valor).toBe(
      500,
    );
    const [maria] = blocoPorNome(analise, "PREVISÃO EXECUÇÃO", "MARIA TESTE");
    expect(maria!.dados.lancamentos.some((l) => l.valor === 2000)).toBe(false);
  });

  test("CLIENTE: com número é valor destinado ao cliente, não nome", () => {
    const [b] = blocoPorNome(analise, "CUMP RPV-PRECATORIO", "MARIA TESTE");
    expect(
      b!.dados.lancamentos.find((l) => l.categoria === "valor_cliente" && l.principal)!.valor,
    ).toBe(700);
  });

  test("“PAGO 06/2026” na linha de atrasados é situação da requisição, com data parcial", () => {
    const [b] = blocoPorNome(analise, "PREVISÃO EXECUÇÃO", "CARLA TESTE");
    expect(b!.dados.requisicoes[0]!.situacao).toBe("pago");
    expect(b!.dados.requisicoes[0]!.dataTexto).toBe("06/2026");
    // "PAGO 07/2026" nos sucumbenciais: indefinido → pendência para revisão
    expect(b!.pendencias.some((p) => p.tipo === "confirmar_recebimento")).toBe(true);
  });

  test("valores laterais viram versões informativas e não principais", () => {
    const [b] = blocoPorNome(analise, "CUMP RPV-PRECATORIO", "MARIA TESTE");
    const laterais = b!.dados.lancamentos.filter((l) => !l.principal && l.coluna === "C");
    expect(laterais.map((l) => l.valor).sort()).toEqual([1100, 330, 770].sort());
    expect(laterais.every((l) => l.natureza === "informativo")).toBe(true);
    // "NÃO TEM" é ausência declarada (diferente de zero e de vazio)
    expect(
      b!.dados.lancamentos.find((l) => l.categoria === "honorarios_sucumbenciais")!
        .ausenciaDeclarada,
    ).toBe("NAO TEM");
  });

  test("parcelamento consistente cria parcelas; divergente só registra a divergência", () => {
    const [maria] = blocoPorNome(analise, "CUMP RPV-PRECATORIO", "MARIA TESTE");
    const cob = maria!.dados.cobrancas[0]!;
    expect(cob.valorContratado).toBe(2103.72);
    expect(cob.parcelas).toHaveLength(3);
    const outro = analise.blocos.find(
      (b) =>
        b.aba === "CUMP RPV-PRECATORIO" &&
        b.dados.cobrancas.some((c) => c.quantidadeParcelas === 4),
    )!;
    expect(outro.dados.cobrancas[0]!.parcelas).toHaveLength(0);
    expect(outro.dados.cobrancas[0]!.divergencia).toContain("1039,57");
    expect(outro.pendencias.some((p) => p.tipo === "parcelamento_divergente")).toBe(true);
  });

  test("valor malformado é preservado e sinalizado", () => {
    const todas = analise.blocos.flatMap((b) => b.pendencias);
    expect(
      todas.some((p) => p.tipo === "valor_malformado" && p.descricao.includes("64.1035,59")),
    ).toBe(true);
  });

  test("bloco lateral (coluna F) e coluna oculta são lidos", () => {
    const ana = blocoPorNome(analise, "IMPLANTAÇÃO", "ANA TESTE");
    expect(ana.length).toBe(2);
    expect(ana.some((b) => b.colunaBase === 6)).toBe(true);
    const oculta = planilha.abas
      .find((a) => a.nome === "IMPLANTAÇÃO")!
      .celulas.find((c) => c.ref === "B2")!;
    expect(oculta.oculta).toBe(true);
    expect(analise.destinos.get("IMPLANTAÇÃO!B2")).toBeDefined();
  });

  test("benefício: datas, RMI/RMA, previsão parcial e pagamento citado em coluna lateral", () => {
    const [ana] = blocoPorNome(analise, "IMPLANTAÇÃO", "ANA TESTE").filter(
      (b) => b.colunaBase === 1,
    );
    const ben = ana!.dados.beneficios[0]!;
    expect(ben.especieCodigo).toBe("94");
    expect(ben.dib!.iso).toBe("2022-03-10");
    expect(ben.rmi).toBe(883.39);
    expect(ben.previsaoPagamentoTexto).toBe("06/2026");
    expect(
      ana!.dados.lancamentos.find((l) => l.categoria === "honorarios_implantacao")!.valor,
    ).toBe(1765);
    expect(ana!.dados.pagamentos[0]!.data!.iso).toBe("2024-12-10");
    expect(ana!.dados.bancarios[0]!.agencia).toBe("0601");
  });

  test("ACORDOS: aceitação separada do percentual, DCB em prazo e coluna sem cabeçalho", () => {
    const [b] = blocoPorNome(analise, "ACORDOS", "ANA TESTE");
    const a = b!.dados.acordos[0]!;
    expect(a.aceitacao).toBe("sim");
    expect(a.percentual).toBe(95);
    expect(a.dib!.iso).toBe("2023-12-27");
    expect(a.dcb).toBeNull();
    expect(a.dcbPrazoDias).toBe(120);
    expect(a.dipTexto).toBe("NÃO TEM");
    expect(a.sucumbenciaPercentual).toBe(10);
    expect(a.reabilitacao).toContain("REABILITAÇÃO");
  });

  test("totais gerais: elemento do arquivo, conferidos, nunca lançamento", () => {
    const t = analise.totais.find((x) => x.celula === "F1")!;
    expect(t.categoria).toBe("honorarios_contratuais");
    expect(analise.destinos.get("PREVISÃO EXECUÇÃO!F1")!.destino).toBe("resumo_arquivo");
    expect(t.apurado).toBe(1700); // 300 + 500 + 900
    expect(t.omitidas).toEqual([]);
    expect(
      analise.blocos
        .flatMap((b) => b.dados.lancamentos)
        .some((l) => l.celulas.includes("PREVISÃO EXECUÇÃO!F1")),
    ).toBe(false);
  });

  test("aba nova: conteúdo preservado e mapeamento pendente de confirmação", () => {
    const nova = analise.abas.find((a) => a.aba === "ABA NOVA")!;
    expect(nova.mapeamento.requerConfirmacao).toBe(true);
    expect(analise.pendenciasArquivo.some((p) => p.tipo === "nova_aba")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Planejamento: identificação, duplicidades e conflitos
// ---------------------------------------------------------------------------

describe("planejamento da importação", () => {
  const { analise } = analisar();

  test("mesmo cliente em abas diferentes vira uma pessoa; valores repetidos não duplicam", () => {
    const plano = planejarImportacaoFurtado({ analise, base: BASE_VAZIA, arquivoNome: "t.xlsx" });
    const maria = plano.pessoas.find((p) => p.nome === "MARIA TESTE SILVA")!;
    expect(maria.abas.length).toBe(2);
    // PREVISÃO e CUMP com os mesmos valores → mesmo atendimento de execução
    const exec = maria.payload.atendimentos.filter((a) => String(a["chave"]).startsWith("exec:"));
    expect(exec).toHaveLength(1);
    const contr = maria.payload.lancamentos_financeiros.filter(
      (l) => l["categoria"] === "honorarios_contratuais" && l["versao"] === 1,
    );
    expect(contr).toHaveLength(1);
    expect((contr[0]!["origens"] as string[]).length).toBeGreaterThanOrEqual(2);
  });

  test("nome idêntico a cadastro existente exige confirmação; CPF/processo é seguro", () => {
    const base: BaseFurtado = {
      ...BASE_VAZIA,
      clientes: [
        {
          id: "c1",
          nome: "Maria Teste Silva",
          nome_normalizado: "maria teste silva",
          cpf: null,
          numero_processo: null,
          escritorio_origem: "a_confirmar",
        },
        {
          id: "c2",
          nome: "ANA TESTE LIMA",
          nome_normalizado: "ana teste lima",
          cpf: null,
          numero_processo: "5050880-93.2023.4.04.7100",
          escritorio_origem: "ricardo_friedl",
        },
      ],
    };
    const plano = planejarImportacaoFurtado({ analise, base, arquivoNome: "t.xlsx" });
    const maria = plano.pessoas.find((p) => p.nome === "MARIA TESTE SILVA")!;
    expect(maria.pronta).toBe(false);
    expect(maria.correspondencia).toBe("nome_identico");
    const ana = plano.pessoas.find((p) => p.nome === "ANA TESTE LIMA")!;
    expect(ana.pronta).toBe(true);
    expect(ana.acao).toBe("vincular");
    expect(ana.correspondencia).toBe("processo");
  });

  test("homônimos nunca são unidos automaticamente", () => {
    const base: BaseFurtado = {
      ...BASE_VAZIA,
      clientes: ["x1", "x2"].map((id) => ({
        id,
        nome: "JOAO TESTE SOUZA",
        nome_normalizado: "joao teste souza",
        cpf: null,
        numero_processo: null,
      })),
    };
    const plano = planejarImportacaoFurtado({ analise, base, arquivoNome: "t.xlsx" });
    const joao = plano.pessoas.find((p) => p.nome.startsWith("JOAO TESTE"))!;
    expect(joao.pronta).toBe(false);
    expect(joao.candidatos).toHaveLength(2);
  });

  test("nome incompleto e sucessor no nome ficam para revisão", () => {
    const plano = planejarImportacaoFurtado({ analise, base: BASE_VAZIA, arquivoNome: "t.xlsx" });
    expect(plano.pessoas.find((p) => p.nome === "EMILY")!.pronta).toBe(false);
    const mauro = plano.pessoas.find((p) => p.nome === "MAURO TESTE FONSECA")!;
    expect(mauro.pronta).toBe(false);
    expect(mauro.pendencias.some((p) => p.tipo === "separacao_nome")).toBe(true);
  });

  test("totais por categoria contam valores principais uma única vez", () => {
    const plano = planejarImportacaoFurtado({ analise, base: BASE_VAZIA, arquivoNome: "t.xlsx" });
    // contratuais: MARIA 300 (PREVISÃO=CUMP), JOAO 500, CARLA 900, bloco CUMP 1500
    expect(plano.resumo.porCategoria.honorarios_contratuais).toBe(3200);
  });
});

// ---------------------------------------------------------------------------
// Integração com o banco (SQL real)
// ---------------------------------------------------------------------------

const URL_ADMIN = process.env.TEST_DATABASE_URL;
const temPsql = Bun.spawnSync(["which", "psql"]).exitCode === 0;
const ativo = !!URL_ADMIN && temPsql;
const d = ativo ? describe : describe.skip;
const NOME_DB = `teste_furtado_${Date.now()}`;
let urlTeste = "";

function psql(url: string, sql: string): string {
  const r = Bun.spawnSync(["psql", url, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", sql]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString().trim());
  return r.stdout.toString().trim();
}
function consultar<T>(sql: string): T[] {
  return JSON.parse(psql(urlTeste, `select coalesce(json_agg(t), '[]') from (${sql}) t`)) as T[];
}
function inserir(tabela: string, linhas: object[]) {
  if (!linhas.length) return;
  const arq = `/tmp/${NOME_DB}_${tabela}.json`;
  writeFileSync(arq, JSON.stringify(linhas));
  Bun.spawnSync(["chmod", "644", arq]);
  const cols = Object.keys(linhas[0]!).join(",");
  psql(
    urlTeste,
    `insert into ${tabela} (${cols}) select ${cols} from json_populate_recordset(null::${tabela}, pg_read_file('${arq}')::json) on conflict do nothing`,
  );
}
function urlComBanco(url: string, banco: string): string {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
}
function baseDoBanco(): BaseFurtado {
  return {
    clientes: consultar(
      "select id,nome,nome_normalizado,cpf,numero_processo,escritorio_origem from clientes where deleted_at is null",
    ),
    variacoes: consultar("select cliente_id,nome_normalizado from variacoes_nome"),
    vinculosFurtado: consultar<{ cliente_id: string }>(
      "select cliente_id from cliente_escritorios where escritorio='furtado'",
    ).map((x) => x.cliente_id),
    processos: consultar(
      "select cliente_id,processo_digitos from atendimentos where processo_digitos is not null and deleted_at is null",
    ),
    nbs: consultar(
      "select cliente_id,nb_digitos from beneficios where nb_digitos is not null and deleted_at is null",
    ),
    existentes: [
      "atendimentos",
      "beneficios",
      "lancamentos_financeiros",
      "requisicoes",
      "acordos",
      "cobrancas",
      "dados_bancarios",
      "representantes",
      "historico_cliente",
    ].flatMap((t) =>
      consultar<{
        tabela: string;
        id: string;
        chave_origem: string;
        campos: Record<string, unknown>;
      }>(`select '${t}' as tabela, id, chave_origem, to_jsonb(x) as campos from ${t} x`),
    ),
  };
}
function contagens() {
  return consultar<Record<string, number>>(
    `select (select count(*) from clientes)::int clientes, (select count(*) from atendimentos)::int atendimentos,
            (select count(*) from beneficios)::int beneficios, (select count(*) from lancamentos_financeiros)::int lancamentos,
            (select count(*) from requisicoes)::int requisicoes, (select count(*) from acordos)::int acordos,
            (select count(*) from cobrancas)::int cobrancas, (select count(*) from parcelas)::int parcelas,
            (select count(*) from historico_cliente)::int historico, (select count(*) from pagamentos)::int pagamentos,
            (select count(*) from cliente_escritorios)::int vinculos`,
  )[0]!;
}

/** Executa o mesmo fluxo da tela: análise → plano (com decisões) → lote → aplicação. */
function importarFurtado(
  analise: AnaliseFurtado,
  planilha: ReturnType<typeof analisar>["planilha"],
  decidir: (plano: ReturnType<typeof planejarImportacaoFurtado>) => DecisoesFurtado,
) {
  const base = baseDoBanco();
  let plano = planejarImportacaoFurtado({ analise, base, arquivoNome: "teste.xlsx" });
  plano = planejarImportacaoFurtado({
    analise,
    base,
    arquivoNome: "teste.xlsx",
    decisoes: decidir(plano),
  });
  const lote = psql(
    urlTeste,
    `insert into import_lotes (escritorio, modelo, arquivo_nome) values ('furtado','furtado_planilha_execucao_v1','teste.xlsx') returning id`,
  ).split("\n")[0]!;
  inserir("import_pessoas", linhasPessoas(lote, plano));
  inserir("import_pendencias", linhasPendencias(lote, plano));
  inserir("import_blocos", linhasBlocos(lote, analise, plano));
  inserir("import_celulas", linhasCelulas(lote, planilha, analise));
  const refs = plano.pessoas
    .filter((p) => p.pronta && (p.acao === "criar" || p.acao === "vincular"))
    .map((p) => p.ref);
  if (refs.length)
    psql(
      urlTeste,
      `select aplicar_pessoas_lote('${lote}', array[${refs.map((r) => `'${r.replace(/'/g, "''")}'`).join(",")}]::text[])`,
    );
  return { lote, plano };
}

const decidirTudo = (plano: ReturnType<typeof planejarImportacaoFurtado>): DecisoesFurtado => {
  const pessoas: NonNullable<DecisoesFurtado["pessoas"]> = {};
  for (const p of plano.pessoas) {
    if (p.pronta || p.semIdentificacao) continue;
    pessoas[p.ref] = p.clienteId ? { acao: "vincular", clienteId: p.clienteId } : { acao: "criar" };
  }
  return { pessoas };
};

d("integração com o banco", () => {
  beforeAll(() => {
    psql(URL_ADMIN!, `create database ${NOME_DB}`);
    urlTeste = urlComBanco(URL_ADMIN!, NOME_DB);
    psql(
      urlTeste,
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
         if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
         if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
       end $$;
       create extension if not exists pgcrypto;
       create publication supabase_realtime;`,
    );
    const pasta = join(import.meta.dir, "..", "supabase", "migrations");
    for (const arquivo of readdirSync(pasta)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      psql(urlTeste, readFileSync(join(pasta, arquivo), "utf8"));
    }
    // Cadastro antigo (origem não comprovada) com o mesmo nome de uma pessoa da planilha
    psql(
      urlTeste,
      `insert into clientes (nome, nome_normalizado, status) values ('Maria Teste Silva', 'maria teste silva', 'ativo')`,
    );
  });
  afterAll(() => {
    psql(URL_ADMIN!, `drop database if exists ${NOME_DB} with (force)`);
  });

  test("cadastros antigos ficam com origem a confirmar", () => {
    expect(
      consultar<{ escritorio_origem: string }>("select escritorio_origem from clientes")[0]!
        .escritorio_origem,
    ).toBe("a_confirmar");
  });

  test("Ricardo Friedl (Modelo Documento) continua funcionando e grava a origem", () => {
    const r = psql(
      urlTeste,
      `select aplicar_importacao_modelo('[{"acao":"criar","linha":2,"nome":"RICARDO TESTE CLIENTE","nome_normalizado":"ricardo teste cliente","cpf":null,"numero_processo":null,"entradas":[{"valor":100,"chave":"v10000#1","linha":2}]}]'::jsonb, 'Modelo Documento ATLAS_CLIENTES_V1 — t.xlsx', 't.xlsx', 1)`,
    );
    expect(JSON.parse(r).novos).toBe(1);
    const c = consultar<{ escritorio_origem: string; v: number }>(
      "select c.escritorio_origem, (select count(*) from cliente_escritorios e where e.cliente_id=c.id and e.escritorio='ricardo_friedl')::int v from clientes c where nome_normalizado='ricardo teste cliente'",
    )[0]!;
    expect(c.escritorio_origem).toBe("ricardo_friedl");
    expect(c.v).toBe(1);
    expect(
      consultar<{ escritorio: string }>("select escritorio from importacoes")[0]!.escritorio,
    ).toBe("ricardo_friedl");
  });

  let lote1 = "";
  test("Furtado: grava com origem Furtado, vincula sem alterar a origem anterior", () => {
    const { planilha, analise } = analisar();
    const { lote } = importarFurtado(analise, planilha, decidirTudo);
    lote1 = lote;
    const maria = consultar<{ escritorio_origem: string; vinculos: string[] }>(
      "select c.escritorio_origem, array(select escritorio from cliente_escritorios e where e.cliente_id=c.id) vinculos from clientes c where nome_normalizado='maria teste silva'",
    );
    expect(maria).toHaveLength(1); // não duplicou a pessoa existente
    expect(maria[0]!.escritorio_origem).toBe("a_confirmar");
    expect(maria[0]!.vinculos).toContain("furtado");
    const novo = consultar<{ escritorio_origem: string }>(
      "select escritorio_origem from clientes where nome_normalizado='carla teste rocha'",
    )[0]!;
    expect(novo.escritorio_origem).toBe("furtado");
    // Totais gerais e previsões não viram recebimentos
    expect(
      consultar<{ n: number }>(
        "select count(*)::int n from pagamentos where escritorio='furtado'",
      )[0]!.n,
    ).toBe(0);
    // Parcelas: só a cobrança consistente
    // 3 (implantação parcelada) + 8 (acordo de NARA: 1.600 + 8 × 295 = 3.960)
    expect(contagens().parcelas).toBe(11);
    // Rastreabilidade: células gravadas e ligadas ao cliente
    expect(
      consultar<{ n: number }>(
        `select count(*)::int n from import_celulas where lote_id='${lote}' and cliente_id is not null`,
      )[0]!.n,
    ).toBeGreaterThan(20);
  });

  test("reimportar o mesmo arquivo não duplica nada", () => {
    const antes = contagens();
    const { planilha, analise } = analisar();
    importarFurtado(analise, planilha, decidirTudo);
    const depois = contagens();
    expect({ ...depois, vinculos: antes.vinculos }).toEqual(antes);
  });

  test("recebimento confirmado quita várias parcelas com um único pagamento", () => {
    const cli = consultar<{ id: string }>(
      "select c.id from clientes c where nome_normalizado='maria teste silva'",
    )[0]!.id;
    const parcelas = consultar<{ id: string; valor: number }>(
      `select id, valor from parcelas where cliente_id='${cli}' order by numero`,
    );
    const dist = JSON.stringify(
      parcelas.slice(0, 2).map((p) => ({ parcela_id: p.id, valor: Number(p.valor) })),
    );
    psql(
      urlTeste,
      `select registrar_recebimento_importado('${cli}', 1402.48, '2025-01-10', 'implantacao', 'teste', null, null, '${dist}'::jsonb, null)`,
    );
    expect(
      consultar<{ n: number }>(
        `select count(*)::int n from pagamentos where cliente_id='${cli}'`,
      )[0]!.n,
    ).toBe(1);
    expect(
      consultar<{ situacao: string }>(
        `select situacao from parcelas where cliente_id='${cli}' order by numero`,
      ).map((p) => p.situacao),
    ).toEqual(["paga", "paga", "aberta"]);
  });

  test("desfazer o lote preserva cadastros anteriores e alterações posteriores", () => {
    // Alteração posterior por outro usuário em um registro do lote
    psql(
      urlTeste,
      `update lancamentos_financeiros set observacao = 'ajustado manualmente' where id = (select id from lancamentos_financeiros where lote_id='${lote1}' limit 1)`,
    );
    const r = JSON.parse(psql(urlTeste, `select desfazer_lote('${lote1}')`)) as {
      preservados: { motivo: string }[];
    };
    expect(r.preservados.some((p) => p.motivo.includes("alterado"))).toBe(true);
    // Cadastro antigo continua existindo e sem vínculo Furtado
    const maria = consultar<{ vinculos: string[] }>(
      "select array(select escritorio from cliente_escritorios e where e.cliente_id=c.id) vinculos from clientes c where nome_normalizado='maria teste silva'",
    );
    expect(maria).toHaveLength(1);
    // Cliente criado pelo lote mas com recebimento posterior não é apagado
    expect(
      consultar<{ n: number }>(
        "select count(*)::int n from clientes where nome_normalizado='ricardo teste cliente'",
      )[0]!.n,
    ).toBe(1);
    // Lançamento alterado depois foi preservado
    expect(
      consultar<{ n: number }>(
        "select count(*)::int n from lancamentos_financeiros where observacao='ajustado manualmente'",
      )[0]!.n,
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Aceite com a planilha real (opcional, não versionada)
// ---------------------------------------------------------------------------

const REAL = process.env.FURTADO_XLSX;
const r = REAL && existsSync(REAL) ? describe : describe.skip;
r("aceite com a planilha real", () => {
  if (!REAL || !existsSync(REAL)) return;
  const { planilha, analise } = analisarBinarioFurtado(new Uint8Array(readFileSync(REAL)));
  test("as oito abas são processadas e toda célula tem destino", () => {
    expect(analise.abas).toHaveLength(8);
    for (const a of planilha.abas)
      for (const c of a.celulas) expect(analise.destinos.has(`${a.nome}!${c.ref}`)).toBe(true);
    expect(analise.abas.every((a) => a.mapeamento.conhecida)).toBe(true);
  });
  test("bloco da coluna F em IMPLANTAÇÃO é identificado", () => {
    expect(
      analise.blocos.some((b) => b.aba === "IMPLANTAÇÃO" && b.colunaBase === 6 && b.nome),
    ).toBe(true);
  });
  test("totais gerais conferidos com divergências apontadas, sem virar lançamento", () => {
    expect(analise.totais.length).toBeGreaterThan(5);
    const totais = new Set(analise.totais.map((t) => `${t.aba}!${t.celula}`));
    expect(
      analise.blocos
        .flatMap((b) => b.dados.lancamentos)
        .some((l) => l.celulas.some((c) => totais.has(c))),
    ).toBe(false);
  });
});
