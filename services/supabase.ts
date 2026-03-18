import { createClient } from "@supabase/supabase-js";
import { DocumentData, FileStatus } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase URL or Anon Key is missing. Database features will not work.");
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder"
);

export interface DatabaseDocument {
  id: string;
  user_id: string;
  filename: string;
  status: string;
  extracted_data: DocumentData[] | null;
  created_at: string;
  billing_status?: 'unbilled' | 'billed';
  billed_at?: string | null;
  billing_remarks?: string | null;
  charge_validations?: Record<string, boolean>;
}

// Fetch documents for the current user (RLS handles security, .eq is a safety net)
export const fetchDocuments = async (): Promise<DatabaseDocument[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching documents:", error);
    return [];
  }

  return data || [];
};

// Save a new document — passes extractedData directly (Supabase handles JSONB natively, no JSON.stringify needed)
export const saveDocument = async (
  filename: string,
  status: FileStatus,
  extractedData: DocumentData[] | undefined
) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("No user logged in, cannot save document");
    return null;
  }

  const { data, error } = await supabase
    .from("documents")
    .insert([{
      user_id: user.id,
      filename,
      status,
      extracted_data: extractedData ?? null,
    }])
    .select()
    .single();

  if (error) {
    console.error("Error saving document:", error);
    return null;
  }

  return data;
};

export const updateDocument = async (id: string, updates: Partial<DatabaseDocument>) => {
  const { data, error } = await supabase
    .from("documents")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating document:", error);
    return null;
  }

  return data;
};

export const updateBilling = async (
  id: string,
  updates: {
    billing_status?: 'unbilled' | 'billed';
    billed_at?: string | null;
    billing_remarks?: string | null;
    charge_validations?: Record<string, boolean>;
  }
): Promise<void> => {
  const { error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', id);
  if (error) throw new Error(error.message);
};

// ── Container Billing ──────────────────────────────────────────────────────────

export interface ContainerBillingRecord {
  id: string;
  user_id: string;
  source_document_id: string | null;
  filename: string;
  report_type: string;
  container_number: string | null;
  charges: Record<string, string>;
  charge_validations: Record<string, boolean>;
  billing_status: 'unbilled' | 'billed';
  billed_at: string | null;
  billing_remarks: string | null;
  created_at: string;
  container_date: string | null;
  is_archived: boolean;
  archive_label: string | null;
}

export const fetchContainerBilling = async (): Promise<ContainerBillingRecord[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('container_billing')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) { console.error('Error fetching container billing:', error); return []; }
  return (data || []) as ContainerBillingRecord[];
};

// Upsert rows — duplicate (user_id, filename, container_number, report_type) is silently ignored
export const insertContainerBillingRows = async (
  rows: Omit<ContainerBillingRecord, 'id' | 'user_id' | 'created_at'>[]
): Promise<ContainerBillingRecord[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const withUser = rows.map(r => ({ ...r, user_id: user.id }));
  const { data, error } = await supabase
    .from('container_billing')
    .upsert(withUser, { onConflict: 'user_id,filename,container_number,report_type', ignoreDuplicates: true })
    .select();
  if (error) { console.error('Error inserting container billing:', error); return []; }
  return (data || []) as ContainerBillingRecord[];
};

export const updateContainerBilling = async (
  id: string,
  updates: Partial<Pick<ContainerBillingRecord, 'billing_status' | 'billed_at' | 'billing_remarks' | 'charge_validations'>>
): Promise<void> => {
  const { error } = await supabase.from('container_billing').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
};

export const deleteContainerBilling = async (id: string): Promise<void> => {
  const { error } = await supabase.from('container_billing').delete().eq('id', id);
  if (error) throw new Error(error.message);
};

export const archiveContainerBilling = async (ids: string[], label: string): Promise<void> => {
  const { error } = await supabase
    .from('container_billing')
    .update({ is_archived: true, archive_label: label })
    .in('id', ids);
  if (error) throw new Error(error.message);
};

export const deleteDocument = async (id: string) => {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUUID) return { success: true, message: "Local file removed" };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "User not logged in" };

  const { error, data } = await supabase
    .from("documents")
    .delete()
    .eq("id", id)
    .select();

  if (error) return { success: false, message: error.message || "Database error" };
  if (!data || data.length === 0) return { success: false, message: "Access Denied or File Not Found (RLS)" };

  return { success: true, message: "Deleted from Database" };
};
