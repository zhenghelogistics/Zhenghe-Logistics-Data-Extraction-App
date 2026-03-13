export interface LogisticsParties {
  shipper_supplier?: string | null;
  consignee_buyer?: string | null;
  notify_party?: string | null;
}

export interface DocumentMetadata {
  reference_number?: string | null;
  related_reference_number?: string | null; // e.g. BL Number on a Voucher
  date?: string | null;
  currency?: string | null;
  incoterms?: string | null;
  parties?: LogisticsParties;
}

export interface LogisticsDetails {
  vessel_name?: string | null;
  voyage_number?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  container_numbers?: string[];
  marks_and_numbers?: string | null;
}

export interface LineItemCharge {
  description?: string | null;
  amount?: number | null;
}

export interface DocumentFinancials {
  total_amount?: number | null;
  total_tax_amount?: number | null;
  line_item_charges?: LineItemCharge[];
}

export interface CargoItem {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  hs_code?: string | null;
}

export interface CargoDetails {
  total_gross_weight?: number | null;
  total_net_weight?: number | null;
  total_packages?: number | null;
  weight_unit?: string | null;
  line_items?: CargoItem[];
}

export interface PaymentVoucherDetails {
  pss_invoice_number?: string | null;
  carrier_invoice_number?: string | null;
  bl_number?: string | null;
  payable_amount?: string | null;
  total_payable_amount?: string | null;
  charges_summary?: string | null;
}

export interface LogisticsLocalCharges {
  bl_number?: string | null;
  carrier_forwarder?: string | null;
  pss_invoice_number?: string | null;
  freight_term?: string | null;
  place_of_destination?: string | null;
  container_type?: string | null;
  container_qty?: string | null;
  thc_amount?: string | null;
  seal_fee?: string | null;
  bl_fee?: string | null;
  bl_printed_fee?: string | null;
  ens_ams_fee?: string | null;
  other_charges?: string | null;
  remarks?: string | null;
  total_payable_amount?: string | null;
}

export interface OutwardPermitDeclaration {
  permit_number?: string | null;
  exporter?: string | null;
  consignee?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  total_fob_value?: string | null;
  gst_amount?: string | null;
  // Shipping team extraction fields
  bl_number?: string | null;
  carrier?: string | null;
  container_no?: string | null;
  seal_no?: string | null;
  container_type?: string | null;
  final_destination_port?: string | null;
  vessel_name?: string | null;
  voyage?: string | null;
  hs_code?: string | null;
  description?: string | null;
  net_weight_kgs?: string | null;
  item_price?: string | null;
  total_outer_pack?: string | null;
  gross_weight?: string | null;
  // Description cross-check fields
  invoice_description?: string | null;
  packing_list_description?: string | null;
  bl_description?: string | null;
  po_description?: string | null;
  description_match?: string | null;
  country_of_origin?: string | null;
}

export interface TransportJob {
  job_number?: string | null;
  customer?: string | null;
  pickup_location?: string | null;
  delivery_location?: string | null;
  container_number?: string | null;
  job_date?: string | null;
}

export interface AlliedReport {
  container_booking_no?: string | null;
  repair?: string | null;
  detention?: string | null;
  dhc_in?: string | null;
  data_admin_fee_in?: string | null;
  dhe_out?: string | null;
  dhc_out?: string | null;
  washing?: string | null;
  dhe_in?: string | null;
}

export interface CdacReport {
  container_number?: string | null;
  repair?: string | null;
  detention?: string | null;
  demurage?: string | null;
  admin_fees?: string | null;
  washing?: string | null;
  dhc?: string | null;
}

export interface DocumentData {
  document_type: string;
  metadata: DocumentMetadata;
  logistics_details: LogisticsDetails;
  financials: DocumentFinancials;
  cargo_details: CargoDetails;
  payment_voucher_details?: PaymentVoucherDetails;
  logistics_local_charges?: LogisticsLocalCharges;
  outward_permit_declaration?: OutwardPermitDeclaration;
  transport_job?: TransportJob;
  allied_report?: AlliedReport;
  cdac_report?: CdacReport;
}

// Wrapper for the API response which now returns a list
export interface ExtractionResponse {
  documents: DocumentData[];
}

export interface ProcessedFile {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'warning';
  data?: DocumentData[];
  errorMessage?: string;
  validationErrors?: string[];
  uploadedAt?: string; // ISO string from Supabase created_at
}

export enum FileStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
  WARNING = 'warning'
}