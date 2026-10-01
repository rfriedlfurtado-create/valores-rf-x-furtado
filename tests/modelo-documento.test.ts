/**
 * Modelo Documento: gerador ↔ parser (mesmo schema), agrupamento de
 * linhas por cliente, entradas financeiras e anti-reimportação.
 * Rodar: bun test
 */
import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import {
  analisarWorkbookModelo,
  chaveEntrada,
  montarPayloadImportacao,
  montarWorkbookModelo,
  planejarImportacaoModelo,
  type ClienteBaseModelo,
  type ItemPlano,
  type PagamentoBaseModelo,
} from "@/lib/modeloDocumento";

type Celula = string | number | null;

function analisar(linhas: Celula[][]) {
  const wb = montarWorkbookModelo();
  XLSX.utils.sheet_add_aoa(wb.Sheets["Clientes"]!, linhas, { origin: "A2" });
  const lido = XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), {
    type: "array",
    cellDates: true,
  });
  return analisarWorkbookModelo(lido);
}

function planejar(
  linhas: Celula[][],
  clientes: ClienteBaseModelo[] = [],
  pagamentos: PagamentoBaseModelo[] = [],
  forcarLinhas?: Set<number>,
) {
  const an = analisar(linhas);
  expect(an.errosEstrutura).toEqual([]);
  return planejarImportacaoModelo({
    linhas: an.linhas,
    clientes,
    variacoes: [],
    pagamentos,
    forcarLinhas,
  });
}

const doCliente = (plano: { itens: ItemPlano[] }, nome: RegExp) =>
  plano.itens.find((i) => nome.test(i.linha.nome))!;

const cli = (p: Partial<ClienteBaseModelo> & { id: string; nome: string }): ClienteBaseModelo => ({
  nome_normalizado: p.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
  cpf: null,
  numero_processo: null,
  status: "ativo",
  ...p,
});

describe("schema e validação", () => {
  test("o modelo gerado é reconhecido pelo importador (mesma versão)", () => {
    const wb = montarWorkbookModelo();
    const an = analisarWorkbookModelo(
      XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), { type: "array" }),
    );
    expect(an.versao).toBe("ATLAS_CLIENTES_V1");
    expect(an.errosEstrutura).toEqual(["O arquivo não possui nenhum cliente preenchido."]);
  });

  test("normalização e erros de linha", () => {
    const an = analisar([
      ["  joão  da SILVA ", "000.000.000-00", "", "NÃO PAGO", ""],
      ["Maria", "", "", "PAGO", "1.500,00"],
      [],
      ["", "", "", "PAGO", ""],
      ["Beltrano", "123", "", "TALVEZ", "abc"],
      ["Pedro", 1234567890, "", "nao pago", 250.5],
    ]);
    const L = (n: number) => an.linhas.find((l) => l.numeroLinha === n)!;
    expect(an.linhas.length).toBe(5);
    expect(L(2).nome).toBe("joão da SILVA");
    expect(L(3).valor).toBe(1500);
    expect(L(5).erros.length).toBe(1);
    expect(L(6).erros.length).toBe(3);
    expect(L(7).cpfNormalizado).toBe("01234567890");
    expect(L(7).situacao).toBe("NAO_PAGO");
  });

  test("arquivo fora do modelo é bloqueado", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Nome", "Status"],
        ["x", "PAGO"],
      ]),
      "A",
    );
    const an = analisarWorkbookModelo(wb);
    expect(an.errosEstrutura.length).toBeGreaterThan(0);
    expect(an.linhas).toEqual([]);
  });
});

