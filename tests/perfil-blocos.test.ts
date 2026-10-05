/**
 * Perfil do cliente em blocos expansíveis: organização dos campos e
 * abertura/fechamento dos blocos. Rodar: bun test
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BlocoExpansivel } from "@/components/BlocoExpansivel";
import { BLOCOS_PERFIL, blocoPerfil, CAMPOS_OFICIAIS, type ChaveCampo } from "@/lib/rf/campos";
import {
  CAMPOS_PERFIL_CLIENTE,
  cpfUnificado,
  organizarCampos,
  resumoDoBloco,
  valorDoCliente,
} from "@/lib/rf/perfil";

const de = (o: Partial<Record<ChaveCampo, string>>) => (c: ChaveCampo) => o[c];

describe("blocos do perfil", () => {
  test("os 4 blocos cobrem os 22 campos oficiais, cada um uma única vez", () => {
    expect(BLOCOS_PERFIL.map((b) => b.titulo)).toEqual([
      "Perfil do Cliente",
      "Contato",
      "Processo",
      "Informações Internas",
    ]);
    const oficiais = BLOCOS_PERFIL.flatMap((b) => b.campos).filter((c) =>
      CAMPOS_OFICIAIS.some((o) => o.chave === c),
    );
    expect(oficiais.length).toBe(22);
    expect(new Set(oficiais).size).toBe(22);
  });

  test("distribuição pedida: identificação, contato, processo, internas", () => {
    const oficiaisDe = (s: Parameters<typeof blocoPerfil>[0]) =>
      blocoPerfil(s).campos.filter((c) => CAMPOS_OFICIAIS.some((o) => o.chave === c));
    expect(oficiaisDe("identificacao").sort()).toEqual(
      ["nome", "cidade", "data_nascimento", "cpf_cnpj", "cep", "cpf_reclamante"].sort(),
    );
    expect(oficiaisDe("contato").sort()).toEqual(
      ["celular", "telefone_cliente", "telefone_residencial", "email"].sort(),
    );
    expect(oficiaisDe("processo").sort()).toEqual(
      [
        "numero",
        "adverso",
        "tipo_acao",
        "categoria",
        "distribuido_em",
        "situacao",
        "valor_estimado",
      ].sort(),
    );
    expect(oficiaisDe("interno").sort()).toEqual(
      ["pasta", "captador", "captado_em", "data_inicio_contrato", "indicacao"].sort(),
    );
  });

  test("principais visíveis, secundárias ao expandir, vazios escondidos", () => {
    const { campos } = blocoPerfil("processo");
    const org = organizarCampos(
      campos,
      de({
        numero: "5000918-42.2024.4.03.6115",
        tipo_acao: "Aposentadoria por Incapacidade Permanente",
        situacao: "",
        adverso: "INSS",
        valor_estimado: "0",
      }),
    );
    expect(org.principais).toEqual(["numero", "tipo_acao"]);
    expect(org.secundarios).toEqual(["adverso", "valor_estimado"]); // 0 é informação
    expect(org.vazios).toContain("situacao"); // principal vazio também fica escondido
    expect(org.vazios).toContain("categoria");
    // campos do modelo anterior só aparecem quando preenchidos
    expect(org.vazios).not.toContain("comarca");
  });

  test("campo legado preenchido continua visível (dados antigos preservados)", () => {
    const org = organizarCampos(blocoPerfil("processo").campos, de({ comarca: "Porto Alegre" }));
    expect(org.secundarios).toEqual(["comarca"]);
  });

  test("resumo do bloco recolhido = principais formatados", () => {
    expect(
      resumoDoBloco(
        blocoPerfil("processo").campos,
        de({
          numero: "5000918-42.2024.4.03.6115",
          tipo_acao: "Aposentadoria por Incapacidade Permanente",
          situacao: "Encerrado",
          adverso: "INSS",
        }),
      ),
    ).toEqual([
      "5000918-42.2024.4.03.6115",
      "Aposentadoria por Incapacidade Permanente",
      "Encerrado",
    ]);
  });

  test("nome e CPF vêm das colunas próprias do cliente", () => {
    const v = valorDoCliente({
      nome: "Maria",
      cpf: "529.982.247-25",
      dados_rf: { cidade: "São Paulo" },
    });
    expect([v("nome"), v("cpf_reclamante"), v("cidade"), v("cep")]).toEqual([
      "Maria",
      "529.982.247-25",
      "São Paulo",
      undefined,
    ]);
  });
});

describe("abertura dos blocos", () => {
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(
        BlocoExpansivel,
        { titulo: "Processo", resumo: "RESUMO-PRINCIPAL", ...props },
        createElement("p", null, "CONTEUDO-COMPLETO"),
      ),
    );

  /** Tag do contêiner do conteúdo (o que abre e fecha). */
  const conteiner = (html: string) => html.match(/<div[^>]*grid-template-rows[^>]*>/)![0];

  test("recolhido: mostra o resumo e esconde o conteúdo", () => {
    const html = render({});
    expect(conteiner(html)).toContain('aria-hidden="true"');
    expect(conteiner(html)).toContain("inert");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("RESUMO-PRINCIPAL");
    expect(html).toContain("grid-template-rows:0fr");
  });

  test("expandido: mostra o conteúdo completo e oculta o resumo", () => {
    const html = render({ inicialAberto: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("RESUMO-PRINCIPAL");
    expect(html).toContain("CONTEUDO-COMPLETO");
    expect(html).toContain("grid-template-rows:1fr");
    expect(conteiner(html)).not.toContain('aria-hidden="true"');
    expect(conteiner(html)).not.toContain("inert");
  });

  test("modo controlado segue a propriedade aberto", () => {
    expect(render({ aberto: false, inicialAberto: true })).toContain('aria-expanded="false"');
    expect(render({ aberto: true })).toContain('aria-expanded="true"');
  });
});

describe("PERFIL DO CLIENTE — seção única e CPF único", () => {
  test("nome e CPFs não se repetem nos campos expandidos", () => {
    expect(CAMPOS_PERFIL_CLIENTE).not.toContain("nome");
    expect(CAMPOS_PERFIL_CLIENTE).not.toContain("cpf_reclamante");
    expect(CAMPOS_PERFIL_CLIENTE).not.toContain("cpf_cnpj");
    expect(CAMPOS_PERFIL_CLIENTE).toEqual(
      expect.arrayContaining(["cidade", "data_nascimento", "cep"]),
    );
  });

  test("CPF único: cadastro; na falta, coluna CPF; divergência só sinalizada", () => {
    expect(cpfUnificado({ cpf: "529.982.247-25", dados_rf: { cpf_cnpj: "52998224725" } })).toEqual({
      cpf: "529.982.247-25",
      origem: "cadastro",
      divergente: false,
      outro: null,
    });
    expect(cpfUnificado({ cpf: null, dados_rf: { cpf_cnpj: "111.444.777-35" } })).toMatchObject({
      cpf: "111.444.777-35",
      origem: "coluna_cpf",
    });
    expect(
      cpfUnificado({ cpf: "529.982.247-25", dados_rf: { cpf_cnpj: "111.444.777-35" } }),
    ).toEqual({
      cpf: "529.982.247-25",
      origem: "cadastro",
      divergente: true,
      outro: "111.444.777-35",
    });
    expect(cpfUnificado({ cpf: " ", dados_rf: null }).cpf).toBeNull();
  });
});
