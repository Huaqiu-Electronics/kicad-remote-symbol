export type CommandType = 
  | "NEW_SESSION"
  | "GET_KICAD_VERSION"
  | "LIST_SUPPORTED_VERSIONS"
  | "CAPABILITIES"
  | "PING"
  | "PONG"
  | "LOGOUT"
  | "DL_FOOTPRINT"
  | "DL_SYMBOL"
  | "DL_SPICE"
  | "DL_3DMODEL"
  | "DL_COMPONENT"
  | "REMOTE_LOGIN"; // Added for login flow

export type RpcStatus = "OK" | "ERROR" | "PENDING";

export interface RpcEnvelope {
  version: number;
  session_id: string;
  message_id: number;
  response_to?: number;
  command: CommandType;
  status?: RpcStatus;
  error_code?: string;
  error_message?: string;
  parameters: Record<string, any>;
  data?: string; // base64
}

export interface AssetRecord {
  command: CommandType;
  label: string;
  filename: string;
  data: string;
  parameters: Record<string, any>;
  size_bytes: number;
}

export interface PartRecord {
  name: string;
  image: string;
  assets: AssetRecord[];
}
