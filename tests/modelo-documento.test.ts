/**
 * Testes do Modelo Documento: gerador ↔ parser (mesmo schema) e planejador.
 * Rodar: bun test
 */
import { expect, test } from "bun:test";
import * as XLSX from "xlsx";

import {
  analisarWorkbookModelo,
  MARCA_PAGAMENTO_MODELO,
  montarWorkbookModelo,
  planejarImportacaoModelo,
  type ClienteBaseModelo,
} from "@/lib/modeloDocumento";

function assert(condicao: unknown, mensagem: string) {
  if (!condicao) throw new Error(`Falhou: ${mensagem}`);
}

test("gerador, parser e planejador do Modelo Documento", () => {
  const wb = montarWorkbookModelo();
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const vazio = analisarWorkbookModelo(XLSX.read(buf, { type: "array", cellDates: true }));
  expect(Boolean(vazio.versao === "ATLAS_CLIENTES_V1")).toBe(true); // "versão lida do arquivo gerado"
  expect(
    Boolean(vazio.errosEstrutura.length === 1 && /nenhum cliente/.test(vazio.errosEstrutura[0]!)),
  ).toBe(true); // "modelo vazio: só erro 'nenhum cliente'"

  const ws = wb.Sheets["Clientes"]!;
  XLSX.utils.sheet_add_aoa(
    ws,
    [
      ["  joão  da SILVA ", "000.000.000-00", "0000000-00.0000.0.00.0000", "NÃO PAGO", ""],
      ["Maria Souza", "111.111.111-11", "", "PAGO", "1.500,00"],
      ["Carlos Oliveira", "", "123", "nao pago", ""],
      ["Ana Pereira", null, "", "PAGO", null],
      [],
      ["Fulano Desconhecido", "", "", "PAGO", ""],
      ["", "", "", "PAGO", ""],
      ["Beltrano", "123", "", "TALVEZ", "abc"],
      ["Carlos Oliveira", "", "", "PAGO", ""],
      ["Pedro Numerico", 1234567890, "", "NÃO PAGO", 250.5],
    ],
    { origin: "A2" },
  );
  const buf2 = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const an = analisarWorkbookModelo(XLSX.read(buf2, { type: "array", cellDates: true }));
  expect(Boolean(an.errosEstrutura.length === 0)).toBe(true); // "estrutura válida"
  expect(Boolean(an.linhas.length === 9)).toBe(true); // "9 linhas (vazia ignorada)"
  const L = (n: number) => an.linhas.find((l) => l.numeroLinha === n)!;
  expect(Boolean(L(2).nome === "joão da SILVA" && L(2).situacao === "NAO_PAGO")).toBe(true); // "trim + situação NÃO PAGO"
  expect(Boolean(L(3).valor === 1500)).toBe(true); // "valor BRL 1.500,00"
  expect(Boolean(L(8).erros.length === 1)).toBe(true); // "linha sem nome -> erro"
  assert(
    L(9).erros.length === 3,
    "CPF, situação e valor inválidos -> 3 erros: " + L(9).erros.join("|"),
  );
  expect(Boolean(L(10).erros.some((e) => /duplicado/.test(e)))).toBe(true); // "duplicidade no arquivo"
  expect(Boolean(L(11).cpfNormalizado === "01234567890" && L(11).valor === 250.5)).toBe(true); // "CPF numérico com zero à esquerda"

  const clientes: ClienteBaseModelo[] = [
    {
      id: "m",
      nome: "MARIA SOUZA",
      nome_normalizado: "maria souza",
      cpf: null,
      status: "ativo",
      numero_processo: null,
    },
    {
      id: "a",
      nome: "Ana Pereira",
      nome_normalizado: "ana pereira",
      cpf: "99999999999",
      status: "ativo",
      numero_processo: null,
    },
    {
      id: "j",
      nome: "Joao da Silva",
      nome_normalizado: "joao da silva",
      cpf: "00000000000",
      status: "ativo",
      numero_processo: "x",
    },
    {
      id: "f1",
      nome: "Fulano Desconhecid",
      nome_normalizado: "fulano desconhecid",
      cpf: null,
      status: "ativo",
    },
  ];
  const plano = planejarImportacaoModelo({
    linhas: an.linhas,
    clientes,
    variacoes: [],
    pagamentos: [],
  });
  const A = (n: number) => plano.itens.find((i) => i.linha.numeroLinha === n)!;
  expect(Boolean(A(2).acao === "sem_alteracao" && A(2).clienteId === "j")).toBe(true); // "João existente por CPF, sem duplicar"
  expect(
    Boolean(
      A(3).acao === "marcar_pago" &&
      A(3).alteracoes.status === "pago" &&
      A(3).alteracoes.cpf === "111.111.111-11" &&
      A(3).registrarValor === 1500,
    ),
  ).toBe(true); // "Maria → pago + CPF + valor"
  expect(Boolean(A(4).acao === "criar")).toBe(true); // "Carlos novo"
  expect(Boolean(A(5).acao === "marcar_pago" && A(5).registrarValor === null)).toBe(true); // "Ana pago sem valor"
  expect(Boolean(A(7).acao === "nao_encontrado" && !!A(7).aviso)).toBe(true); // "Fulano não encontrado, com sugestão, sem associar"

  const clientes2 = clientes.map((c) =>
    c.id === "m"
      ? { ...c, status: "pago", cpf: "111.111.111-11" }
      : c.id === "a"
        ? { ...c, status: "pago" }
        : c,
  );
  clientes2.push({
    id: "c",
    nome: "Carlos Oliveira",
    nome_normalizado: "carlos oliveira",
    cpf: null,
    status: "ativo",
    numero_processo: "123",
  });
  clientes2.push({
    id: "p",
    nome: "Pedro Numerico",
    nome_normalizado: "pedro numerico",
    cpf: "012.345.678-90",
    status: "ativo",
    numero_processo: null,
  });
  const plano2 = planejarImportacaoModelo({
    linhas: an.linhas,
    clientes: clientes2,
    variacoes: [],
    pagamentos: [{ cliente_id: "m", valor: 1500, observacao: MARCA_PAGAMENTO_MODELO }],
  });
  expect(Boolean(plano2.resumo.novos === 0)).toBe(true); // "reimportação não cria ninguém"
  expect(
    Boolean(
      plano2.itens.filter((i) => i.acao === "marcar_pago" || i.acao === "atualizar").length === 0,
    ),
  ).toBe(true); // "reimportação sem alterações"

  const ruim = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    ruim,
    XLSX.utils.aoa_to_sheet([
      ["Nome", "CPF", "Status"],
      ["x", "", "PAGO"],
    ]),
    "A",
  );
  const r = analisarWorkbookModelo(ruim);
  expect(Boolean(r.errosEstrutura.length > 0 && r.linhas.length === 0)).toBe(true); // "arquivo fora do modelo é bloqueado"

  const plano3 = planejarImportacaoModelo({
    linhas: [{ ...L(5), cpf: null, cpfNormalizado: null }],
    clientes: [
      ...clientes,
      {
        id: "a2",
        nome: "Ana Pereira",
        nome_normalizado: "ana pereira",
        cpf: null,
        status: "ativo",
      },
    ],
    variacoes: [],
    pagamentos: [],
  });
  expect(Boolean(plano3.itens[0]!.acao === "nao_encontrado")).toBe(true); // "homônimos sem CPF -> revisão, não associa"
});