describe("1 cliente = 1 perfil, N entradas", () => {
  test("três linhas do mesmo cliente viram um único cliente com três entradas", () => {
    const plano = planejar([
      ["João da Silva", "", "", "NÃO PAGO", "1.000,00"],
      ["JOÃO  DA SILVA", "", "", "NÃO PAGO", "3.500,00"],
      ["joao da silva", "", "", "NÃO PAGO", "800,00"],
    ]);
    expect(plano.itens.length).toBe(1);
    const item = plano.itens[0]!;
    expect(item.acao).toBe("criar");
    expect(item.linhas.map((l) => l.numeroLinha)).toEqual([2, 3, 4]);
    expect(item.entradas.map((e) => [e.valor, e.chave, e.status])).toEqual([
      [1000, "v100000#1", "nova"],
      [3500, "v350000#1", "nova"],
      [800, "v80000#1", "nova"],
    ]);
    expect(plano.resumo.novos).toBe(1);
    expect(plano.resumo.linhasAgrupadas).toBe(2);
    expect(plano.resumo.entradasNovas).toBe(3);
    // payload: 1 cliente, 3 entradas (nunca somadas)
    const payload = montarPayloadImportacao(plano);
    expect(payload.length).toBe(1);
    expect(payload[0]!.entradas.map((e) => e.valor)).toEqual([1000, 3500, 800]);
  });

  test("valores iguais legítimos no mesmo arquivo são entradas distintas", () => {
    const plano = planejar([
      ["Ana", "", "", "NÃO PAGO", "1000"],
      ["Ana", "", "", "NÃO PAGO", "1000"],
    ]);
    expect(plano.itens[0]!.entradas.map((e) => e.chave)).toEqual(["v100000#1", "v100000#2"]);
  });

  test("linha sem valor não inventa entrada", () => {
    const plano = planejar([
      ["Bia", "", "", "NÃO PAGO", ""],
      ["Bia", "", "", "NÃO PAGO", "200"],
    ]);
    expect(plano.itens[0]!.entradas.length).toBe(1);
  });

  test("mesmo CPF com grafias diferentes = mesmo cliente", () => {
    const plano = planejar([
      ["José Pereira", "111.111.111-11", "", "NÃO PAGO", "10"],
      ["Jose P. Pereira", "11111111111", "", "NÃO PAGO", "20"],
    ]);
    expect(plano.itens.length).toBe(1);
    expect(plano.itens[0]!.aviso).toMatch(/grafias diferentes/);
  });

  test("linha sem CPF junta-se ao único CPF do mesmo nome no arquivo", () => {
    const plano = planejar([
      ["Carla Dias", "222.222.222-22", "", "NÃO PAGO", "10"],
      ["Carla Dias", "", "", "NÃO PAGO", "20"],
    ]);
    expect(plano.itens.length).toBe(1);
    expect(plano.itens[0]!.entradas.length).toBe(2);
  });

  test("situações divergentes no arquivo: o cliente é considerado PAGO", () => {
    const plano = planejar(
      [
        ["Rui", "", "", "NÃO PAGO", "10"],
        ["Rui", "", "", "PAGO", "20"],
      ],
      [cli({ id: "r", nome: "Rui" })],
    );
    const item = plano.itens[0]!;
    expect(item.situacao).toBe("PAGO");
    expect(item.acao).toBe("marcar_pago");
    expect(item.alteracoes.status).toBe("pago");
    expect(item.entradas.length).toBe(2);
  });
});

describe("sem identificação segura → revisão, nada gravado, nada perdido", () => {
  test("nome com 2 CPFs no arquivo + linha sem CPF: só a linha sem CPF vai para revisão", () => {
    const plano = planejar([
      ["Paulo Lima", "333.333.333-33", "", "NÃO PAGO", "10"],
      ["Paulo Lima", "444.444.444-44", "", "NÃO PAGO", "20"],
      ["Paulo Lima", "", "", "NÃO PAGO", "30"],
    ]);
    const criados = plano.itens.filter((i) => i.acao === "criar");
    expect(criados.length).toBe(2); // CPFs diferentes = pessoas diferentes
    const revisao = plano.itens.find((i) => i.acao === "erro")!;
    expect(revisao.linha.numeroLinha).toBe(4);
    expect(revisao.motivo).toMatch(/Identificação insegura/);
    expect(
      montarPayloadImportacao(plano)
        .flatMap((p) => p.entradas)
        .map((e) => e.valor),
    ).toEqual([10, 20]);
  });

  test("homônimos na base sem CPF: grupo inteiro vai para revisão com todos os valores visíveis", () => {
    const plano = planejar(
      [
        ["Ana Souza", "", "", "NÃO PAGO", "10"],
        ["Ana Souza", "", "", "NÃO PAGO", "20"],
      ],
      [cli({ id: "a1", nome: "Ana Souza" }), cli({ id: "a2", nome: "Ana Souza" })],
    );
    expect(plano.itens.length).toBe(1);
    expect(plano.itens[0]!.acao).toBe("erro");
    expect(plano.itens[0]!.motivo).toMatch(/Sem identificação segura/);
    expect(plano.itens[0]!.entradas.map((e) => e.valor)).toEqual([10, 20]);
    expect(montarPayloadImportacao(plano)).toEqual([]);
  });

  test("PAGO não encontrado: não cria cliente, sugere parecido sem associar", () => {
    const plano = planejar(
      [["Fulano Desconhecido", "", "", "PAGO", "100"]],
      [cli({ id: "f", nome: "Fulano Desconhecid" })],
    );
    expect(plano.itens[0]!.acao).toBe("nao_encontrado");
    expect(plano.itens[0]!.aviso).toMatch(/Nome parecido/);
    expect(montarPayloadImportacao(plano)).toEqual([]);
  });
});

