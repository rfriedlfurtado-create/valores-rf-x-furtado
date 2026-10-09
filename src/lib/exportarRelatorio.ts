/**
 * Exportação do RELATÓRIO DE HONORÁRIOS (Excel e PDF). Recebe o documento
 * montado por `documentoRelatorio` — as mesmas linhas filtradas exibidas na
 * página —, então os totais exportados são sempre os da tela.
 */
import * as XLSX from "xlsx";

import type { DocumentoRelatorio } from "./relatorioHonorarios";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const FORMATO_MOEDA = '"R$" #,##0.00';

/** Pasta de trabalho com as abas Resumo e Detalhamento. */
export function planilhaRelatorio(doc: DocumentoRelatorio): XLSX.WorkBook {
  const resumo: (string | number)[][] = [
    [doc.titulo],
    [],
    ["Período", doc.periodo],
    ...doc.filtros.map((f) => ["Filtro", f]),
    [],
    ["Total recebido", doc.totais.recebido],
    ["Honorários do Escritório", doc.totais.escritorio],
    [`Repasse Ricardo Friedl (${doc.percentual}%)`, doc.totais.ricardo],
    ["Recebimentos considerados", doc.totais.quantidade],
    ["Clientes", doc.totais.clientes],
    [],
    ["Categoria", "Recebimentos", "Clientes", "Total recebido", "Escritório", "Ricardo Friedl"],
    ...doc.categorias.map((c) => [
      c.rotulo,
      c.quantidade,
      c.clientes,
      c.recebido,
      c.escritorio,
      c.ricardo,
    ]),
    [
      "TOTAL",
      doc.totais.quantidade,
      doc.totais.clientes,
      doc.totais.recebido,
      doc.totais.escritorio,
      doc.totais.ricardo,
    ],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  const detalhe: (string | number)[][] = [
    ["Cliente", "Processo", "Data", "Categoria", "Valor recebido", "Escritório", "Ricardo Friedl"],
    ...doc.detalhamento.map((d) => [
      d.cliente,
      d.processo,
      d.data,
      d.categoria,
      d.recebido,
      d.escritorio,
      d.ricardo,
    ]),
    ["TOTAL", "", "", "", doc.totais.recebido, doc.totais.escritorio, doc.totais.ricardo],
  ];
  const wsDet = XLSX.utils.aoa_to_sheet(detalhe);
  const f = doc.filtros.length;
  aplicarMoeda(
    wsResumo,
    (r, c) => (r >= 4 + f && r <= 6 + f && c === 1) || (r >= 11 + f && c >= 3),
  );
  aplicarMoeda(wsDet, (r, c) => r >= 1 && c >= 4);
  wsResumo["!cols"] = [
    { wch: 32 },
    { wch: 18 },
    { wch: 10 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
  ];
  wsDet["!cols"] = [
    { wch: 36 },
    { wch: 28 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
  XLSX.utils.book_append_sheet(wb, wsDet, "Detalhamento");
  return wb;
}

function aplicarMoeda(ws: XLSX.WorkSheet, eMoeda: (linha: number, coluna: number) => boolean) {
  const ref = ws["!ref"];
  if (!ref) return;
  const r = XLSX.utils.decode_range(ref);
  for (let i = r.s.r; i <= r.e.r; i++)
    for (let j = r.s.c; j <= r.e.c; j++) {
      const cel = ws[XLSX.utils.encode_cell({ r: i, c: j })];
      if (cel && cel.t === "n" && eMoeda(i, j)) cel.z = FORMATO_MOEDA;
    }
}

export function nomeArquivo(extensao: string, hoje: Date = new Date()): string {
  const d = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return `relatorio-honorarios-${d}.${extensao}`;
}

export function baixarExcel(doc: DocumentoRelatorio): void {
  XLSX.writeFile(planilhaRelatorio(doc), nomeArquivo("xlsx"));
}

function esc(t: string): string {
  return t.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** HTML pronto para impressão/“Salvar como PDF”. */
export function htmlRelatorio(doc: DocumentoRelatorio): string {
  const m = (v: number) => esc(BRL.format(v));
  const linhasCat = doc.categorias
    .map(
      (c) =>
        `<tr><td>${esc(c.rotulo)}</td><td class="n">${c.quantidade}</td><td class="n">${m(c.recebido)}</td><td class="n">${m(c.escritorio)}</td><td class="n">${m(c.ricardo)}</td></tr>`,
    )
    .join("");
  const linhasDet = doc.detalhamento
    .map(
      (d) =>
        `<tr><td>${esc(d.cliente)}</td><td>${esc(d.processo)}</td><td>${esc(d.data)}</td><td>${esc(d.categoria)}</td><td class="n">${m(d.recebido)}</td><td class="n">${m(d.escritorio)}</td><td class="n">${m(d.ricardo)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(nomeArquivo("pdf"))}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: .04em; }
  h2 { font-size: 12px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .05em; }
  .sub { color: #555; margin: 0 0 12px; }
  .cards { display: flex; gap: 10px; margin: 10px 0; }
  .card { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; }
  .card b { display: block; font-size: 15px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; }
  td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.t td { font-weight: 700; border-top: 2px solid #999; }
  thead { display: table-header-group; }
</style></head><body>
<h1>${esc(doc.titulo)}</h1>
<p class="sub">Período: ${esc(doc.periodo)}${doc.filtros.length ? ` · ${doc.filtros.map(esc).join(" · ")}` : ""}</p>
<div class="cards">
  <div class="card">Total recebido<b>${m(doc.totais.recebido)}</b>${doc.totais.quantidade} recebimento(s) · ${doc.totais.clientes} cliente(s)</div>
  <div class="card">Honorários do Escritório<b>${m(doc.totais.escritorio)}</b>${100 - doc.percentual}% (recebido − repasse)</div>
  <div class="card">Repasse Ricardo Friedl (${doc.percentual}%)<b>${m(doc.totais.ricardo)}</b>${doc.percentual}% de cada recebimento</div>
</div>
<h2>Por categoria</h2>
<table><thead><tr><th>Categoria</th><th class="n">Recebimentos</th><th class="n">Total recebido</th><th class="n">Escritório</th><th class="n">Ricardo Friedl</th></tr></thead>
<tbody>${linhasCat}<tr class="t"><td>TOTAL</td><td class="n">${doc.totais.quantidade}</td><td class="n">${m(doc.totais.recebido)}</td><td class="n">${m(doc.totais.escritorio)}</td><td class="n">${m(doc.totais.ricardo)}</td></tr></tbody></table>
<h2>Detalhamento</h2>
<table><thead><tr><th>Cliente</th><th>Processo</th><th>Data</th><th>Categoria</th><th class="n">Valor recebido</th><th class="n">Escritório</th><th class="n">Ricardo Friedl</th></tr></thead>
<tbody>${linhasDet || `<tr><td colspan="7">Nenhum recebimento no filtro.</td></tr>`}<tr class="t"><td colspan="4">TOTAL</td><td class="n">${m(doc.totais.recebido)}</td><td class="n">${m(doc.totais.escritorio)}</td><td class="n">${m(doc.totais.ricardo)}</td></tr></tbody></table>
</body></html>`;
}

/**
 * Abre o relatório numa janela de impressão — o navegador oferece “Salvar como
 * PDF”. Retorna false se o navegador bloqueou a janela.
 */
export function imprimirPdf(doc: DocumentoRelatorio): boolean {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const w = iframe.contentWindow;
  if (!w) {
    iframe.remove();
    return false;
  }
  w.document.open();
  w.document.write(htmlRelatorio(doc));
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
    setTimeout(() => iframe.remove(), 60_000);
  }, 250);
  return true;
}
