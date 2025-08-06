export interface UserData {
  uid?: string;
  fullName: string;
  nickname?: string;
  mobileNumber?: string;
  gender?: 'male' | 'female' | '';
  weight?: number | null;
  age?: number | null;
  height?: number | null;
  email: string;
  isTrainer: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  nickname?: string;
  mobileNumber?: string;
  gender?: 'male' | 'female' | '';
  weight?: number;
  age?: number;
  height?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface JWTPayload {
  uid: string;
  email: string;
  userType?: string;
  isTrainer?: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  user?: T;
  token?: string;
  redirectUrl?: string;
  error?: string;
}

export interface AuthUser {
  uid: string;
  email: string;
  isTrainer: boolean;
}

export interface FirebaseServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}