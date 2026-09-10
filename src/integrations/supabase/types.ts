export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clientes: {
        Row: {
          arquivado: boolean
          cpf: string | null
          created_at: string
          data_importacao: string | null
          deleted_at: string | null
          id: string
          nome: string
          nome_normalizado: string
          observacoes: string | null
          origem_importacao: string | null
          status: string
          updated_at: string
        }
        Insert: {
          arquivado?: boolean
          cpf?: string | null
          created_at?: string
          data_importacao?: string | null
          deleted_at?: string | null
          id?: string
          nome: string
          nome_normalizado: string
          observacoes?: string | null
          origem_importacao?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          arquivado?: boolean
          cpf?: string | null
          created_at?: string
          data_importacao?: string | null
          deleted_at?: string | null
          id?: string
          nome?: string
          nome_normalizado?: string
          observacoes?: string | null
          origem_importacao?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      clientes_importados: {
        Row: {
          cliente_vinculado_id: string | null
          created_at: string
          id: string
          importacao_id: string
          nome_normalizado: string
          nome_original: string
          status_analise: string
        }
        Insert: {
          cliente_vinculado_id?: string | null
          created_at?: string
          id?: string
          importacao_id: string
          nome_normalizado: string
          nome_original: string
          status_analise?: string
        }
        Update: {
          cliente_vinculado_id?: string | null
          created_at?: string
          id?: string
          importacao_id?: string
          nome_normalizado?: string
          nome_original?: string
          status_analise?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_importados_cliente_vinculado_id_fkey"
            columns: ["cliente_vinculado_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_importados_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "importacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          chave: string
          updated_at: string
          valor: Json
        }
        Insert: {
          chave: string
          updated_at?: string
          valor: Json
        }
        Update: {
          chave?: string
          updated_at?: string
          valor?: Json
        }
        Relationships: []
      }
      correspondencias: {
        Row: {
          classificacao: string
          cliente_encontrado_id: string
          cliente_importado_id: string
          created_at: string
          id: string
          percentual_similaridade: number
          possui_pagamento: boolean
          status: string
          updated_at: string
        }
        Insert: {
          classificacao: string
          cliente_encontrado_id: string
          cliente_importado_id: string
          created_at?: string
          id?: string
          percentual_similaridade: number
          possui_pagamento?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          classificacao?: string
          cliente_encontrado_id?: string
          cliente_importado_id?: string
          created_at?: string
          id?: string
          percentual_similaridade?: number
          possui_pagamento?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "correspondencias_cliente_encontrado_id_fkey"
            columns: ["cliente_encontrado_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondencias_cliente_importado_id_fkey"
            columns: ["cliente_importado_id"]
            isOneToOne: false
            referencedRelation: "clientes_importados"
            referencedColumns: ["id"]
          },
        ]
      }
      correspondencias_rejeitadas: {
        Row: {
          data_rejeicao: string
          id: string
          nome_1_normalizado: string
          nome_2_normalizado: string
        }
        Insert: {
          data_rejeicao?: string
          id?: string
          nome_1_normalizado: string
          nome_2_normalizado: string
        }
        Update: {
          data_rejeicao?: string
          id?: string
          nome_1_normalizado?: string
          nome_2_normalizado?: string
        }
        Relationships: []
      }
      importacoes: {
        Row: {
          created_at: string
          id: string
          nome_importacao: string
          origem_arquivo: string | null
          quantidade_clientes: number
          quantidade_correspondencias: number
          quantidade_ja_pagos: number
          quantidade_possiveis: number
          tipo_origem: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome_importacao: string
          origem_arquivo?: string | null
          quantidade_clientes?: number
          quantidade_correspondencias?: number
          quantidade_ja_pagos?: number
          quantidade_possiveis?: number
          tipo_origem?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome_importacao?: string
          origem_arquivo?: string | null
          quantidade_clientes?: number
          quantidade_correspondencias?: number
          quantidade_ja_pagos?: number
          quantidade_possiveis?: number
          tipo_origem?: string
        }
        Relationships: []
      }
      pagamentos: {
        Row: {
          cliente_id: string
          created_at: string
          data_pagamento: string
          id: string
          observacao: string | null
          tipo: string
          updated_at: string
          usuario_cadastro: string | null
          valor: number
        }
        Insert: {
          cliente_id: string
          created_at?: string
          data_pagamento: string
          id?: string
          observacao?: string | null
          tipo?: string
          updated_at?: string
          usuario_cadastro?: string | null
          valor: number
        }
        Update: {
          cliente_id?: string
          created_at?: string
          data_pagamento?: string
          id?: string
          observacao?: string | null
          tipo?: string
          updated_at?: string
          usuario_cadastro?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      variacoes_nome: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          nome_normalizado: string
          nome_variacao: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          nome_normalizado: string
          nome_variacao: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          nome_normalizado?: string
          nome_variacao?: string
        }
        Relationships: [
          {
            foreignKeyName: "variacoes_nome_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
