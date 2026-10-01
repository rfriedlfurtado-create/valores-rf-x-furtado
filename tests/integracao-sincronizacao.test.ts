/**
 * Testes de INTEGRAÇÃO da sincronização global.
 *
 * Usa um PostgreSQL real com todas as migrations do projeto e o pipeline
 * real do frontend:
 *
 *   planilha (Modelo Documento) → analisarWorkbookModelo → planejarImportacaoModelo
 *   → montarPayloadImportacao → aplicar_importacao_modelo (SQL, transação)
 *   → linhas do banco → agregarBase → visões CLIENTES / JÁ PAGOS / Dashboard
 *
 * Rodar:
 *   TEST_DATABASE_URL="postgresql://postgres@localhost:5432/postgres" bun test
 * Sem TEST_DATABASE_URL (ou sem `psql`), os testes são ignorados.
 * Um banco temporário é criado e removido a cada execução.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

import { agregarBase, type BaseAgregada } from "@/lib/agregacao";
import {
  analisarWorkbookModelo,
  montarPayloadImportacao,
  montarWorkbookModelo,
  planejarImportacaoModelo,
} from "@/lib/modeloDocumento";
import { SITUACAO_POR_STATUS } from "@/lib/situacao";
import type { Cliente, Pagamento } from "@/lib/tipos";

const URL_ADMIN = process.env.TEST_DATABASE_URL;
const temPsql = Bun.spawnSync(["which", "psql"]).exitCode === 0;
const ativo = !!URL_ADMIN && temPsql;
const d = ativo ? describe : describe.skip;

const NOME_DB = `teste_sinc_${Date.now()}`;
let urlTeste = "";

function psql(url: string, sql: string): string {
  const r = Bun.spawnSync(["psql", url, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", sql]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString().trim());
  return r.stdout.toString().trim();
}
function consultar<T>(sql: string): T[] {
  const saida = psql(urlTeste, `select coalesce(json_agg(t), '[]') from (${sql}) t`);
  return JSON.parse(saida) as T[];
}
function urlComBanco(url: string, banco: string): string {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
}

beforeAll(() => {
  if (!ativo) return;
  psql(URL_ADMIN!, `create database ${NOME_DB}`);
  urlTeste = urlComBanco(URL_ADMIN!, NOME_DB);
  // Papéis e publicação que o Supabase fornece.
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
});

afterAll(() => {
  if (!ativo) return;
  psql(URL_ADMIN!, `drop database if exists ${NOME_DB} with (force)`);
});

/** Mesmo carregamento de dados.ts (clientes não excluídos + pagamentos). */
function carregarBase(): BaseAgregada {
  const clientes = consultar<Cliente>(
    "select * from clientes where deleted_at is null order by nome",
  );
  const pagamentos = consultar<Pagamento>("select * from pagamentos order by data_pagamento desc");
  return agregarBase(clientes, pagamentos);
}

function planilha(linhas: (string | number | null)[][]): XLSX.WorkBook {
  const wb = montarWorkbookModelo();
  XLSX.utils.sheet_add_aoa(wb.Sheets["Clientes"]!, linhas, { origin: "A2" });
  // ida e volta pelo formato binário, como no navegador
  return XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), {
    type: "array",
    cellDates: true,
  });
}

/** Executa a importação exatamente como a tela faz. */
function importar(linhas: (string | number | null)[][]) {
  const analise = analisarWorkbookModelo(planilha(linhas));
  expect(analise.errosEstrutura).toEqual([]);
  const base = carregarBase();
  const plano = planejarImportacaoModelo({
    linhas: analise.linhas,
    clientes: base.clientes,
    variacoes: consultar<{ cliente_id: string; nome_normalizado: string }>(
      "select cliente_id, nome_normalizado from variacoes_nome",
    ),
    pagamentos: [...base.pagamentosPorCliente.values()].flat(),
  });
  const payload = JSON.stringify(montarPayloadImportacao(plano));
  const retorno = psql(
    urlTeste,
    `select aplicar_importacao_modelo($payload$${payload}$payload$::jsonb, 'teste', 'teste.xlsx', ${plano.resumo.total})`,
  );
  return { plano, retorno: JSON.parse(retorno) as Record<string, number> };
}

function nomes(lista: { nome: string }[]) {
  return lista.map((c) => c.nome).sort();
}