describe("cliente existente e reimportação", () => {
  const base = [cli({ id: "j", nome: "João da Silva", status: "ativo" })];

  test("cliente existente não é recriado; novas entradas entram no mesmo perfil", () => {
    const plano = planejar([["João da Silva", "", "", "NÃO PAGO", "800"]], base, [
      { cliente_id: "j", valor: 1000, chave_importacao: chaveEntrada(1000, 1) },
      { cliente_id: "j", valor: 3500, chave_importacao: chaveEntrada(3500, 1) },
    ]);
    const item = plano.itens[0]!;
    expect(item.acao).toBe("atualizar");
    expect(item.clienteId).toBe("j");
    expect(item.entradas.map((e) => e.status)).toEqual(["nova"]);
  });

  test("reimportar o mesmo arquivo não duplica entradas", () => {
    const arquivo: Celula[][] = [
      ["João da Silva", "", "", "PAGO", "1000"],
      ["João da Silva", "", "", "PAGO", "3500"],
      ["João da Silva", "", "", "PAGO", "800"],
    ];
    const jaPago = [cli({ id: "j", nome: "João da Silva", status: "pago" })];
    const existentes = [1000, 3500, 800].map((v) => ({
      cliente_id: "j",
      valor: v,
      chave_importacao: chaveEntrada(v, 1),
    }));
    const plano = planejar(arquivo, jaPago, existentes);
    expect(plano.itens[0]!.acao).toBe("sem_alteracao");
    expect(plano.resumo.entradasNovas).toBe(0);
    expect(plano.resumo.entradasJaRegistradas).toBe(3);
    expect(montarPayloadImportacao(plano)).toEqual([]);
  });

  test("valor igual a um já registrado pode ser confirmado como entrada nova", () => {
    const existentes = [{ cliente_id: "j", valor: 1000, chave_importacao: chaveEntrada(1000, 1) }];
    const arquivo: Celula[][] = [["João da Silva", "", "", "NÃO PAGO", "1000"]];
    const normal = planejar(arquivo, base, existentes);
    expect(normal.itens[0]!.entradas[0]!.status).toBe("ja_registrada");
    const forcado = planejar(arquivo, base, existentes, new Set([2]));
    expect(forcado.itens[0]!.entradas[0]!.status).toBe("forcada");
    expect(forcado.itens[0]!.entradas[0]!.chave).toBe("v100000#2");
    expect(forcado.itens[0]!.acao).toBe("atualizar");
  });

  test("NÃO PAGO → PAGO usa o mesmo perfil (sem criar outro)", () => {
    const plano = planejar([["João da Silva", "", "", "PAGO", ""]], base);
    expect(plano.itens[0]!.acao).toBe("marcar_pago");
    expect(plano.itens[0]!.clienteId).toBe("j");
    expect(montarPayloadImportacao(plano)[0]!.acao).toBe("marcar_pago");
  });

  test("cliente já pago aparecendo como NÃO PAGO não volta para tramitação", () => {
    const plano = planejar(
      [["João da Silva", "", "", "NÃO PAGO", ""]],
      [cli({ id: "j", nome: "João da Silva", status: "pago" })],
    );
    expect(plano.itens[0]!.acao).toBe("sem_alteracao");
    expect(plano.itens[0]!.aviso).toMatch(/mantido como pago/);
  });

  test("dois grupos que caem no mesmo cliente da base são unidos", () => {
    const plano = planejar(
      [
        ["João Silva", "555.555.555-55", "", "PAGO", "10"],
        ["João da Silva", "", "", "PAGO", "20"],
      ],
      [cli({ id: "j", nome: "João da Silva", cpf: "555.555.555-55", status: "ativo" })],
    );
    const gravaveis = plano.itens.filter((i) => i.acao !== "erro");
    expect(gravaveis.length).toBe(1);
    expect(gravaveis[0]!.entradas.length).toBe(2);
    expect(doCliente(plano, /Jo/).clienteId).toBe("j");
  });
});

test("valor de linha em revisão continua visível no plano (não é gravado)", () => {
  const plano = planejar([
    ["Paulo Lima", "333.333.333-33", "", "NÃO PAGO", "10"],
    ["Paulo Lima", "444.444.444-44", "", "NÃO PAGO", "20"],
    ["Paulo Lima", "", "", "NÃO PAGO", "30"],
  ]);
  const revisao = plano.itens.find((i) => i.acao === "erro")!;
  expect(revisao.entradas.map((e) => e.valor)).toEqual([30]);
  expect(plano.resumo.entradasNovas).toBe(2);
});
