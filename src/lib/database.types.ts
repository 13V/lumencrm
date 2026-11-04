// Generated from the PostgreSQL catalog after applying supabase/migrations.
// Regenerate: node tests/database/run.mjs --types
// A hosted Supabase CLI type export may replace this file without changing the schema.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          deal_id: string | null;
          contact_id: string | null;
          created_by: string | null;
          occurred_at: string;
          type: Database['public']['Enums']['activity_type'];
          direction: string | null;
          outcome: string | null;
          duration_seconds: number | null;
          body: string | null;
          meta: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          contact_id?: string | null;
          created_by?: string | null;
          occurred_at?: string;
          type: Database['public']['Enums']['activity_type'];
          direction?: string | null;
          outcome?: string | null;
          duration_seconds?: number | null;
          body?: string | null;
          meta?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          contact_id?: string | null;
          created_by?: string | null;
          occurred_at?: string;
          type?: Database['public']['Enums']['activity_type'];
          direction?: string | null;
          outcome?: string | null;
          duration_seconds?: number | null;
          body?: string | null;
          meta?: Json;
        };
        Relationships: [
          { foreignKeyName: "activities_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
          { foreignKeyName: "activities_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"]; },
          { foreignKeyName: "activities_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      ad_spend_daily: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          date: string;
          ad_id: string;
          account_id: string | null;
          campaign_id: string | null;
          campaign_name: string | null;
          adset_id: string | null;
          adset_name: string | null;
          ad_name: string | null;
          spend: number;
          impressions: number;
          clicks: number;
          link_clicks: number;
          meta_leads: number;
          imported_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          date: string;
          ad_id: string;
          account_id?: string | null;
          campaign_id?: string | null;
          campaign_name?: string | null;
          adset_id?: string | null;
          adset_name?: string | null;
          ad_name?: string | null;
          spend?: number;
          impressions?: number;
          clicks?: number;
          link_clicks?: number;
          meta_leads?: number;
          imported_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          date?: string;
          ad_id?: string;
          account_id?: string | null;
          campaign_id?: string | null;
          campaign_name?: string | null;
          adset_id?: string | null;
          adset_name?: string | null;
          ad_name?: string | null;
          spend?: number;
          impressions?: number;
          clicks?: number;
          link_clicks?: number;
          meta_leads?: number;
          imported_at?: string;
        };
        Relationships: [
        ];
      };
      appointments: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          deal_id: string | null;
          contact_id: string | null;
          kind: string;
          starts_at: string;
          ends_at: string;
          status: string;
          source: string;
          notes: string | null;
          ics_uid: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          contact_id?: string | null;
          kind?: string;
          starts_at: string;
          ends_at: string;
          status?: string;
          source?: string;
          notes?: string | null;
          ics_uid?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          contact_id?: string | null;
          kind?: string;
          starts_at?: string;
          ends_at?: string;
          status?: string;
          source?: string;
          notes?: string | null;
          ics_uid?: string;
        };
        Relationships: [
          { foreignKeyName: "appointments_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
          { foreignKeyName: "appointments_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      attribution: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deal_id: string;
          form_source: string | null;
          page_url: string | null;
          landing_url: string | null;
          referrer: string | null;
          landing_referrer: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          utm_term: string | null;
          utm_content: string | null;
          event_id: string | null;
          fbp: string | null;
          fbc: string | null;
          meta_lead_id: string | null;
          meta_form_id: string | null;
          meta_form_name: string | null;
          meta_ad_id: string | null;
          meta_ad_name: string | null;
          meta_adset_id: string | null;
          meta_adset_name: string | null;
          meta_campaign_id: string | null;
          meta_campaign_name: string | null;
          platform: string | null;
          is_organic: boolean | null;
          raw: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deal_id: string;
          form_source?: string | null;
          page_url?: string | null;
          landing_url?: string | null;
          referrer?: string | null;
          landing_referrer?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          utm_term?: string | null;
          utm_content?: string | null;
          event_id?: string | null;
          fbp?: string | null;
          fbc?: string | null;
          meta_lead_id?: string | null;
          meta_form_id?: string | null;
          meta_form_name?: string | null;
          meta_ad_id?: string | null;
          meta_ad_name?: string | null;
          meta_adset_id?: string | null;
          meta_adset_name?: string | null;
          meta_campaign_id?: string | null;
          meta_campaign_name?: string | null;
          platform?: string | null;
          is_organic?: boolean | null;
          raw?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deal_id?: string;
          form_source?: string | null;
          page_url?: string | null;
          landing_url?: string | null;
          referrer?: string | null;
          landing_referrer?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          utm_term?: string | null;
          utm_content?: string | null;
          event_id?: string | null;
          fbp?: string | null;
          fbc?: string | null;
          meta_lead_id?: string | null;
          meta_form_id?: string | null;
          meta_form_name?: string | null;
          meta_ad_id?: string | null;
          meta_ad_name?: string | null;
          meta_adset_id?: string | null;
          meta_adset_name?: string | null;
          meta_campaign_id?: string | null;
          meta_campaign_name?: string | null;
          platform?: string | null;
          is_organic?: boolean | null;
          raw?: Json;
        };
        Relationships: [
          { foreignKeyName: "attribution_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          actor: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          diff: Json;
          at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          actor?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          diff?: Json;
          at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          actor?: string | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          diff?: Json;
          at?: string;
        };
        Relationships: [
        ];
      };
      automations: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          key: string;
          enabled: boolean;
          config: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          key: string;
          enabled?: boolean;
          config?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          key?: string;
          enabled?: boolean;
          config?: Json;
        };
        Relationships: [
        ];
      };
      businesses: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          name: string;
          trade: string | null;
          abn: string | null;
          website_url: string | null;
          google_business_url: string | null;
          suburb: string | null;
          state: string;
          postcode: string | null;
          service_areas: string[];
          notes: string | null;
          anonymised_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          name: string;
          trade?: string | null;
          abn?: string | null;
          website_url?: string | null;
          google_business_url?: string | null;
          suburb?: string | null;
          state?: string;
          postcode?: string | null;
          service_areas?: string[];
          notes?: string | null;
          anonymised_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          name?: string;
          trade?: string | null;
          abn?: string | null;
          website_url?: string | null;
          google_business_url?: string | null;
          suburb?: string | null;
          state?: string;
          postcode?: string | null;
          service_areas?: string[];
          notes?: string | null;
          anonymised_at?: string | null;
        };
        Relationships: [
        ];
      };
      calendar_tokens: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          user_id: string;
          token_hash: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id: string;
          token_hash: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id?: string;
          token_hash?: string;
          revoked_at?: string | null;
        };
        Relationships: [
        ];
      };
      capi_outbox: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deal_id: string;
          event_name: string;
          event_id: string;
          payload: Json;
          status: string;
          attempts: number;
          last_error: string | null;
          sent_at: string | null;
          next_attempt_at: string;
          locked_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deal_id: string;
          event_name: string;
          event_id: string;
          payload: Json;
          status?: string;
          attempts?: number;
          last_error?: string | null;
          sent_at?: string | null;
          next_attempt_at?: string;
          locked_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deal_id?: string;
          event_name?: string;
          event_id?: string;
          payload?: Json;
          status?: string;
          attempts?: number;
          last_error?: string | null;
          sent_at?: string | null;
          next_attempt_at?: string;
          locked_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "capi_outbox_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      checklist_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          project_id: string;
          section: string;
          title: string;
          due_at: string | null;
          done_at: string | null;
          sort: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          project_id: string;
          section?: string;
          title: string;
          due_at?: string | null;
          done_at?: string | null;
          sort?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          project_id?: string;
          section?: string;
          title?: string;
          due_at?: string | null;
          done_at?: string | null;
          sort?: number;
        };
        Relationships: [
          { foreignKeyName: "checklist_items_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"]; },
        ];
      };
      consents: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          contact_id: string;
          channel: string;
          status: string;
          source: string;
          evidence: string | null;
          at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          contact_id: string;
          channel: string;
          status: string;
          source: string;
          evidence?: string | null;
          at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          contact_id?: string;
          channel?: string;
          status?: string;
          source?: string;
          evidence?: string | null;
          at?: string;
        };
        Relationships: [
          { foreignKeyName: "consents_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
        ];
      };
      contacts: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          business_id: string | null;
          first_name: string;
          last_name: string;
          role_title: string | null;
          phone_e164: string | null;
          phone_display: string | null;
          email: string | null;
          preferred_channel: string;
          best_time: string | null;
          sms_opt_out_at: string | null;
          email_opt_out_at: string | null;
          do_not_contact: boolean;
          anonymised_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          business_id?: string | null;
          first_name?: string;
          last_name?: string;
          role_title?: string | null;
          phone_e164?: string | null;
          phone_display?: string | null;
          email?: string | null;
          preferred_channel?: string;
          best_time?: string | null;
          sms_opt_out_at?: string | null;
          email_opt_out_at?: string | null;
          do_not_contact?: boolean;
          anonymised_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          business_id?: string | null;
          first_name?: string;
          last_name?: string;
          role_title?: string | null;
          phone_e164?: string | null;
          phone_display?: string | null;
          email?: string | null;
          preferred_channel?: string;
          best_time?: string | null;
          sms_opt_out_at?: string | null;
          email_opt_out_at?: string | null;
          do_not_contact?: boolean;
          anonymised_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "contacts_business_id_fkey"; columns: ["business_id"]; isOneToOne: false; referencedRelation: "businesses"; referencedColumns: ["id"]; },
        ];
      };
      deal_milestones: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deal_id: string;
          milestone_key: string;
          first_reached_at: string;
          reached_by: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deal_id: string;
          milestone_key: string;
          first_reached_at?: string;
          reached_by?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deal_id?: string;
          milestone_key?: string;
          first_reached_at?: string;
          reached_by?: string | null;
        };
        Relationships: [
          { foreignKeyName: "deal_milestones_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
          { foreignKeyName: "deal_milestones_reached_by_fkey"; columns: ["reached_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"]; },
        ];
      };
      deals: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          contact_id: string;
          business_id: string | null;
          title: string;
          product_id: string | null;
          owner_id: string | null;
          channel: string;
          stage_key: string;
          stage_entered_at: string;
          outcome: Database['public']['Enums']['deal_outcome'];
          lost_reason: string | null;
          closed_at: string | null;
          value_once: number | null;
          value_monthly: number | null;
          promised_text: string | null;
          promised_due_at: string | null;
          next_step: string | null;
          next_step_at: string | null;
          first_touch_at: string | null;
          two_way_at: string | null;
          presales_minutes: number;
          demo_build_minutes: number;
          returning: boolean;
          chloe_status: string | null;
          chloe_fields: Json;
          merged_into_id: string | null;
          chloe_last_event_at: string | null;
          anonymised_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          contact_id: string;
          business_id?: string | null;
          title: string;
          product_id?: string | null;
          owner_id?: string | null;
          channel?: string;
          stage_key?: string;
          stage_entered_at?: string;
          outcome?: Database['public']['Enums']['deal_outcome'];
          lost_reason?: string | null;
          closed_at?: string | null;
          value_once?: number | null;
          value_monthly?: number | null;
          promised_text?: string | null;
          promised_due_at?: string | null;
          next_step?: string | null;
          next_step_at?: string | null;
          first_touch_at?: string | null;
          two_way_at?: string | null;
          presales_minutes?: number;
          demo_build_minutes?: number;
          returning?: boolean;
          chloe_status?: string | null;
          chloe_fields?: Json;
          merged_into_id?: string | null;
          chloe_last_event_at?: string | null;
          anonymised_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          contact_id?: string;
          business_id?: string | null;
          title?: string;
          product_id?: string | null;
          owner_id?: string | null;
          channel?: string;
          stage_key?: string;
          stage_entered_at?: string;
          outcome?: Database['public']['Enums']['deal_outcome'];
          lost_reason?: string | null;
          closed_at?: string | null;
          value_once?: number | null;
          value_monthly?: number | null;
          promised_text?: string | null;
          promised_due_at?: string | null;
          next_step?: string | null;
          next_step_at?: string | null;
          first_touch_at?: string | null;
          two_way_at?: string | null;
          presales_minutes?: number;
          demo_build_minutes?: number;
          returning?: boolean;
          chloe_status?: string | null;
          chloe_fields?: Json;
          merged_into_id?: string | null;
          chloe_last_event_at?: string | null;
          anonymised_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "deals_business_id_fkey"; columns: ["business_id"]; isOneToOne: false; referencedRelation: "businesses"; referencedColumns: ["id"]; },
          { foreignKeyName: "deals_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
          { foreignKeyName: "deals_merged_into_id_fkey"; columns: ["merged_into_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
          { foreignKeyName: "deals_owner_id_fkey"; columns: ["owner_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"]; },
          { foreignKeyName: "deals_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"]; },
        ];
      };
      demos: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          deal_id: string;
          status: string;
          url: string | null;
          sent_at: string | null;
          build_minutes: number;
          notes: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id: string;
          status?: string;
          url?: string | null;
          sent_at?: string | null;
          build_minutes?: number;
          notes?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string;
          status?: string;
          url?: string | null;
          sent_at?: string | null;
          build_minutes?: number;
          notes?: string | null;
        };
        Relationships: [
          { foreignKeyName: "demos_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      files: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          entity: string;
          entity_id: string;
          path: string;
          name: string;
          mime: string;
          size: number;
          upload_status: string;
          uploaded_by: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          entity: string;
          entity_id: string;
          path: string;
          name: string;
          mime: string;
          size: number;
          upload_status?: string;
          uploaded_by?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          entity?: string;
          entity_id?: string;
          path?: string;
          name?: string;
          mime?: string;
          size?: number;
          upload_status?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          { foreignKeyName: "files_uploaded_by_fkey"; columns: ["uploaded_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"]; },
        ];
      };
      import_batches: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          created_by: string;
          content_hash: string;
          entity: string;
          total_rows: number;
          status: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          created_by: string;
          content_hash: string;
          entity: string;
          total_rows: number;
          status?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string;
          content_hash?: string;
          entity?: string;
          total_rows?: number;
          status?: string;
        };
        Relationships: [
          { foreignKeyName: "import_batches_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"]; },
        ];
      };
      import_rows: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          batch_id: string;
          row_number: number;
          row_hash: string;
          contact_id: string | null;
          deal_id: string | null;
          business_id: string | null;
          was_match: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          batch_id: string;
          row_number: number;
          row_hash: string;
          contact_id?: string | null;
          deal_id?: string | null;
          business_id?: string | null;
          was_match?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          batch_id?: string;
          row_number?: number;
          row_hash?: string;
          contact_id?: string | null;
          deal_id?: string | null;
          business_id?: string | null;
          was_match?: boolean;
        };
        Relationships: [
          { foreignKeyName: "import_rows_batch_id_fkey"; columns: ["batch_id"]; isOneToOne: false; referencedRelation: "import_batches"; referencedColumns: ["id"]; },
          { foreignKeyName: "import_rows_business_id_fkey"; columns: ["business_id"]; isOneToOne: false; referencedRelation: "businesses"; referencedColumns: ["id"]; },
          { foreignKeyName: "import_rows_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
          { foreignKeyName: "import_rows_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      integration_inbox: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          source: string;
          idempotency_key: string;
          received_at: string;
          status: string;
          error: string | null;
          deal_id: string | null;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          source: string;
          idempotency_key: string;
          received_at?: string;
          status?: string;
          error?: string | null;
          deal_id?: string | null;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          source?: string;
          idempotency_key?: string;
          received_at?: string;
          status?: string;
          error?: string | null;
          deal_id?: string | null;
          processed_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "integration_inbox_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      invoice_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          invoice_id: string;
          product_id: string | null;
          description: string;
          qty: number;
          unit_price: number;
          included: boolean;
          sort: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          invoice_id: string;
          product_id?: string | null;
          description: string;
          qty?: number;
          unit_price: number;
          included?: boolean;
          sort?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          invoice_id?: string;
          product_id?: string | null;
          description?: string;
          qty?: number;
          unit_price?: number;
          included?: boolean;
          sort?: number;
        };
        Relationships: [
          { foreignKeyName: "invoice_items_invoice_id_fkey"; columns: ["invoice_id"]; isOneToOne: false; referencedRelation: "invoices"; referencedColumns: ["id"]; },
          { foreignKeyName: "invoice_items_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"]; },
        ];
      };
      invoices: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          number: string;
          status: string;
          business_id: string | null;
          contact_id: string | null;
          deal_id: string | null;
          project_id: string | null;
          subscription_id: string | null;
          issued_on: string;
          due_on: string;
          sent_at: string | null;
          paid_at: string | null;
          subtotal: number;
          gst: number;
          total: number;
          notes: string | null;
          gst_wording: string | null;
          billing_snapshot: Json;
          quote_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          number: string;
          status?: string;
          business_id?: string | null;
          contact_id?: string | null;
          deal_id?: string | null;
          project_id?: string | null;
          subscription_id?: string | null;
          issued_on?: string;
          due_on: string;
          sent_at?: string | null;
          paid_at?: string | null;
          subtotal?: number;
          gst?: number;
          total?: number;
          notes?: string | null;
          gst_wording?: string | null;
          billing_snapshot?: Json;
          quote_id?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          number?: string;
          status?: string;
          business_id?: string | null;
          contact_id?: string | null;
          deal_id?: string | null;
          project_id?: string | null;
          subscription_id?: string | null;
          issued_on?: string;
          due_on?: string;
          sent_at?: string | null;
          paid_at?: string | null;
          subtotal?: number;
          gst?: number;
          total?: number;
          notes?: string | null;
          gst_wording?: string | null;
          billing_snapshot?: Json;
          quote_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "invoices_business_id_fkey"; columns: ["business_id"]; isOneToOne: false; referencedRelation: "businesses"; referencedColumns: ["id"]; },
          { foreignKeyName: "invoices_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
          { foreignKeyName: "invoices_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
          { foreignKeyName: "invoices_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"]; },
          { foreignKeyName: "invoices_quote_id_fkey"; columns: ["quote_id"]; isOneToOne: false; referencedRelation: "quotes"; referencedColumns: ["id"]; },
          { foreignKeyName: "invoices_subscription_id_fkey"; columns: ["subscription_id"]; isOneToOne: false; referencedRelation: "subscriptions"; referencedColumns: ["id"]; },
        ];
      };
      job_runs: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          key: string;
          status: string;
          attempts: number;
          locked_at: string | null;
          finished_at: string | null;
          error: string | null;
          entity_id: string | null;
          kind: string | null;
          run_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          key: string;
          status?: string;
          attempts?: number;
          locked_at?: string | null;
          finished_at?: string | null;
          error?: string | null;
          entity_id?: string | null;
          kind?: string | null;
          run_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          key?: string;
          status?: string;
          attempts?: number;
          locked_at?: string | null;
          finished_at?: string | null;
          error?: string | null;
          entity_id?: string | null;
          kind?: string | null;
          run_at?: string;
        };
        Relationships: [
        ];
      };
      message_drafts: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          contact_id: string;
          deal_id: string | null;
          invoice_id: string | null;
          channel: string;
          subject: string | null;
          body: string;
          status: string;
          rule_key: string | null;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          contact_id: string;
          deal_id?: string | null;
          invoice_id?: string | null;
          channel: string;
          subject?: string | null;
          body: string;
          status?: string;
          rule_key?: string | null;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          contact_id?: string;
          deal_id?: string | null;
          invoice_id?: string | null;
          channel?: string;
          subject?: string | null;
          body?: string;
          status?: string;
          rule_key?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "message_drafts_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
          { foreignKeyName: "message_drafts_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
          { foreignKeyName: "message_drafts_invoice_id_fkey"; columns: ["invoice_id"]; isOneToOne: false; referencedRelation: "invoices"; referencedColumns: ["id"]; },
        ];
      };
      notifications_log: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          event_key: string;
          entity_id: string | null;
          channel: string;
          status: string;
          error: string | null;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          event_key: string;
          entity_id?: string | null;
          channel: string;
          status?: string;
          error?: string | null;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          event_key?: string;
          entity_id?: string | null;
          channel?: string;
          status?: string;
          error?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
        ];
      };
      payments: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          invoice_id: string;
          amount: number;
          received_on: string;
          method: string;
          reference: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          invoice_id: string;
          amount: number;
          received_on?: string;
          method?: string;
          reference?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          invoice_id?: string;
          amount?: number;
          received_on?: string;
          method?: string;
          reference?: string | null;
        };
        Relationships: [
          { foreignKeyName: "payments_invoice_id_fkey"; columns: ["invoice_id"]; isOneToOne: false; referencedRelation: "invoices"; referencedColumns: ["id"]; },
        ];
      };
      products: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          name: string;
          kind: string;
          price: number;
          summary: string | null;
          included: string[];
          active: boolean;
          sort: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          name: string;
          kind: string;
          price: number;
          summary?: string | null;
          included?: string[];
          active?: boolean;
          sort?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          name?: string;
          kind?: string;
          price?: number;
          summary?: string | null;
          included?: string[];
          active?: boolean;
          sort?: number;
        };
        Relationships: [
        ];
      };
      profiles: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          user_id: string;
          name: string;
          role: Database['public']['Enums']['app_role'];
          notification_prefs: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id: string;
          name: string;
          role?: Database['public']['Enums']['app_role'];
          notification_prefs?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id?: string;
          name?: string;
          role?: Database['public']['Enums']['app_role'];
          notification_prefs?: Json;
        };
        Relationships: [
        ];
      };
      projects: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          deal_id: string | null;
          business_id: string | null;
          name: string;
          stage_key: string;
          template_key: string;
          kickoff_at: string | null;
          launched_at: string | null;
          site_url: string | null;
          feature_permission: string;
          feature_permission_at: string | null;
          feature_permission_note: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          business_id?: string | null;
          name: string;
          stage_key?: string;
          template_key?: string;
          kickoff_at?: string | null;
          launched_at?: string | null;
          site_url?: string | null;
          feature_permission?: string;
          feature_permission_at?: string | null;
          feature_permission_note?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          business_id?: string | null;
          name?: string;
          stage_key?: string;
          template_key?: string;
          kickoff_at?: string | null;
          launched_at?: string | null;
          site_url?: string | null;
          feature_permission?: string;
          feature_permission_at?: string | null;
          feature_permission_note?: string | null;
        };
        Relationships: [
          { foreignKeyName: "projects_business_id_fkey"; columns: ["business_id"]; isOneToOne: false; referencedRelation: "businesses"; referencedColumns: ["id"]; },
          { foreignKeyName: "projects_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      push_subscriptions: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
        };
        Relationships: [
        ];
      };
      quote_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          quote_id: string;
          product_id: string | null;
          description: string;
          qty: number;
          unit_price: number;
          kind: string;
          included: boolean;
          sort: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          quote_id: string;
          product_id?: string | null;
          description: string;
          qty?: number;
          unit_price: number;
          kind: string;
          included?: boolean;
          sort?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          quote_id?: string;
          product_id?: string | null;
          description?: string;
          qty?: number;
          unit_price?: number;
          kind?: string;
          included?: boolean;
          sort?: number;
        };
        Relationships: [
          { foreignKeyName: "quote_items_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"]; },
          { foreignKeyName: "quote_items_quote_id_fkey"; columns: ["quote_id"]; isOneToOne: false; referencedRelation: "quotes"; referencedColumns: ["id"]; },
        ];
      };
      quotes: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          deal_id: string;
          number: string;
          status: string;
          public_token: string;
          issued_at: string | null;
          expires_at: string | null;
          accepted_at: string | null;
          accepted_name: string | null;
          accepted_ip: string | null;
          accepted_user_agent: string | null;
          view_count: number;
          first_viewed_at: string | null;
          last_viewed_at: string | null;
          total_once: number;
          total_monthly: number;
          terms_url: string | null;
          notes: string | null;
          terms_snapshot: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id: string;
          number: string;
          status?: string;
          public_token?: string;
          issued_at?: string | null;
          expires_at?: string | null;
          accepted_at?: string | null;
          accepted_name?: string | null;
          accepted_ip?: string | null;
          accepted_user_agent?: string | null;
          view_count?: number;
          first_viewed_at?: string | null;
          last_viewed_at?: string | null;
          total_once?: number;
          total_monthly?: number;
          terms_url?: string | null;
          notes?: string | null;
          terms_snapshot?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string;
          number?: string;
          status?: string;
          public_token?: string;
          issued_at?: string | null;
          expires_at?: string | null;
          accepted_at?: string | null;
          accepted_name?: string | null;
          accepted_ip?: string | null;
          accepted_user_agent?: string | null;
          view_count?: number;
          first_viewed_at?: string | null;
          last_viewed_at?: string | null;
          total_once?: number;
          total_monthly?: number;
          terms_url?: string | null;
          notes?: string | null;
          terms_snapshot?: Json;
        };
        Relationships: [
          { foreignKeyName: "quotes_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
        ];
      };
      rate_limits: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          key: string;
          window_start: string;
          count: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          key: string;
          window_start: string;
          count?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          key?: string;
          window_start?: string;
          count?: number;
        };
        Relationships: [
        ];
      };
      saved_views: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          user_id: string;
          entity: string;
          name: string;
          filters: Json;
          sort: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id: string;
          entity: string;
          name: string;
          filters?: Json;
          sort?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          user_id?: string;
          entity?: string;
          name?: string;
          filters?: Json;
          sort?: Json;
        };
        Relationships: [
        ];
      };
      settings: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          singleton: boolean;
          config: Json;
          revision: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          singleton?: boolean;
          config?: Json;
          revision?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          singleton?: boolean;
          config?: Json;
          revision?: number;
        };
        Relationships: [
        ];
      };
      storage_deletions: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          bucket: string;
          path: string;
          attempts: number;
          done_at: string | null;
          error: string | null;
          contact_id: string | null;
          delete_after: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          bucket?: string;
          path: string;
          attempts?: number;
          done_at?: string | null;
          error?: string | null;
          contact_id?: string | null;
          delete_after?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          bucket?: string;
          path?: string;
          attempts?: number;
          done_at?: string | null;
          error?: string | null;
          contact_id?: string | null;
          delete_after?: string;
        };
        Relationships: [
          { foreignKeyName: "storage_deletions_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
        ];
      };
      subscriptions: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          business_id: string;
          product_id: string | null;
          price: number;
          status: string;
          started_on: string;
          billing_day: number;
          next_invoice_on: string | null;
          cancelled_on: string | null;
          status_reason: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          business_id: string;
          product_id?: string | null;
          price: number;
          status?: string;
          started_on?: string;
          billing_day: number;
          next_invoice_on?: string | null;
          cancelled_on?: string | null;
          status_reason?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          business_id?: string;
          product_id?: string | null;
          price?: number;
          status?: string;
          started_on?: string;
          billing_day?: number;
          next_invoice_on?: string | null;
          cancelled_on?: string | null;
          status_reason?: string | null;
        };
        Relationships: [
          { foreignKeyName: "subscriptions_business_id_fkey"; columns: ["business_id"]; isOneToOne: false; referencedRelation: "businesses"; referencedColumns: ["id"]; },
          { foreignKeyName: "subscriptions_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"]; },
        ];
      };
      taggings: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          tag_id: string;
          entity: string;
          entity_id: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          tag_id: string;
          entity: string;
          entity_id: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          tag_id?: string;
          entity?: string;
          entity_id?: string;
        };
        Relationships: [
          { foreignKeyName: "taggings_tag_id_fkey"; columns: ["tag_id"]; isOneToOne: false; referencedRelation: "tags"; referencedColumns: ["id"]; },
        ];
      };
      tags: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          name: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          name: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          name?: string;
        };
        Relationships: [
        ];
      };
      tasks: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          deal_id: string | null;
          contact_id: string | null;
          project_id: string | null;
          title: string;
          notes: string | null;
          priority: string;
          created_by: string | null;
          due_at: string | null;
          remind_at: string | null;
          snoozed_until: string | null;
          done_at: string | null;
          rule_key: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          contact_id?: string | null;
          project_id?: string | null;
          title: string;
          notes?: string | null;
          priority?: string;
          created_by?: string | null;
          due_at?: string | null;
          remind_at?: string | null;
          snoozed_until?: string | null;
          done_at?: string | null;
          rule_key?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deal_id?: string | null;
          contact_id?: string | null;
          project_id?: string | null;
          title?: string;
          notes?: string | null;
          priority?: string;
          created_by?: string | null;
          due_at?: string | null;
          remind_at?: string | null;
          snoozed_until?: string | null;
          done_at?: string | null;
          rule_key?: string | null;
        };
        Relationships: [
          { foreignKeyName: "tasks_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"]; },
          { foreignKeyName: "tasks_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"]; },
          { foreignKeyName: "tasks_deal_id_fkey"; columns: ["deal_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["id"]; },
          { foreignKeyName: "tasks_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"]; },
        ];
      };
      templates: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          channel: string;
          name: string;
          subject: string | null;
          body: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          channel: string;
          name: string;
          subject?: string | null;
          body: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          channel?: string;
          name?: string;
          subject?: string | null;
          body?: string;
          active?: boolean;
        };
        Relationships: [
        ];
      };
      user_invitations: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          email: string;
          role: Database['public']['Enums']['app_role'];
          name: string;
          invited_by: string | null;
          accepted_at: string | null;
          expires_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          email: string;
          role?: Database['public']['Enums']['app_role'];
          name?: string;
          invited_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          email?: string;
          role?: Database['public']['Enums']['app_role'];
          name?: string;
          invited_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string;
        };
        Relationships: [
          { foreignKeyName: "user_invitations_invited_by_fkey"; columns: ["invited_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"]; },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      accept_invitation: { Args: Record<PropertyKey, never>; Returns: Database['public']['Tables']['profiles']['Row'] };
      accept_quote: { Args: { p_token: string; p_name: string; p_terms_accepted: boolean; p_ip?: string | null; p_user_agent?: string | null }; Returns: Json };
      anonymise_contact: { Args: { p_contact_id: string }; Returns: undefined };
      backup_table_names: { Args: Record<PropertyKey, never>; Returns: string[] };
      calendar_feed: { Args: { p_hash: string }; Returns: Json };
      cancel_file_upload: { Args: { p_file_id: string }; Returns: undefined };
      capi_candidates: { Args: { p_limit?: number | null }; Returns: Json[] };
      claim_capi: { Args: { p_limit?: number | null }; Returns: Database['public']['Tables']['capi_outbox']['Row'][] };
      claim_job: { Args: { p_key: string; p_kind: string; p_entity_id?: string | null; p_lease_seconds?: number | null }; Returns: boolean };
      consume_rate_limit: { Args: { p_key: string; p_limit: number; p_window_seconds: number }; Returns: boolean };
      contact_redaction_scope: { Args: { p_contact_id: string }; Returns: Json };
      create_invoice: { Args: { p_input: Json }; Returns: Database['public']['Tables']['invoices']['Row'] };
      create_lead: { Args: { p_input: Json }; Returns: Json };
      create_quote: { Args: { p_deal_id: string; p_items: Json; p_expires_at?: string | null; p_notes?: string | null }; Returns: Database['public']['Tables']['quotes']['Row'] };
      current_app_role: { Args: Record<PropertyKey, never>; Returns: string };
      current_profile_id: { Args: Record<PropertyKey, never>; Returns: string };
      ensure_task: { Args: { p_input: Json }; Returns: string };
      finalise_message: { Args: { p_activity_id: string; p_status: string; p_provider_id?: string | null }; Returns: undefined };
      finish_job: { Args: { p_key: string; p_status: string; p_error?: string | null }; Returns: undefined };
      get_configuration: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_profile: { Args: Record<PropertyKey, never>; Returns: Database['public']['Tables']['profiles']['Row'][] };
      has_role: { Args: { allowed: string[] }; Returns: boolean };
      import_lead_row: { Args: { p_batch_id: string; p_row_number: number; p_row_hash: string; p_input: Json }; Returns: Json };
      import_lead_rows: { Args: { p_batch_id: string; p_rows: Json }; Returns: Json };
      ingest_chloe: { Args: { p_key: string; p_input: Json }; Returns: Json };
      ingest_lead: { Args: { p_source: string; p_key: string; p_input: Json }; Returns: Json };
      invoice_from_quote: { Args: { p_quote_id: string; p_kind: string }; Returns: Database['public']['Tables']['invoices']['Row'] };
      is_service: { Args: Record<PropertyKey, never>; Returns: boolean };
      issue_quote: { Args: { p_quote_id: string }; Returns: Database['public']['Tables']['quotes']['Row'] };
      launch_project: { Args: { p_project_id: string; p_site_url: string }; Returns: Database['public']['Tables']['projects']['Row'] };
      log_call: { Args: { p_deal_id: string; p_outcome: string; p_body?: string | null; p_next_step?: string | null; p_next_step_at?: string | null }; Returns: Database['public']['Tables']['deals']['Row'] };
      mark_storage_deleted: { Args: { p_paths: string[] }; Returns: undefined };
      merge_deals: { Args: { p_keep_id: string; p_merge_id: string }; Returns: Database['public']['Tables']['deals']['Row'] };
      move_deal_stage: { Args: { p_deal_id: string; p_stage_key: string; p_override_reason?: string | null }; Returns: Database['public']['Tables']['deals']['Row'] };
      patch_deal: { Args: { p_deal_id: string; p_patch: Json; p_override_reason?: string | null }; Returns: Database['public']['Tables']['deals']['Row'] };
      person_data_scope: { Args: { p_contact_id: string }; Returns: Json };
      person_storage_paths: { Args: { p_contact_id: string }; Returns: string[] };
      prepare_import_batch: { Args: { p_id: string; p_hash: string; p_entity: string; p_total: number }; Returns: Database['public']['Tables']['import_batches']['Row'] };
      prepare_invoice_message: { Args: { p_invoice_id: string; p_request_id: string; p_body: string; p_subject: string }; Returns: Json };
      prepare_message: { Args: { p_deal_id: string; p_channel: string; p_body: string; p_subject: string; p_request_id: string }; Returns: Json };
      public_quote: { Args: { p_token: string }; Returns: Json };
      purge_bin: { Args: { p_before: string }; Returns: number };
      queue_export_cleanup: { Args: { p_path: string }; Returns: undefined };
      quote_capability: { Args: { p_token: string; p_action: string }; Returns: Database['public']['Tables']['quotes']['Row'] };
      reap_pending_uploads: { Args: Record<PropertyKey, never>; Returns: number };
      record_consent: { Args: { p_contact_id: string; p_channel: string; p_status: string; p_source: string; p_evidence?: string | null }; Returns: undefined };
      record_payment: { Args: { p_invoice_id: string; p_amount: number; p_received_on?: string | null; p_method?: string | null; p_reference?: string | null }; Returns: Database['public']['Tables']['payments']['Row'] };
      record_quote_view: { Args: { p_token: string }; Returns: undefined };
      restore_deleted: { Args: { p_entity: string; p_id: string }; Returns: Json };
      retention_candidates: { Args: { p_before: string; p_limit?: number | null }; Returns: string[] };
      save_settings: { Args: { p_config: Json; p_expected_revision: number }; Returns: Database['public']['Tables']['settings']['Row'] };
    };
    Enums: {
      activity_type: "call" | "sms_out" | "sms_in" | "email_out" | "email_in" | "note" | "meeting" | "form" | "stage_change" | "chloe_out" | "chloe_in" | "chloe_status" | "quote_sent" | "quote_viewed" | "quote_accepted" | "invoice_sent" | "payment" | "system";
      app_role: "owner" | "staff" | "viewer";
      deal_outcome: "open" | "won" | "lost" | "unsuitable" | "noreply";
    };
    CompositeTypes: { [_ in never]: never };
  };
};
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