/** Invariantes que TODA visão precisa respeitar ao mesmo tempo. */
function verificarConsistencia(base: BaseAgregada) {
  const banco = consultar<{ status: string; n: number }>(
    "select status, count(*)::int as n from clientes where deleted_at is null group by status",
  );
  const noBanco = (s: string) => banco.find((b) => b.status === s)?.n ?? 0;
  expect(base.indicadores.jaPagos).toBe(noBanco("pago"));
  expect(base.indicadores.emTramitacao).toBe(noBanco("ativo") + noBanco("inativo"));
  expect(base.emTramitacao.length).toBe(base.indicadores.emTramitacao);
  expect(base.jaPagos.length).toBe(base.indicadores.jaPagos);
  const ids = new Set(base.emTramitacao.map((c) => c.id));
  expect(base.jaPagos.some((c) => ids.has(c.id))).toBe(false);
  const [{ soma }] = consultar<{ soma: number }>(
    `select coalesce(sum(p.valor),0)::float as soma from pagamentos p
       join clientes c on c.id = p.cliente_id where c.deleted_at is null`,
  );
  expect(base.indicadores.valorRecebido).toBeCloseTo(soma!, 2);
}

d("sincronização global (banco real)", () => {
  test("status do frontend = constraint clientes_status_check do banco", () => {
    const [{ def }] = consultar<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'clientes_status_check'",
    );
    const doBanco = [...def!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(doBanco).toEqual(Object.keys(SITUACAO_POR_STATUS).sort());
  });

  test("Cenário 1 — novo cliente aparece em Clientes e o Dashboard aumenta", () => {
    const antes = carregarBase().indicadores;
    const { retorno } = importar([
      ["Ana Lima", "111.111.111-11", "0001", "NÃO PAGO", ""],
      ["Bruno Costa", "", "0002", "NÃO PAGO", ""],
    ]);
    expect(retorno.novos).toBe(2);
    const base = carregarBase();
    expect(nomes(base.emTramitacao)).toEqual(["Ana Lima", "Bruno Costa"]);
    expect(base.indicadores.emTramitacao).toBe(antes.emTramitacao + 2);
    expect(base.indicadores.totalClientes).toBe(antes.totalClientes + 2);
    expect(base.porId.get(base.emTramitacao[0]!.id)!.numero_processo).toBe("0001");
    verificarConsistencia(base);
  });

  test("Cenário 2 — cliente pago sai de Clientes, entra em Já Pagos, indicadores e valores atualizam", () => {
    const antes = carregarBase().indicadores;
    const { retorno } = importar([["ANA LIMA", "", "", "PAGO", "1.500,00"]]);
    expect(retorno.movidos).toBe(1);
    expect(retorno.valores).toBe(1);
    const base = carregarBase();
    expect(nomes(base.emTramitacao)).toEqual(["Bruno Costa"]);
    expect(nomes(base.jaPagos)).toEqual(["Ana Lima"]);
    expect(base.indicadores.emTramitacao).toBe(antes.emTramitacao - 1);
    expect(base.indicadores.jaPagos).toBe(antes.jaPagos + 1);
    expect(base.indicadores.valorRecebido).toBe(antes.valorRecebido + 1500);
    expect(base.indicadores.percentualPagos).toBeCloseTo(50, 5);
    // não duplicou o cliente
    expect(consultar("select 1 from clientes where nome_normalizado = 'ana lima'").length).toBe(1);
    verificarConsistencia(base);
  });

  test("Cenário 3 — pago sem Valor R$ continua pago e nenhum valor é inventado", () => {
    const antes = carregarBase().indicadores;
    importar([["Bruno Costa", "", "", "PAGO", ""]]);
    const base = carregarBase();
    expect(nomes(base.jaPagos)).toEqual(["Ana Lima", "Bruno Costa"]);
    expect(base.indicadores.jaPagos).toBe(antes.jaPagos + 1);
    expect(base.indicadores.valorRecebido).toBe(antes.valorRecebido);
    expect(base.indicadores.pagosSemValor).toBe(antes.pagosSemValor + 1);
    verificarConsistencia(base);
  });

  test("Idempotência — reimportar o mesmo arquivo não cria nem duplica nada", () => {
    const antes = consultar<{ c: number; p: number }>(
      "select (select count(*) from clientes)::int c, (select count(*) from pagamentos)::int p",
    )[0]!;
    importar([
      ["Ana Lima", "111.111.111-11", "0001", "PAGO", "1500"],
      ["Bruno Costa", "", "0002", "PAGO", ""],
    ]);
    const depois = consultar<{ c: number; p: number }>(
      "select (select count(*) from clientes)::int c, (select count(*) from pagamentos)::int p",
    )[0]!;
    expect(depois).toEqual(antes);
  });

  test("Cenário 4 — exclusão remove o cliente de todas as visões e métricas", () => {
    const ana = carregarBase().jaPagos.find((c) => c.nome === "Ana Lima")!;
    const antes = carregarBase().indicadores;
    psql(urlTeste, `select excluir_cliente('${ana.id}')`);
    const base = carregarBase();
    expect(base.porId.has(ana.id)).toBe(false);
    expect(nomes(base.jaPagos)).toEqual(["Bruno Costa"]);
    expect(base.indicadores.jaPagos).toBe(antes.jaPagos - 1);
    expect(base.indicadores.totalClientes).toBe(antes.totalClientes - 1);
    expect(base.indicadores.valorRecebido).toBe(antes.valorRecebido - 1500);
    // sem órfãos
    expect(consultar(`select 1 from pagamentos where cliente_id = '${ana.id}'`).length).toBe(0);
    verificarConsistencia(base);
  });

  test("Cenário 5 — importação múltipla com status mistos mantém tudo consistente", () => {
    const { plano, retorno } = importar([
      ["Carlos Dias", "222.222.222-22", "", "NÃO PAGO", ""],
      ["Daniela Reis", "", "", "NÃO PAGO", ""],
      ["Eduardo Melo", "", "", "PAGO", "300"], // não existe → revisão, nada gravado
      ["Bruno Costa", "", "", "NÃO PAGO", ""], // já pago: não volta para tramitação
      ["", "", "", "PAGO", ""], // erro de linha
    ]);
    expect(retorno.novos).toBe(2);
    expect(plano.resumo.pagosNaoEncontrados).toBe(1);
    expect(plano.resumo.erros).toBe(1);
    const base = carregarBase();
    expect(nomes(base.emTramitacao)).toEqual(["Carlos Dias", "Daniela Reis"]);
    expect(nomes(base.jaPagos)).toEqual(["Bruno Costa"]);
    expect(base.porId.size).toBe(3);
    verificarConsistencia(base);

    // Carlos passa a pago, na mesma planilha em que Daniela continua em tramitação.
    importar([
      ["Carlos Dias", "222.222.222-22", "", "PAGO", "250,50"],
      ["Daniela Reis", "", "", "NÃO PAGO", ""],
    ]);
    const final = carregarBase();
    expect(nomes(final.emTramitacao)).toEqual(["Daniela Reis"]);
    expect(nomes(final.jaPagos)).toEqual(["Bruno Costa", "Carlos Dias"]);
    expect(final.indicadores.valorRecebido).toBe(250.5);
    verificarConsistencia(final);
  });

  test("Atomicidade — falha em uma linha desfaz a importação inteira", () => {
    const antes = consultar<{ c: number; p: number; s: string }>(
      `select (select count(*) from clientes)::int c, (select count(*) from pagamentos)::int p,
              (select string_agg(status, ',' order by nome) from clientes) s`,
    )[0]!;
    const daniela = carregarBase().emTramitacao.find((c) => c.nome === "Daniela Reis")!;
    const payload = JSON.stringify([
      {
        acao: "marcar_pago",
        linha: 2,
        cliente_id: daniela.id,
        alteracoes: { status: "pago" },
        valor: 100,
      },
      {
        acao: "criar",
        linha: 3,
        nome: "Fulano Novo",
        nome_normalizado: "fulano novo",
        cpf: null,
        numero_processo: null,
      },
      // cliente inexistente → exceção → ROLLBACK de tudo
      {
        acao: "marcar_pago",
        linha: 4,
        cliente_id: "00000000-0000-0000-0000-000000000000",
        alteracoes: { status: "pago" },
        valor: null,
      },
    ]);
    expect(() =>
      psql(urlTeste, `select aplicar_importacao_modelo($p$${payload}$p$::jsonb, 't', 't.xlsx', 3)`),
    ).toThrow(/não existe mais/);
    const depois = consultar<{ c: number; p: number; s: string }>(
      `select (select count(*) from clientes)::int c, (select count(*) from pagamentos)::int p,
              (select string_agg(status, ',' order by nome) from clientes) s`,
    )[0]!;
    expect(depois).toEqual(antes);
  });

  test("Duplicidade — o banco recusa criar cliente que já existe (base mudou após a análise)", () => {
    const payload = JSON.stringify([
      {
        acao: "criar",
        linha: 2,
        nome: "Daniela Reis",
        nome_normalizado: "daniela reis",
        cpf: null,
        numero_processo: null,
      },
    ]);
    expect(() =>
      psql(urlTeste, `select aplicar_importacao_modelo($p$${payload}$p$::jsonb, 't', 't.xlsx', 1)`),
    ).toThrow(/já existe/);
  });

  test("Realtime — tabelas de domínio publicadas", () => {
    const tabelas = consultar<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime'",
    ).map((t) => t.tablename);
    for (const t of ["clientes", "pagamentos", "importacoes", "correspondencias"]) {
      expect(tabelas).toContain(t);
    }
  });

  test("Zerar sistema — remove tudo de uma vez e zera os indicadores", () => {
    psql(urlTeste, "select zerar_sistema()");
    const base = carregarBase();
    expect(base.indicadores.totalClientes).toBe(0);
    expect(base.indicadores.valorRecebido).toBe(0);
    expect(consultar("select 1 from configuracoes").length).toBeGreaterThan(0);
  });
});

