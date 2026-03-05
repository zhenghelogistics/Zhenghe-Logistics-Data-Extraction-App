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
