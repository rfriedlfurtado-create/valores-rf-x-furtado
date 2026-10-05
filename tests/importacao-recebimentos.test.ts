/**
 * Modalidade "Clientes com Valores Recebidos": leitura, identificação do
 * cliente existente, múltiplos valores, categorias e idempotência.
 * Rodar: bun test
 */
import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import {
  chaveClassificacao,
  identificarLinha,
  indexarClientes,
  montarItens,
  processoDaLinha,
  resumirPrevia,
  type ClienteBase,
  type Identificacao,
} from "@/lib/recebimentos/identificacao";
import {
  ARQUIVO_MODELO_RECEBIMENTOS,
  categoriaDoTexto,
  lerPlanilhaRecebimentos,
} from "@/lib/recebimentos/modelo";
import { mapearCabecalhos } from "@/lib/rf/campos";
import { resumirEntradas } from "@/lib/situacao";
import { CLASSIFICACOES_ENTRADA, ROTULO_CLASSIFICACAO } from "@/lib/tipos";

function planilha(linhas: unknown[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Valores");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

const CLIENTES: ClienteBase[] = [
  { id: "joao", nome: "João da Silva", cpf: null, status: "ativo", deleted_at: null },
  { id: "maria", nome: "Maria Souza", cpf: "529.982.247-25", status: "pago", deleted_at: null },
  { id: "ana1", nome: "Ana Lima", cpf: null, status: "ativo", deleted_at: null },
  { id: "ana2", nome: "ANA LIMA", cpf: null, status: "ativo", deleted_at: null },
  { id: "excl", nome: "Pedro Excluído", cpf: null, status: "ativo", deleted_at: "2026-01-01" },
  {
    id: "arq",
    nome: "Carla Arquivada",
    cpf: null,
    status: "arquivado",
    deleted_at: null,
    arquivado: true,
  },
];
const indice = indexarClientes(CLIENTES, [{ cliente_id: "joao", nome_variacao: "Joao S." }]);

describe("categorias padronizadas", () => {
  test("somente CONTRATUAL, ATRASADOS e SUCUMBÊNCIA", () => {
    expect(CLASSIFICACOES_ENTRADA.map((c) => c.value)).toEqual([
      "contratuais",
      "atrasados",
      "sucumbencia",
    ]);
    expect(Object.values(ROTULO_CLASSIFICACAO)).toEqual(["Contratual", "Atrasados", "Sucumbência"]);
  });

  test("texto livre da planilha vira a categoria oficial", () => {
    expect(categoriaDoTexto("CONTRATUAL")).toBe("contratuais");
    expect(categoriaDoTexto("Honorários contratuais")).toBe("contratuais");
    expect(categoriaDoTexto("atrasados")).toBe("atrasados");
    expect(categoriaDoTexto("Sucumbência")).toBe("sucumbencia");
    expect(categoriaDoTexto("sucumbencia")).toBe("sucumbencia");
    expect(categoriaDoTexto("outra coisa")).toBeNull();
    expect(categoriaDoTexto("")).toBeNull();
  });

  test("resumo por categoria; valor antigo fora do padrão conta como sem categoria", () => {
    const r = resumirEntradas([
      { valor: 1000, classificacao: "contratuais" },
      { valor: 4500, classificacao: "atrasados" },
      { valor: 800, classificacao: "sucumbencia" },
      { valor: 50, classificacao: "implantacao" as never },
      { valor: 10, classificacao: null },
    ]);
    expect(r.total).toBe(6360);
    expect(r.quantidade).toBe(5);
    expect(r.porClassificacao.contratuais.valor).toBe(1000);
    expect(r.porClassificacao.sem_classificacao).toEqual({ quantidade: 2, valor: 60 });
  });
});

describe("leitura da planilha de valores recebidos", () => {
  test("Reclamante + Valor + Categoria + Data; repetições = várias entradas", () => {
    const p = lerPlanilhaRecebimentos(
      planilha([
        ["Reclamante", "Valor", "Tipo", "Data do pagamento"],
        ["João da Silva", 1000, "Contratual", "10/01/2025"],
        ["joão  da silva", "R$ 4.500,00", "ATRASADOS", "11/01/2025"],
        ["JOAO DA SILVA", 800, "sucumbência", null],
        ["Fulano", 0, "Contratual", null],
        ["", 300, "", null],
      ]),
    );
    const comValor = p.linhas.filter((l) => l.entradas.length);
    expect(comValor.map((l) => l.entradas[0]!.valor)).toEqual([1000, 4500, 800]);
    expect(comValor.map((l) => l.entradas[0]!.classificacao)).toEqual([
      "contratuais",
      "atrasados",
      "sucumbencia",
    ]);
    expect(comValor.map((l) => l.data)).toEqual(["2025-01-10", "2025-01-11", null]);
    expect(new Set(comValor.map((l) => l.nome_normalizado)).size).toBe(1);
    // valor 0: linha continua válida, sem valor (aviso); sem Reclamante fica fora
    const fulano = p.linhas.find((l) => l.reclamante === "Fulano")!;
    expect(fulano.entradas).toEqual([]);
    expect(fulano.avisos.length).toBe(1);
    expect(p.pendentes.map((x) => x.linha)).toEqual([6]);
  });

  test("colunas por categoria: cada célula com valor é um recebimento próprio", () => {
    const p = lerPlanilhaRecebimentos(
      planilha([
        ["Reclamante", "CPF", "Contratual", "Atrasados", "Sucumbência"],
        ["Maria Souza", "52998224725", 2000, 5000, 1500],
      ]),
    );
    const l = p.linhas[0]!;
    expect(l.cpf_valido).toBe(true);
    expect(l.entradas.map((e) => [e.valor, e.classificacao])).toEqual([
      [2000, "contratuais"],
      [5000, "atrasados"],
      [1500, "sucumbencia"],
    ]);
  });

  test("categoria não reconhecida fica sem categoria, com aviso (sem bloquear)", () => {
    const p = lerPlanilhaRecebimentos(
      planilha([
        ["Reclamante", "Valor", "Categoria"],
        ["Ana", 10, "Bônus"],
      ]),
    );
    expect(p.linhas[0]!.entradas[0]!.classificacao).toBeNull();
    expect(p.linhas[0]!.avisos.length).toBe(1);
  });

  test("só o Reclamante é obrigatório: planilha sem coluna de valor é aceita", () => {
    const p = lerPlanilhaRecebimentos(
      planilha([["Reclamante", "Valor Estimado do Processo"], ["Ana", 50000], ["Bia"]]),
    );
    expect(p.linhas.map((l) => l.reclamante)).toEqual(["Ana", "Bia"]);
    // "Valor Estimado do Processo" nunca é lido como valor recebido
    expect(p.linhas.every((l) => l.entradas.length === 0)).toBe(true);
    expect(p.pendentes).toEqual([]);
  });

  test("sem a coluna Reclamante a planilha é recusada", () => {
    expect(() =>
      lerPlanilhaRecebimentos(
        planilha([
          ["Nada", "Valor"],
          ["x", 10],
        ]),
      ),
    ).toThrow(/Reclamante/);
  });

  test("modelo vazio para download tem Reclamante e Valor", async () => {
    const dados = await Bun.file(`public${ARQUIVO_MODELO_RECEBIMENTOS}`).arrayBuffer();
    const p = lerPlanilhaRecebimentos(new Uint8Array(dados));
    expect([...p.colunas.values()]).toContain("reclamante");
    expect([...p.colunas.values()]).toContain("valor");
    expect(p.linhas).toHaveLength(0);
  });

  test("o modelo de cadastro não reconhece 'Valor recebido' como campo oficial", () => {
    const m = mapearCabecalhos(["Reclamante", "Valor recebido"]);
    expect([...m.extras.values()]).toEqual(["Valor recebido"]);
  });
});

describe("identificação do cliente existente", () => {
  const linha = (reclamante: string, cpf: string | null = null) => ({
    reclamante,
    cpf_digitos: cpf ? cpf.replace(/\D/g, "") : null,
    cpf_valido: cpf === "529.982.247-25" || cpf === "52998224725",
  });

  test("nome igual após normalização (caixa, acento, espaços)", () => {
    const r = identificarLinha(linha("  JOAO   da SILVA "), indice);
    expect(r).toMatchObject({ status: "encontrado", cliente_id: "joao", via: "nome" });
  });

  test("CPF tem prioridade sobre o nome", () => {
    const r = identificarLinha(linha("Nome Diferente", "529.982.247-25"), indice);
    expect(r).toMatchObject({ status: "encontrado", cliente_id: "maria", via: "cpf" });
  });

  test("variação de nome confirmada identifica o cliente", () => {
    expect(identificarLinha(linha("joao s"), indice)).toMatchObject({
      cliente_id: "joao",
      via: "variacao",
    });
  });

  test("nome parecido NÃO vincula (sem similaridade aproximada)", () => {
    expect(identificarLinha(linha("João da Silva Santos"), indice).status).toBe("nao_encontrado");
    expect(identificarLinha(linha("Joao Silva"), indice).status).toBe("nao_encontrado");
  });

  test("dois clientes com o mesmo nome → revisão", () => {
    const r = identificarLinha(linha("Ana Lima"), indice);
    expect(r.status).toBe("ambiguo");
    expect(r.cliente_id).toBeNull();
    expect(r.candidatos.sort()).toEqual(["ana1", "ana2"]);
  });

  test("CPF diferente do cadastrado → revisão, não vincula pelo nome", () => {
    const outro = indexarClientes([
      { id: "x", nome: "Rita", cpf: "111.444.777-35", status: "ativo", deleted_at: null },
    ]);
    expect(identificarLinha(linha("Rita", "529.982.247-25"), outro).status).toBe("cpf_divergente");
  });

  test("excluído não é encontrado; arquivado vai para revisão", () => {
    expect(identificarLinha(linha("Pedro Excluído"), indice).status).toBe("nao_encontrado");
    expect(identificarLinha(linha("Carla Arquivada"), indice).status).toBe("arquivado");
  });

  test("vínculo manual da prévia tem prioridade", () => {
    expect(identificarLinha(linha("Ana Lima"), indice, "ana2")).toMatchObject({
      status: "encontrado",
      cliente_id: "ana2",
      via: "manual",
    });
  });
});

describe("recebimentos e idempotência", () => {
  const p = lerPlanilhaRecebimentos(
    planilha([
      ["Reclamante", "Valor", "Categoria", "Data", "Número"],
      ["João da Silva", 1000, "Contratual", "10/01/2025", "5000918-42.2024.4.03.6115"],
      ["João da Silva", 4500, "Atrasados", "10/01/2025", null],
      ["João da Silva", 800, "Sucumbência", "10/01/2025", null],
      ["João da Silva", 800, "Sucumbência", "10/01/2025", null],
      ["Desconhecido", 99, "Contratual", null, null],
    ]),
  );
  const idents = new Map<number, Identificacao>(
    p.linhas.map((l) => [l.linha, identificarLinha(l, indice)]),
  );
  const processos = [
    { id: "proc1", cliente_id: "joao", numero_digitos: "50009184220244036115", pasta: "PRV.1" },
    { id: "proc2", cliente_id: "joao", numero_digitos: "999", pasta: "PRV.2" },
  ];

  test("1 cliente, 4 valores individualizados; não encontrado fica fora", () => {
    const itens = montarItens(p.linhas, idents, processos);
    expect(itens).toHaveLength(4);
    expect(new Set(itens.map((i) => i.cliente_id))).toEqual(new Set(["joao"]));
    expect(itens.map((i) => i.valor)).toEqual([1000, 4500, 800, 800]);
  });

  test("valores iguais legítimos no mesmo arquivo têm chaves diferentes", () => {
    const itens = montarItens(p.linhas, idents, processos);
    expect(itens.map((i) => i.chave)).toEqual([
      "rv:2025-01-10:100000:1",
      "rv:2025-01-10:450000:1",
      "rv:2025-01-10:80000:1",
      "rv:2025-01-10:80000:2",
    ]);
  });

  test("reimportar o mesmo arquivo gera as mesmas chaves (o banco não duplica)", () => {
    const a = montarItens(p.linhas, idents, processos).map((i) => i.chave);
    const b = montarItens(p.linhas, idents, processos).map((i) => i.chave);
    expect(b).toEqual(a);
  });

  test("mudar a categoria não muda a chave (reclassificar nunca duplica)", () => {
    const antes = montarItens(p.linhas, idents, processos);
    const depois = montarItens(
      p.linhas,
      idents,
      processos,
      new Map([[chaveClassificacao(2, 0), "atrasados" as const]]),
    );
    expect(depois.map((i) => i.chave)).toEqual(antes.map((i) => i.chave));
    expect(depois[0]!.classificacao).toBe("atrasados");
  });

  test("processo vinculado só por número ou pasta exatos", () => {
    const itens = montarItens(p.linhas, idents, processos);
    expect(itens[0]!.atendimento_id).toBe("proc1");
    expect(itens[1]!.atendimento_id).toBeNull();
    expect(processoDaLinha({ numero_digitos: null, pasta: "prv.2" }, "joao", processos)).toBe(
      "proc2",
    );
    expect(processoDaLinha({ numero_digitos: "999", pasta: null }, "maria", processos)).toBeNull();
  });

  test("resumo: novos, já registrados, movidos e revisão", () => {
    const itens = montarItens(p.linhas, idents, processos);
    const resultados = itens.map((i, n) => ({
      linha: i.linha,
      cliente_id: i.cliente_id,
      chave: i.chave,
      resultado: n === 3 ? "ja_registrado" : "inserido",
      movido: n === 0,
    }));
    const r = resumirPrevia({
      linhas: p.linhas,
      pendentes: p.pendentes.length,
      identificacoes: idents,
      itens,
      resultados,
      statusCliente: (id) => CLIENTES.find((c) => c.id === id)?.status,
    });
    expect(r).toMatchObject({
      clientesIdentificados: 1,
      clientesMovidos: 1,
      clientesJaPagos: 0,
      valoresNovos: 3,
      valoresJaRegistrados: 1,
      totalNovo: 6300,
      revisao: 1,
    });
  });
});

describe("linha sem valor (valores lançados depois, no perfil)", () => {
  const indice = indexarClientes(CLIENTES);
  const p = lerPlanilhaRecebimentos(
    planilha([
      ["Reclamante", "Valor"],
      ["João da Silva", null],
      ["João da Silva", 500],
    ]),
  );
  const idents = new Map<number, Identificacao>(
    p.linhas.map((l) => [l.linha, identificarLinha(l, indice)]),
  );

  test("gera item sem_valor (sem pagamento) e o valor normal", () => {
    const itens = montarItens(p.linhas, idents, []);
    expect(itens.map((i) => [i.sem_valor, i.valor, i.chave])).toEqual([
      [true, null, "rv:sv:2"],
      [false, 500, "rv:sd:50000:1"],
    ]);
  });

  test("resumo conta a linha sem valor e não soma no total", () => {
    const itens = montarItens(p.linhas, idents, []);
    const resultados = itens.map((i) => ({
      linha: i.linha,
      cliente_id: i.cliente_id,
      chave: i.chave,
      resultado: i.sem_valor ? "marcado_pago" : "inserido",
      movido: i.sem_valor,
    }));
    const r = resumirPrevia({
      linhas: p.linhas,
      pendentes: 0,
      identificacoes: idents,
      itens,
      resultados,
      statusCliente: () => "em_tramitacao",
    });
    expect(r).toMatchObject({
      clientesSemValor: 1,
      clientesMovidos: 1,
      valoresNovos: 1,
      totalNovo: 500,
      valores: 1,
    });
  });
});