d("entradas financeiras por cliente (banco real)", () => {
  const contar = () =>
    consultar<{ c: number; p: number }>(
      "select (select count(*) from clientes)::int c, (select count(*) from pagamentos)::int p",
    )[0]!;
  const entradasDe = (nome: string) =>
    consultar<{
      id: string;
      valor: number;
      classificacao: string | null;
      chave_importacao: string;
    }>(
      `select p.id, p.valor::float as valor, p.classificacao, p.chave_importacao from pagamentos p
         join clientes c on c.id = p.cliente_id
        where c.nome_normalizado = '${nome}' order by p.linha_importacao`,
    );

  test("3 linhas do mesmo cliente → 1 perfil com 3 entradas separadas", () => {
    psql(urlTeste, "select zerar_sistema()");
    const { retorno } = importar([
      ["João da Silva", "", "", "NÃO PAGO", "1.000,00"],
      ["JOÃO DA SILVA", "", "", "NÃO PAGO", "3.500,00"],
      ["joao da silva", "", "", "NÃO PAGO", "800,00"],
    ]);
    expect(retorno.novos).toBe(1);
    expect(retorno.valores).toBe(3);
    expect(contar()).toEqual({ c: 1, p: 3 });
    expect(entradasDe("joao da silva").map((e) => e.valor)).toEqual([1000, 3500, 800]);
    const base = carregarBase();
    expect(base.emTramitacao.length).toBe(1);
    expect(base.emTramitacao[0]!.quantidadePagamentos).toBe(3);
    expect(base.indicadores.valorRecebido).toBe(5300);
    verificarConsistencia(base);
  });

  test("reimportar o mesmo arquivo não duplica (nem no banco, mesmo forçando o payload)", () => {
    const antes = contar();
    importar([
      ["João da Silva", "", "", "NÃO PAGO", "1.000,00"],
      ["JOÃO DA SILVA", "", "", "NÃO PAGO", "3.500,00"],
      ["joao da silva", "", "", "NÃO PAGO", "800,00"],
    ]);
    expect(contar()).toEqual(antes);
    // Defesa no banco: mesmo que um payload repita a chave, a entrada não duplica.
    const [{ id }] = consultar<{ id: string }>(
      "select id from clientes where nome_normalizado = 'joao da silva'",
    );
    const payload = JSON.stringify([
      {
        acao: "atualizar",
        linha: 2,
        linhas: [2],
        cliente_id: id,
        alteracoes: {},
        entradas: [{ valor: 1000, chave: "v100000#1", linha: 2 }],
      },
    ]);
    const r = JSON.parse(
      psql(urlTeste, `select aplicar_importacao_modelo($p$${payload}$p$::jsonb, 't', 't.xlsx', 1)`),
    );
    expect(r.valores).toBe(0);
    expect(r.valores_ignorados).toBe(1);
    expect(contar()).toEqual(antes);
  });

  test("classificar cada entrada atualiza os totais por classificação sem duplicar valor", () => {
    const [e1, e2, e3] = entradasDe("joao da silva");
    psql(
      urlTeste,
      `update pagamentos set classificacao = 'contratuais' where id = '${e1!.id}';
       update pagamentos set classificacao = 'atrasados'   where id = '${e2!.id}';
       update pagamentos set classificacao = 'sucumbencia' where id = '${e3!.id}';`,
    );
    let ind = carregarBase().indicadores.entradas;
    expect(ind.porClassificacao.contratuais.valor).toBe(1000);
    expect(ind.porClassificacao.atrasados.valor).toBe(3500);
    expect(ind.porClassificacao.sucumbencia.valor).toBe(800);
    expect(ind.total).toBe(5300);

    // Alterar a classificação move o valor de grupo; o total não muda.
    psql(urlTeste, `update pagamentos set classificacao = 'atrasados' where id = '${e1!.id}'`);
    ind = carregarBase().indicadores.entradas;
    expect(ind.porClassificacao.contratuais.valor).toBe(0);
    expect(ind.porClassificacao.atrasados.valor).toBe(4500);
    expect(ind.total).toBe(5300);
    expect(contar().p).toBe(3);
  });

  test("classificação inválida é recusada pelo banco", () => {
    const [e1] = entradasDe("joao da silva");
    expect(() =>
      psql(urlTeste, `update pagamentos set classificacao = 'outra' where id = '${e1!.id}'`),
    ).toThrow(/pagamentos_classificacao_check/);
  });

  test("cliente existente + 1 valor novo → mesmo perfil, classificações preservadas", () => {
    const idAntes = consultar<{ id: string }>(
      "select id from clientes where nome_normalizado = 'joao da silva'",
    )[0]!.id;
    // arquivo cumulativo: 3 valores antigos + 1 novo
    const { retorno } = importar([
      ["João da Silva", "", "", "NÃO PAGO", "1000"],
      ["João da Silva", "", "", "NÃO PAGO", "3500"],
      ["João da Silva", "", "", "NÃO PAGO", "800"],
      ["João da Silva", "", "", "NÃO PAGO", "250"],
    ]);
    expect(retorno.novos).toBe(0);
    expect(retorno.valores).toBe(1);
    const entradas = entradasDe("joao da silva");
    expect(entradas.length).toBe(4);
    expect(entradas.filter((e) => e.classificacao).length).toBe(3); // nada apagado
    expect(consultar("select 1 from clientes").length).toBe(1);
    expect(
      consultar<{ id: string }>(
        "select id from clientes where nome_normalizado = 'joao da silva'",
      )[0]!.id,
    ).toBe(idAntes);
  });

  test("NÃO PAGO → PAGO: mesma pasta, mesmas entradas, vai para Já Pagos", () => {
    const id = consultar<{ id: string }>(
      "select id from clientes where nome_normalizado = 'joao da silva'",
    )[0]!.id;
    importar([["João da Silva", "", "", "PAGO", ""]]);
    const base = carregarBase();
    expect(base.jaPagos.map((c) => c.id)).toEqual([id]);
    expect(base.emTramitacao.length).toBe(0);
    expect(base.porId.get(id)!.quantidadePagamentos).toBe(4);
    expect(base.indicadores.entradas.total).toBe(5550);
    expect(consultar("select 1 from clientes").length).toBe(1);
    verificarConsistencia(base);
  });

  test("identificação insegura não grava nada daquele cliente e não perde os demais", () => {
    const antes = contar();
    const { plano, retorno } = importar([
      ["Paulo Lima", "333.333.333-33", "", "NÃO PAGO", "10"],
      ["Paulo Lima", "444.444.444-44", "", "NÃO PAGO", "20"],
      ["Paulo Lima", "", "", "NÃO PAGO", "30"],
    ]);
    expect(retorno.novos).toBe(2);
    expect(retorno.valores).toBe(2);
    expect(plano.resumo.erros).toBe(1);
    expect(contar()).toEqual({ c: antes.c + 2, p: antes.p + 2 });
  });
});
