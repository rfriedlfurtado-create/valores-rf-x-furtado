export const ROTULO_STATUS_LOTE: Record<
  string,
  { texto: string; tom: "neutro" | "sucesso" | "alerta" | "perigo" }
> = {
  gravando: { texto: "Em gravação / interrompido", tom: "alerta" },
  gravado_com_pendencias: { texto: "Gravado com pendências", tom: "alerta" },
  concluido: { texto: "Concluído", tom: "sucesso" },
  falhou: { texto: "Falhou — pode ser retomado", tom: "perigo" },
  desfeito: { texto: "Desfeito", tom: "neutro" },
  desfeito_parcial: { texto: "Desfeito (parcial)", tom: "neutro" },
};
